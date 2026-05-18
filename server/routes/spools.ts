import { Router, Request, Response } from 'express';
import { getPrismaClient } from '../database';
import { LOG } from '../utils/logger';
import type { SpoolCreateRequest, SpoolUpdateRequest, DeductionRequest } from '@ha-addon/types';
import { normalizeSpoolColorStyle } from '@ha-addon/types';
import { publishAllSpooltrackerHASensors } from '../services/haSensors';
import { assignActiveSpoolToPrinter, AssignSpoolError } from '../services/assignActiveSpool';
import { getLiveUsedBySpoolId } from '../services/liveSpoolUsage';
import { adjustSpoolWeight } from '../services/spoolUsageCommit';

const logger = LOG('SPOOLS');
const router: Router = Router();

router.get('/spools', async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  if (!prisma) return res.status(503).json({ error: 'Database not available' });

  try {
    const { status } = req.query;
    const where: Record<string, unknown> = {};
    if (status === 'active') {
      where.isActive = true;
      where.archivedAt = null;
    } else if (status === 'archived') {
      where.archivedAt = { not: null };
    } else {
      // Default: show only non-archived spools (used by "all" + "low" filters).
      where.archivedAt = null;
    }

    const spools = await prisma.spool.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
    });
    const printersWithSpool = await prisma.printer.findMany({
      where: { activeSpoolId: { in: spools.map((s) => s.id) } },
      select: { id: true, name: true, activeSpoolId: true },
    });
    const loadedOnBySpoolId = Object.fromEntries(
      printersWithSpool
        .filter((p) => p.activeSpoolId != null)
        .map((p) => [p.activeSpoolId!, { id: p.id, name: p.name }])
    );
    const liveUsedBySpoolId = await getLiveUsedBySpoolId(prisma);
    const result = spools.map((s) => ({
      ...s,
      liveFilamentUsed: liveUsedBySpoolId[s.id] ?? 0,
      liveRemainingWeight: (liveUsedBySpoolId[s.id] ?? 0) > 0
        ? Math.max(0, s.remainingWeight - (liveUsedBySpoolId[s.id] ?? 0))
        : undefined,
      loadedOnPrinter: loadedOnBySpoolId[s.id] ?? null,
    }));
    res.json(result);
  } catch (error) {
    logger.error('Failed to fetch spools:', error);
    res.status(500).json({ error: 'Failed to fetch spools' });
  }
});

router.get('/spools/:id', async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  if (!prisma) return res.status(503).json({ error: 'Database not available' });

  try {
    const spool = await prisma.spool.findUnique({
      where: { id: req.params.id as string },
      include: { printJobs: { orderBy: { startedAt: 'desc' }, take: 10 } },
    });
    if (!spool) return res.status(404).json({ error: 'Spool not found' });
    const liveUsedBySpoolId = await getLiveUsedBySpoolId(prisma);
    const liveUsed = liveUsedBySpoolId[spool.id] ?? 0;
    res.json({
      ...spool,
      liveFilamentUsed: liveUsed,
      liveRemainingWeight: liveUsed > 0 ? Math.max(0, spool.remainingWeight - liveUsed) : undefined,
    });
  } catch (error) {
    logger.error('Failed to fetch spool:', error);
    res.status(500).json({ error: 'Failed to fetch spool' });
  }
});

router.get('/spools/:id/audit', async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  if (!prisma) return res.status(503).json({ error: 'Database not available' });

  try {
    const logs = await prisma.spoolAuditLog.findMany({
      where: { spoolId: req.params.id as string },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json(logs);
  } catch (error) {
    logger.error('Failed to fetch spool audit log:', error);
    res.status(500).json({ error: 'Failed to fetch spool audit log' });
  }
});

router.post('/spools/:id/audit/:logId/undo', async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  if (!prisma) return res.status(503).json({ error: 'Database not available' });

  try {
    const spoolId = req.params.id as string;
    const logId = req.params.logId as string;
    const log = await prisma.spoolAuditLog.findFirst({ where: { id: logId, spoolId } });
    if (!log) return res.status(404).json({ error: 'Audit log not found' });
    if (log.action.startsWith('undo_')) return res.status(400).json({ error: 'Undo entries cannot be undone' });

    const alreadyUndone = await prisma.spoolAuditLog.findFirst({
      where: { spoolId, action: `undo_${log.action}`, metadataJson: { contains: log.id } },
    });
    if (alreadyUndone) return res.status(400).json({ error: 'Audit entry already undone' });

    await adjustSpoolWeight(prisma, {
      spoolId,
      deltaGrams: -log.deltaGrams,
      action: `undo_${log.action}`,
      reason: `Undo ${log.reason ?? log.action}`,
      printJobId: log.printJobId,
      usageId: log.usageId,
      metadata: { originalAuditId: log.id },
    });
    const updated = await prisma.spool.findUniqueOrThrow({ where: { id: spoolId } });
    await publishAllSpooltrackerHASensors();
    res.json(updated);
  } catch (error) {
    logger.error('Failed to undo audit log:', error);
    res.status(500).json({ error: 'Failed to undo audit log' });
  }
});

