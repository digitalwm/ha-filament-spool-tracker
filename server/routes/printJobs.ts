import { Router, Request, Response } from 'express';
import { getPrismaClient } from '../database';
import { LOG } from '../utils/logger';
import { getCoverImagePath, deleteCachedCoverImage } from '../services/coverImageCache';
import type { PrintJobCreateRequest, PrintJobUpdateRequest } from '@ha-addon/types';
import { adjustSpoolWeight } from '../services/spoolUsageCommit';

const logger = LOG('PRINT_JOBS');
const router: Router = Router();

router.get('/print-jobs/:id/cover', (req: Request, res: Response) => {
  const id = typeof req.params.id === 'string' ? req.params.id : (Array.isArray(req.params.id) ? req.params.id[0] : '');
  const entry = getCoverImagePath(id);
  if (!entry) {
    return res.status(404).json({ error: 'Cover image not found' });
  }
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.type(entry.contentType);
  res.sendFile(entry.filePath, (err) => {
    if (err && !res.headersSent) {
      logger.warn('Failed to send cover image:', err);
      res.status(500).json({ error: 'Failed to serve cover image' });
    }
  });
});

router.post('/print-jobs', async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  if (!prisma) return res.status(503).json({ error: 'Database not available' });

  try {
    const body: PrintJobCreateRequest = req.body;
    const projectName = (body.projectName ?? '').trim();
    if (!projectName) {
      return res.status(400).json({ error: 'projectName is required' });
    }

    const status = body.status ?? 'in_progress';
    const job = await prisma.printJob.create({
      data: {
        projectName,
        printerId: body.printerId ?? null,
        spoolId: body.spoolId ?? null,
        projectImage: body.projectImage ?? null,
        filamentUsed: body.filamentUsed ?? null,
        status,
        notes: body.notes ?? null,
        completedAt: status !== 'in_progress' ? new Date() : null,
        progress: status === 'completed' ? 100 : status === 'failed' || status === 'cancelled' ? null : undefined,
      },
      include: { printer: true, spool: true, spoolUsages: { include: { spool: true, slot: true } } },
    });

    if (status === 'completed' && job.spoolId && job.filamentUsed != null && job.filamentUsed > 0) {
      const spool = await prisma.spool.findUnique({ where: { id: job.spoolId } });
      if (spool) {
        await prisma.spool.update({
          where: { id: job.spoolId },
          data: { remainingWeight: Math.max(0, spool.remainingWeight - job.filamentUsed) },
        });
      }
    }

    res.status(201).json(job);
  } catch (error) {
    logger.error('Failed to create print job:', error);
    res.status(500).json({ error: 'Failed to create print job' });
  }
});

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

router.get('/print-jobs', async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  if (!prisma) return res.status(503).json({ error: 'Database not available' });

  try {
    const { printerId, spoolId, status, limit, offset } = req.query;
    const where: Record<string, unknown> = {};

    if (printerId) where.printerId = printerId as string;
    if (spoolId) where.spoolId = spoolId as string;
    if (status) where.status = status as string;

    const take = limit ? Math.min(parseInt(limit as string, 10), MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
    const skip = offset ? Math.max(0, parseInt(offset as string, 10)) : 0;

    const printJobs = await prisma.printJob.findMany({
      where,
      include: { printer: true, spool: true, spoolUsages: { include: { spool: true, slot: true } } },
      orderBy: { startedAt: 'desc' },
      skip,
      take,
    });
    res.json(printJobs);
  } catch (error) {
    logger.error('Failed to fetch print jobs:', error);
    res.status(500).json({ error: 'Failed to fetch print jobs' });
  }
});

router.get('/print-jobs/:id', async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  if (!prisma) return res.status(503).json({ error: 'Database not available' });

  try {
    const job = await prisma.printJob.findUnique({
      where: { id: req.params.id as string },
      include: { printer: true, spool: true, spoolUsages: { include: { spool: true, slot: true } } },
    });
    if (!job) return res.status(404).json({ error: 'Print job not found' });
    res.json(job);
  } catch (error) {
    logger.error('Failed to fetch print job:', error);
    res.status(500).json({ error: 'Failed to fetch print job' });
  }
});

router.put('/print-jobs/:jobId/usages/:usageId', async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  if (!prisma) return res.status(503).json({ error: 'Database not available' });

  try {
    const gramsUsed = Number(req.body?.gramsUsed);
    const spoolId = req.body?.spoolId === null ? null : (typeof req.body?.spoolId === 'string' ? req.body.spoolId : undefined);
    if (!Number.isFinite(gramsUsed) || gramsUsed < 0) {
      return res.status(400).json({ error: 'gramsUsed must be a non-negative number' });
    }

    const usage = await prisma.printJobSpoolUsage.findFirst({
      where: { id: req.params.usageId as string, printJobId: req.params.jobId as string },
    });
    if (!usage) return res.status(404).json({ error: 'Usage row not found' });

    const nextSpoolId = spoolId !== undefined ? spoolId : usage.spoolId;
    if (nextSpoolId) {
      const spool = await prisma.spool.findUnique({ where: { id: nextSpoolId } });
      if (!spool) return res.status(404).json({ error: 'Spool not found' });
    }

    if (usage.deductedAt) {
      if (usage.spoolId) {
        await adjustSpoolWeight(prisma, {
          spoolId: usage.spoolId,
          deltaGrams: usage.gramsUsed,
          action: 'usage_correction_restore',
          reason: usage.slotLabel,
          printJobId: usage.printJobId,
          usageId: usage.id,
        });
      }
      if (nextSpoolId) {
        await adjustSpoolWeight(prisma, {
          spoolId: nextSpoolId,
          deltaGrams: -gramsUsed,
          action: 'usage_correction_deduct',
          reason: usage.slotLabel,
          printJobId: usage.printJobId,
          usageId: usage.id,
        });
      }
    }

    const updated = await prisma.printJobSpoolUsage.update({
      where: { id: usage.id },
      data: {
        gramsUsed,
        ...(spoolId !== undefined ? { spoolId: nextSpoolId } : {}),
        deductedAt: usage.deductedAt ? new Date() : null,
      },
      include: { spool: true, slot: true },
    });
    res.json(updated);
  } catch (error) {
    logger.error('Failed to correct print usage:', error);
    res.status(500).json({ error: 'Failed to correct print usage' });
  }
});

