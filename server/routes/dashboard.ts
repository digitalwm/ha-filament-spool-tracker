import { Router, Request, Response } from 'express';
import { getPrismaClient } from '../database';
import { LOG } from '../utils/logger';
import { fetchEntityState } from '../services/haIntegration';

const logger = LOG('DASHBOARD');
const router: Router = Router();

router.get('/dashboard/stats', async (_req: Request, res: Response) => {
  const prisma = getPrismaClient();
  if (!prisma) return res.status(503).json({ error: 'Database not available' });

  try {
    const lowFilamentThreshold = 100; // grams, TODO: read from settings

    const [totalSpools, activeSpools, registeredPrinters, activePrintJobs, recentPrintJobs, lowFilamentSpools, allSpools, activeSpoolsList, printersList, spoolsList, activeInProgressPrintJobs] =
      await Promise.all([
        prisma.spool.count({ where: { archivedAt: null } }),
        prisma.spool.count({ where: { isActive: true, archivedAt: null } }),
        prisma.printer.count({ where: { isActive: true } }),
        prisma.printJob.count({ where: { status: 'in_progress' } }),
        prisma.printJob.findMany({
          include: { printer: true, spool: true },
          orderBy: { startedAt: 'desc' },
          take: 10,
        }),
        prisma.spool.findMany({
          where: {
            archivedAt: null,
            remainingWeight: { lte: lowFilamentThreshold },
          },
          orderBy: { remainingWeight: 'asc' },
        }),
        prisma.spool.findMany({
          where: { archivedAt: null },
          select: { remainingWeight: true },
        }),
        prisma.spool.findMany({
          where: { isActive: true, archivedAt: null },
          orderBy: { name: 'asc' },
        }),
        prisma.printer.findMany({
          orderBy: { name: 'asc' },
          include: { activeSpool: true },
        }),
        prisma.spool.findMany({
          where: { archivedAt: null },
          select: {
            id: true,
            name: true,
            filamentType: true,
            colorStyle: true,
            color: true,
            colorHex: true,
            remainingWeight: true,
          },
          orderBy: { name: 'asc' },
        }),
        prisma.printJob.findMany({
          where: { status: 'in_progress', printerId: { not: null } },
          include: { printer: true, spool: true },
          orderBy: { startedAt: 'desc' },
        }),
      ]);

    const totalFilamentStock = allSpools.reduce((sum, s) => sum + s.remainingWeight, 0);

    const printerJobLiveMetrics: Record<string, { eta: string | null; filamentGrams: string | null }> = {};
    const token = process.env.SUPERVISOR_TOKEN;
    if (token && activeInProgressPrintJobs.length > 0) {
      const latestByPrinter = new Map<string, (typeof activeInProgressPrintJobs)[0]>();
      for (const j of activeInProgressPrintJobs) {
        if (!j.printerId || !j.printer) continue;
        const prev = latestByPrinter.get(j.printerId);
        if (!prev || j.startedAt > prev.startedAt) latestByPrinter.set(j.printerId, j);
      }
      await Promise.all(
        [...latestByPrinter.entries()].map(async ([printerId, job]) => {
          const printer = job.printer;
          if (!printer) return;
          const prefix = printer.entityPrefix || printer.haDeviceId;
          if (!prefix) return;
          const weightEntity = printer.entityPrintWeight ?? `sensor.${prefix}_print_weight`;
          const remainingEntity = `sensor.${prefix}_remaining_time`;
          const [filamentGrams, eta] = await Promise.all([
            fetchEntityState(weightEntity),
            fetchEntityState(remainingEntity),
          ]);
          printerJobLiveMetrics[printerId] = { eta, filamentGrams };
        }),
      );
    }

    const spoolIdsForPrinter = [...new Set([...lowFilamentSpools.map((s) => s.id), ...activeSpoolsList.map((s) => s.id)])];
    const printersWithSpool = spoolIdsForPrinter.length > 0
      ? await prisma.printer.findMany({
          where: { activeSpoolId: { in: spoolIdsForPrinter } },
          select: { id: true, name: true, activeSpoolId: true },
        })
      : [];
    const loadedOnBySpoolId = Object.fromEntries(
      printersWithSpool
        .filter((p) => p.activeSpoolId != null)
        .map((p) => [p.activeSpoolId!, { id: p.id, name: p.name }])
    );
    const withLoadedOn = (s: { id: string; [k: string]: unknown }[]) =>
      s.map((spool) => ({ ...spool, loadedOnPrinter: loadedOnBySpoolId[spool.id] ?? null }));

    res.json({
      totalSpools,
      activeSpools,
      totalFilamentStock,
      registeredPrinters,
      activePrintJobs,
      lowFilamentAlerts: lowFilamentSpools.length,
      recentPrintJobs,
      lowFilamentSpools: withLoadedOn(lowFilamentSpools),
      activeSpoolsList: withLoadedOn(activeSpoolsList),
      printersList,
      spoolsList,
      activeInProgressPrintJobs,
      printerJobLiveMetrics,
    });
  } catch (error) {
    logger.error('Failed to fetch dashboard stats:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

export default router;
