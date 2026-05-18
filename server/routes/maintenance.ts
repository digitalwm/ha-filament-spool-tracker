import { Router, Request, Response } from 'express';
import { getPrismaClient } from '../database';
import { LOG } from '../utils/logger';
import { updatePrinterDiscoveredEntities } from '../services/haDiscovery';
import { syncPrinterSlotsFromHA } from '../services/printerSlots';
import { commitUndeductedUsageRows } from '../services/spoolUsageCommit';

const logger = LOG('MAINTENANCE');
const router: Router = Router();

router.post('/maintenance/resync-entities', async (_req: Request, res: Response) => {
  const prisma = getPrismaClient();
  if (!prisma) return res.status(503).json({ error: 'Database not available' });
  try {
    const printers = await prisma.printer.findMany();
    let updated = 0;
    for (const printer of printers) {
      const next = await updatePrinterDiscoveredEntities(prisma, printer);
      await syncPrinterSlotsFromHA(prisma, next);
      updated += 1;
    }
    res.json({ updated });
  } catch (error) {
    logger.error('Failed to resync entities:', error);
    res.status(500).json({ error: 'Failed to resync entities' });
  }
});

router.post('/maintenance/commit-pending', async (_req: Request, res: Response) => {
  const prisma = getPrismaClient();
  if (!prisma) return res.status(503).json({ error: 'Database not available' });
  try {
    const jobs = await prisma.printJob.findMany({ where: { status: 'in_progress' }, select: { id: true } });
    let committed = 0;
    for (const job of jobs) committed += await commitUndeductedUsageRows(prisma, job.id);
    res.json({ committed });
  } catch (error) {
    logger.error('Failed to commit pending rows:', error);
    res.status(500).json({ error: 'Failed to commit pending rows' });
  }
});

router.post('/maintenance/clear-stale-jobs', async (_req: Request, res: Response) => {
  const prisma = getPrismaClient();
  if (!prisma) return res.status(503).json({ error: 'Database not available' });
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const result = await prisma.printJob.updateMany({
      where: { status: 'in_progress', updatedAt: { lt: cutoff } },
      data: { status: 'failed', completedAt: new Date() },
    });
    res.json({ updated: result.count });
  } catch (error) {
    logger.error('Failed to clear stale jobs:', error);
    res.status(500).json({ error: 'Failed to clear stale jobs' });
  }
});

router.post('/maintenance/backfill-audit', async (_req: Request, res: Response) => {
  const prisma = getPrismaClient();
  if (!prisma) return res.status(503).json({ error: 'Database not available' });
  try {
    const usages = await prisma.printJobSpoolUsage.findMany({
      where: {
        spoolId: { not: null },
        gramsUsed: { gt: 0 },
        deductedAt: { not: null },
      },
      include: { spool: true },
      orderBy: { deductedAt: 'asc' },
    });

    let created = 0;
    for (const usage of usages) {
      if (!usage.spoolId || !usage.spool) continue;
      const existing = await prisma.spoolAuditLog.findFirst({
        where: { usageId: usage.id, action: { in: ['deduct', 'backfill_deduct'] } },
      });
      if (existing) continue;

      const afterWeight = usage.spool.remainingWeight;
      const beforeWeight = afterWeight + usage.gramsUsed;
      await prisma.spoolAuditLog.create({
        data: {
          spoolId: usage.spoolId,
          printJobId: usage.printJobId,
          usageId: usage.id,
          action: 'backfill_deduct',
          reason: usage.slotLabel,
          deltaGrams: -usage.gramsUsed,
          beforeWeight,
          afterWeight,
          metadataJson: JSON.stringify({ synthetic: true, note: 'Created from existing deducted usage row' }),
          createdAt: usage.deductedAt ?? undefined,
        },
      });
      created += 1;
    }

    res.json({ created });
  } catch (error) {
    logger.error('Failed to backfill audit log:', error);
    res.status(500).json({ error: 'Failed to backfill audit log' });
  }
});

export default router;
