import { Router, Request, Response } from 'express';
import { getPrismaClient } from '../database';
import { LOG } from '../utils/logger';
import type { PrinterCreateRequest, PrinterUpdateRequest } from '@ha-addon/types';
import { publishAllSpooltrackerHASensors } from '../services/haSensors';
import { assignActiveSpoolToPrinter, AssignSpoolError } from '../services/assignActiveSpool';
import { syncPrinterSlotsFromHA, slotLabel } from '../services/printerSlots';
import { updatePrinterDiscoveredEntities } from '../services/haDiscovery';
import { readPrintWeightUsages } from '../services/multiSpoolDeduction';
import { fetchHAEntityState } from '../services/haState';
import { commitUndeductedUsageRows } from '../services/spoolUsageCommit';

const logger = LOG('PRINTERS');
const router: Router = Router();

function normalizeHex(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.replace(/^#/, '').slice(0, 6).toLowerCase();
}

async function includeSlotSuggestions(prisma: NonNullable<ReturnType<typeof getPrismaClient>>, printers: any[]) {
  const spools = await prisma.spool.findMany({ where: { archivedAt: null } });
  return printers.map((printer) => ({
    ...printer,
    slots: (printer.slots ?? []).map((slot: any) => {
      const suggestions = spools
        .map((spool) => {
          let score = 0;
          if (slot.filamentType && spool.filamentType?.toLowerCase() === slot.filamentType.toLowerCase()) score += 3;
          if (normalizeHex(slot.colorHex) && normalizeHex(spool.colorHex) === normalizeHex(slot.colorHex)) score += 5;
          if (slot.filamentId && spool.manufacturer?.toLowerCase().includes('bambu')) score += 1;
          return { spool, score };
        })
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map((s) => ({ ...s.spool, matchScore: s.score }));
      return { ...slot, suggestedSpools: suggestions };
    }),
  }));
}

router.get('/printers', async (_req: Request, res: Response) => {
  const prisma = getPrismaClient();
  if (!prisma) return res.status(503).json({ error: 'Database not available' });

  try {
    const printers = await prisma.printer.findMany({
      orderBy: { name: 'asc' },
      include: {
        activeSpool: true,
        slots: {
          orderBy: [{ sourceType: 'asc' }, { amsIndex: 'asc' }, { trayIndex: 'asc' }],
          include: { spool: true },
        },
      },
    });
    res.json(await includeSlotSuggestions(prisma, printers));
  } catch (error) {
    logger.error('Failed to fetch printers:', error);
    res.status(500).json({ error: 'Failed to fetch printers' });
  }
});

router.post('/printers', async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  if (!prisma) return res.status(503).json({ error: 'Database not available' });

  try {
    const body: PrinterCreateRequest = req.body;
    type PrinterCreateData = Parameters<typeof prisma.printer.create>[0]['data'];
    const printer = await prisma.printer.create({
      data: {
        name: body.name,
        haDeviceId: body.haDeviceId,
        entityPrefix: body.entityPrefix,
        model: body.model,
        activeSpoolId: body.activeSpoolId ?? undefined,
        entityPrintStatus: body.entityPrintStatus ?? undefined,
        entityTaskName: body.entityTaskName ?? undefined,
        entityPrintWeight: body.entityPrintWeight ?? undefined,
        entityCoverImage: body.entityCoverImage ?? undefined,
        entityPrintStart: body.entityPrintStart ?? undefined,
        entityPrintProgress: body.entityPrintProgress ?? undefined,
      } as unknown as PrinterCreateData,
    });
    res.status(201).json(printer);
  } catch (error) {
    logger.error('Failed to create printer:', error);
    res.status(500).json({ error: 'Failed to create printer' });
  }
});