router.put('/print-jobs/:id', async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  if (!prisma) return res.status(503).json({ error: 'Database not available' });

  try {
    const body: PrintJobUpdateRequest = req.body;
     // Load existing job so we can detect transitions (e.g. in_progress -> completed, or spool assigned later).
    const existing = await prisma.printJob.findUnique({
      where: { id: req.params.id as string },
    });
    if (!existing) {
      return res.status(404).json({ error: 'Print job not found' });
    }

    const data: Record<string, unknown> = {};

    if (body.spoolId !== undefined) data.spoolId = body.spoolId;
    if (body.status !== undefined) data.status = body.status;
    if (body.notes !== undefined) data.notes = body.notes;

    if (body.status !== undefined) {
      if (body.status === 'in_progress') {
        data.completedAt = null;
      } else if (body.status === 'completed' || body.status === 'failed' || body.status === 'cancelled') {
        data.completedAt = new Date();
      }
    }

    if (body.progress !== undefined) {
      data.progress = body.progress;
    } else if (body.status !== undefined) {
      if (body.status === 'completed') {
        data.progress = 100;
      } else if (body.status === 'failed' || body.status === 'cancelled') {
        data.progress = null;
      } else if (body.status === 'in_progress' && existing.status === 'completed') {
        data.progress = null;
      }
    }

    const job = await prisma.printJob.update({
      where: { id: req.params.id as string },
      data,
      include: { printer: true, spool: true, spoolUsages: { include: { spool: true, slot: true } } },
    });

    const leavingCompleted =
      existing.status === 'completed' &&
      body.status !== undefined &&
      body.status !== 'completed';
    const shouldRestore =
      body.restoreFilament === true &&
      leavingCompleted &&
      existing.spoolId &&
      existing.filamentUsed != null &&
      existing.filamentUsed > 0;

    if (shouldRestore && existing.spoolId && existing.filamentUsed != null) {
      const addBack = existing.filamentUsed;
      const spool = await prisma.spool.findUnique({ where: { id: existing.spoolId } });
      if (spool) {
        await prisma.spool.update({
          where: { id: existing.spoolId },
          data: { remainingWeight: spool.remainingWeight + addBack },
        });
      }
    }

    const transitionedToCompleted =
      body.status === 'completed' && existing.status !== 'completed';
    const newlyAssignedSpool =
      body.spoolId !== undefined && body.spoolId != null && existing.spoolId == null;
    const skipDeduct = body.skipFilamentDeduction === true;

    const shouldDeduct =
      !skipDeduct &&
      job.spoolId &&
      job.filamentUsed != null &&
      job.filamentUsed > 0 &&
      (
        (transitionedToCompleted && job.spoolId != null) ||
        (newlyAssignedSpool && job.status === 'completed')
      );

    if (shouldDeduct) {
      const spool = await prisma.spool.findUnique({ where: { id: job.spoolId! } });
      if (spool) {
        await prisma.spool.update({
          where: { id: job.spoolId! },
          data: { remainingWeight: Math.max(0, spool.remainingWeight - job.filamentUsed!) },
        });
      }
    }

    const gUsed = existing.filamentUsed != null && existing.filamentUsed > 0 ? existing.filamentUsed : 0;
    const spoolIdChanged =
      body.spoolId !== undefined &&
      String(existing.spoolId ?? '') !== String(job.spoolId ?? '');
    const completedSpoolReassigned =
      existing.status === 'completed' && gUsed > 0 && spoolIdChanged;

    if (completedSpoolReassigned) {
      if (body.recoverFilamentFromPreviousSpool === true && existing.spoolId) {
        const prev = await prisma.spool.findUnique({ where: { id: existing.spoolId } });
        if (prev) {
          await prisma.spool.update({
            where: { id: existing.spoolId },
            data: { remainingWeight: prev.remainingWeight + gUsed },
          });
        }
      }
      if (body.deductFilamentFromNewSpool === true && job.spoolId && job.spoolId !== existing.spoolId) {
        const nextSpool = await prisma.spool.findUnique({ where: { id: job.spoolId } });
        if (nextSpool) {
          await prisma.spool.update({
            where: { id: job.spoolId },
            data: { remainingWeight: Math.max(0, nextSpool.remainingWeight - gUsed) },
          });
        }
      }
    }

    res.json(job);
  } catch (error) {
    logger.error('Failed to update print job:', error);
    res.status(500).json({ error: 'Failed to update print job' });
  }
});

router.delete('/print-jobs/:id', async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  if (!prisma) return res.status(503).json({ error: 'Database not available' });

  const jobId = req.params.id as string;
  try {
    await prisma.printJob.delete({ where: { id: jobId } });
    deleteCachedCoverImage(jobId);
    res.status(204).send();
  } catch (error) {
    logger.error('Failed to delete print job:', error);
    res.status(500).json({ error: 'Failed to delete print job' });
  }
});

export default router;