router.post('/spools', async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  if (!prisma) return res.status(503).json({ error: 'Database not available' });

  try {
    const body: SpoolCreateRequest = req.body;
    const spool = await prisma.spool.create({
      data: {
        name: body.name,
        filamentType: body.filamentType,
        colorStyle: normalizeSpoolColorStyle(body.colorStyle),
        color: body.color,
        colorHex: body.colorHex,
        manufacturer: body.manufacturer,
        initialWeight: body.initialWeight,
        remainingWeight: body.remainingWeight ?? body.initialWeight,
        spoolWeight: body.spoolWeight,
        diameter: body.diameter ?? 1.75,
        expirationDate: body.expirationDate ? new Date(body.expirationDate) : null,
        purchaseDate: body.purchaseDate ? new Date(body.purchaseDate) : null,
        notes: body.notes,
      },
    });
    await publishAllSpooltrackerHASensors();
    res.status(201).json(spool);
  } catch (error) {
    logger.error('Failed to create spool:', error);
    res.status(500).json({ error: 'Failed to create spool' });
  }
});

router.put('/spools/:id', async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  if (!prisma) return res.status(503).json({ error: 'Database not available' });

  try {
    const body: SpoolUpdateRequest = req.body;
    const data: Record<string, unknown> = {};

    if (body.name !== undefined) data.name = body.name;
    if (body.filamentType !== undefined) data.filamentType = body.filamentType;
    if (body.colorStyle !== undefined) data.colorStyle = normalizeSpoolColorStyle(body.colorStyle);
    if (body.color !== undefined) data.color = body.color;
    if (body.colorHex !== undefined) data.colorHex = body.colorHex;
    if (body.manufacturer !== undefined) data.manufacturer = body.manufacturer;
    if (body.initialWeight !== undefined) data.initialWeight = body.initialWeight;
    if (body.remainingWeight !== undefined) data.remainingWeight = body.remainingWeight;
    if (body.spoolWeight !== undefined) data.spoolWeight = body.spoolWeight;
    if (body.diameter !== undefined) data.diameter = body.diameter;
    if (body.isActive !== undefined) data.isActive = body.isActive;
    if (body.expirationDate !== undefined) data.expirationDate = body.expirationDate ? new Date(body.expirationDate) : null;
    if (body.purchaseDate !== undefined) data.purchaseDate = body.purchaseDate ? new Date(body.purchaseDate) : null;
    if (body.notes !== undefined) data.notes = body.notes;

    const spool = await prisma.spool.update({
      where: { id: req.params.id as string },
      data,
    });
    await publishAllSpooltrackerHASensors();
    res.json(spool);
  } catch (error) {
    logger.error('Failed to update spool:', error);
    res.status(500).json({ error: 'Failed to update spool' });
  }
});

router.delete('/spools/:id', async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  if (!prisma) return res.status(503).json({ error: 'Database not available' });

  try {
    await prisma.spool.delete({ where: { id: req.params.id as string } });
    res.status(204).send();
  } catch (error) {
    logger.error('Failed to delete spool:', error);
    res.status(500).json({ error: 'Failed to delete spool' });
  }
});

router.post('/spools/:id/deduct', async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  if (!prisma) return res.status(503).json({ error: 'Database not available' });

  try {
    const { amount }: DeductionRequest = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Amount must be a positive number' });
    }

    const spool = await prisma.spool.findUnique({ where: { id: req.params.id as string } });
    if (!spool) return res.status(404).json({ error: 'Spool not found' });

    await adjustSpoolWeight(prisma, {
      spoolId: spool.id,
      deltaGrams: -amount,
      action: 'manual_deduct',
      reason: req.body?.reason ?? null,
    });
    const updated = await prisma.spool.findUniqueOrThrow({ where: { id: spool.id } });
    await publishAllSpooltrackerHASensors();
    res.json(updated);
  } catch (error) {
    logger.error('Failed to deduct filament:', error);
    res.status(500).json({ error: 'Failed to deduct filament' });
  }
});

router.post('/spools/:id/archive', async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  if (!prisma) return res.status(503).json({ error: 'Database not available' });

  try {
    const spool = await prisma.spool.update({
      where: { id: req.params.id as string },
      data: { isActive: false, archivedAt: new Date() },
    });
    await publishAllSpooltrackerHASensors();
    res.json(spool);
  } catch (error) {
    logger.error('Failed to archive spool:', error);
    res.status(500).json({ error: 'Failed to archive spool' });
  }
});

router.post('/spools/:id/activate', async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  if (!prisma) return res.status(503).json({ error: 'Database not available' });

  const spoolId = req.params.id as string;
  const body = (req.body ?? {}) as { printerId?: string };
  const printerId =
    typeof body.printerId === 'string' && body.printerId.trim().length > 0 ? body.printerId.trim() : undefined;

  try {
    const spool = await prisma.spool.update({
      where: { id: spoolId },
      data: { isActive: true, archivedAt: null },
    });

    if (printerId) {
      try {
        await assignActiveSpoolToPrinter(prisma, printerId, spool.id);
      } catch (err) {
        if (err instanceof AssignSpoolError) {
          return res.status(err.statusCode).json({ error: err.message });
        }
        throw err;
      }
    }

    const printersWithSpool = await prisma.printer.findMany({
      where: { activeSpoolId: spool.id },
      select: { id: true, name: true, activeSpoolId: true },
    });
    const loaded = printersWithSpool[0];
    const payload = {
      ...spool,
      loadedOnPrinter: loaded ? { id: loaded.id, name: loaded.name } : null,
    };

    await publishAllSpooltrackerHASensors();
    res.json(payload);
  } catch (error) {
    logger.error('Failed to activate spool:', error);
    res.status(500).json({ error: 'Failed to activate spool' });
  }
});

export default router;