router.put('/printers/:id', async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  if (!prisma) return res.status(503).json({ error: 'Database not available' });

  const id = req.params.id as string;

  try {
    const body: PrinterUpdateRequest = req.body;

    let printer: Awaited<ReturnType<typeof assignActiveSpoolToPrinter>> | undefined;

    if (body.activeSpoolId !== undefined) {
      printer = await assignActiveSpoolToPrinter(prisma, id, body.activeSpoolId);
    }

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.haDeviceId !== undefined) data.haDeviceId = body.haDeviceId;
    if (body.entityPrefix !== undefined) data.entityPrefix = body.entityPrefix;
    if (body.model !== undefined) data.model = body.model;
    if (body.isActive !== undefined) data.isActive = body.isActive;
    if (body.entityPrintStatus !== undefined) data.entityPrintStatus = body.entityPrintStatus;
    if (body.entityTaskName !== undefined) data.entityTaskName = body.entityTaskName;
    if (body.entityPrintWeight !== undefined) data.entityPrintWeight = body.entityPrintWeight;
    if (body.entityCoverImage !== undefined) data.entityCoverImage = body.entityCoverImage;
    if (body.entityPrintStart !== undefined) data.entityPrintStart = body.entityPrintStart;
    if (body.entityPrintProgress !== undefined) data.entityPrintProgress = body.entityPrintProgress;

    if (Object.keys(data).length > 0) {
      type PrinterUpdateData = Parameters<typeof prisma.printer.update>[0]['data'];
      printer = await prisma.printer.update({
        where: { id },
        data: data as unknown as PrinterUpdateData,
        include: {
          activeSpool: true,
          slots: {
            orderBy: [{ sourceType: 'asc' }, { amsIndex: 'asc' }, { trayIndex: 'asc' }],
            include: { spool: true },
          },
        },
      });
    }

    if (!printer) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    await publishAllSpooltrackerHASensors();
    res.json(printer);
  } catch (error) {
    if (error instanceof AssignSpoolError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    logger.error('Failed to update printer:', error);
    res.status(500).json({ error: 'Failed to update printer' });
  }
});

router.post('/printers/:id/sync-slots', async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  if (!prisma) return res.status(503).json({ error: 'Database not available' });

  try {
    const printer = await prisma.printer.findUnique({ where: { id: req.params.id as string } });
    if (!printer) return res.status(404).json({ error: 'Printer not found' });
    const updatedPrinter = await updatePrinterDiscoveredEntities(prisma, printer);
    const slots = await syncPrinterSlotsFromHA(prisma, updatedPrinter);
    res.json(slots);
  } catch (error) {
    logger.error('Failed to sync printer slots:', error);
    res.status(500).json({ error: 'Failed to sync printer slots' });
  }
});

router.post('/printers/:id/recover-active-print', async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  if (!prisma) return res.status(503).json({ error: 'Database not available' });

  try {
    const printer = await prisma.printer.findUnique({
      where: { id: req.params.id as string },
      include: { slots: true },
    });
    if (!printer) return res.status(404).json({ error: 'Printer not found' });

    const job = await prisma.printJob.findFirst({
      where: { printerId: printer.id, status: 'in_progress' },
      orderBy: { startedAt: 'desc' },
    });
    if (!job) return res.status(404).json({ error: 'No active print job found' });

    const weight = await readPrintWeightUsages(printer);
    const progressRaw = await fetchHAEntityState(printer.entityPrintProgress ?? `sensor.${printer.entityPrefix}_print_progress`);
    const progress = progressRaw == null ? job.progress : Number(String(progressRaw).replace('%', ''));
    const projected = weight.totalGrams != null && Number.isFinite(progress) ? weight.totalGrams * (Math.max(0, Math.min(100, Number(progress))) / 100) : null;
    const existingSum = await prisma.printJobSpoolUsage.aggregate({ where: { printJobId: job.id }, _sum: { gramsUsed: true } });
    const missing = projected == null ? 0 : projected - (existingSum._sum.gramsUsed ?? 0);
    const activeSlot = printer.slots.find((slot) => slot.isActive && slot.spoolId);

    if (activeSlot && missing > 0.01) {
      await prisma.printJobSpoolUsage.upsert({
        where: {
          printJobId_sourceType_amsIndex_trayIndex: {
            printJobId: job.id,
            sourceType: activeSlot.sourceType,
            amsIndex: activeSlot.amsIndex,
            trayIndex: activeSlot.trayIndex,
          },
        },
        create: {
          printJobId: job.id,
          spoolId: activeSlot.spoolId,
          slotId: activeSlot.id,
          sourceType: activeSlot.sourceType,
          amsIndex: activeSlot.amsIndex,
          trayIndex: activeSlot.trayIndex,
          slotLabel: activeSlot.slotLabel ?? slotLabel(activeSlot),
          gramsUsed: missing,
        },
        update: { gramsUsed: { increment: missing }, spoolId: activeSlot.spoolId, slotId: activeSlot.id },
      });
    }

    const committed = await commitUndeductedUsageRows(prisma, job.id);
    res.json({ printJobId: job.id, projectedUsed: projected, missingAdded: Math.max(0, missing), committedRows: committed });
  } catch (error) {
    logger.error('Failed to recover active print:', error);
    res.status(500).json({ error: 'Failed to recover active print' });
  }
});

router.get('/printers/:id/timeline', async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  if (!prisma) return res.status(503).json({ error: 'Database not available' });

  try {
    const printerId = req.params.id as string;
    const [printer, jobs] = await Promise.all([
      prisma.printer.findUnique({ where: { id: printerId }, include: { slots: { include: { spool: true } } } }),
      prisma.printJob.findMany({
        where: { printerId },
        include: { spoolUsages: { include: { spool: true } } },
        orderBy: { startedAt: 'desc' },
        take: 20,
      }),
    ]);
    if (!printer) return res.status(404).json({ error: 'Printer not found' });

    const events = jobs.flatMap((job) => [
      { id: `${job.id}:start`, at: job.startedAt, type: 'print_started', label: `Started ${job.projectName}` },
      ...(job.completedAt ? [{ id: `${job.id}:done`, at: job.completedAt, type: `print_${job.status}`, label: `${job.status}: ${job.projectName}` }] : []),
      ...job.spoolUsages.map((u) => ({
        id: u.id,
        at: u.updatedAt,
        type: u.deductedAt ? 'deducted' : 'usage_pending',
        label: `${u.slotLabel ?? 'Slot'} ${Math.round(u.gramsUsed * 10) / 10}g ${u.spool?.name ?? 'unassigned'}`,
      })),
    ]);

    for (const slot of printer.slots) {
      if (!slot.isEmpty && !slot.spoolId) {
        events.push({
          id: `slot:${slot.id}`,
          at: slot.updatedAt,
          type: 'warning',
          label: `${slot.slotLabel}: filament detected, no spool assigned`,
        });
      }
    }

    res.json(events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 40));
  } catch (error) {
    logger.error('Failed to fetch printer timeline:', error);
    res.status(500).json({ error: 'Failed to fetch printer timeline' });
  }
});

router.put('/printers/:printerId/slots/:slotId', async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  if (!prisma) return res.status(503).json({ error: 'Database not available' });

  try {
    const printerId = req.params.printerId as string;
    const slotId = req.params.slotId as string;
    const spoolId = req.body?.spoolId === null ? null : (typeof req.body?.spoolId === 'string' ? req.body.spoolId : undefined);

    if (spoolId !== undefined && spoolId !== null) {
      const spool = await prisma.spool.findUnique({ where: { id: spoolId } });
      if (!spool) return res.status(404).json({ error: 'Spool not found' });
      if (spool.archivedAt != null) return res.status(400).json({ error: 'Spool is archived' });
    }

    const existing = await prisma.printerSlot.findFirst({ where: { id: slotId, printerId } });
    if (!existing) return res.status(404).json({ error: 'Printer slot not found' });

    const slot = await prisma.printerSlot.update({
      where: { id: slotId },
      data: { ...(spoolId !== undefined ? { spoolId } : {}) },
      include: { spool: true },
    });
    await publishAllSpooltrackerHASensors();
    res.json(slot);
  } catch (error) {
    logger.error('Failed to update printer slot:', error);
    res.status(500).json({ error: 'Failed to update printer slot' });
  }
});

router.delete('/printers/:id', async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  if (!prisma) return res.status(503).json({ error: 'Database not available' });

  try {
    await prisma.printer.delete({ where: { id: req.params.id as string } });
    res.status(204).send();
  } catch (error) {
    logger.error('Failed to delete printer:', error);
    res.status(500).json({ error: 'Failed to delete printer' });
  }
});

export default router;
