import type { PrismaClient } from '../generated/prisma/client';
import { LOG } from '../utils/logger';

const logger = LOG('SPOOL_USAGE_COMMIT');

export async function commitUsageDelta(
  prisma: PrismaClient,
  params: {
    spoolId: string | null;
    usageRowId?: string;
    grams: number;
    label?: string | null;
  },
): Promise<boolean> {
  if (!params.spoolId || params.grams <= 0) return false;
  const spoolId = params.spoolId;

  return prisma.$transaction(async (tx) => {
    if (params.usageRowId) {
      const row = await tx.printJobSpoolUsage.findUnique({ where: { id: params.usageRowId } });
      if (!row || row.deductedAt) return false;
    }

    const spool = await tx.spool.findUnique({ where: { id: spoolId } });
    if (!spool) return false;

    await tx.spool.update({
      where: { id: spoolId },
      data: { remainingWeight: Math.max(0, spool.remainingWeight - params.grams) },
    });
    const afterWeight = Math.max(0, spool.remainingWeight - params.grams);

    if (params.usageRowId) {
      await tx.printJobSpoolUsage.update({
        where: { id: params.usageRowId },
        data: { deductedAt: new Date() },
      });
    }

    await tx.spoolAuditLog.create({
      data: {
        spoolId,
        usageId: params.usageRowId ?? null,
        action: 'deduct',
        reason: params.label ?? null,
        deltaGrams: -params.grams,
        beforeWeight: spool.remainingWeight,
        afterWeight,
      },
    });

    logger.info(`Committed ${params.grams}g from "${spool.name}" for ${params.label ?? 'AMS slot'}`);
    return true;
  });
}

export async function adjustSpoolWeight(
  prisma: PrismaClient,
  params: {
    spoolId: string;
    deltaGrams: number;
    action: string;
    reason?: string | null;
    printJobId?: string | null;
    usageId?: string | null;
    metadata?: unknown;
  },
): Promise<void> {
  if (params.deltaGrams === 0) return;
  await prisma.$transaction(async (tx) => {
    const spool = await tx.spool.findUnique({ where: { id: params.spoolId } });
    if (!spool) return;
    const afterWeight = Math.max(0, spool.remainingWeight + params.deltaGrams);
    await tx.spool.update({
      where: { id: params.spoolId },
      data: { remainingWeight: afterWeight },
    });
    await tx.spoolAuditLog.create({
      data: {
        spoolId: params.spoolId,
        printJobId: params.printJobId ?? null,
        usageId: params.usageId ?? null,
        action: params.action,
        reason: params.reason ?? null,
        deltaGrams: params.deltaGrams,
        beforeWeight: spool.remainingWeight,
        afterWeight,
        metadataJson: params.metadata == null ? null : JSON.stringify(params.metadata),
      },
    });
  });
}

export async function commitUndeductedUsageRows(
  prisma: PrismaClient,
  printJobId: string,
): Promise<number> {
  const rows = await prisma.printJobSpoolUsage.findMany({
    where: {
      printJobId,
      deductedAt: null,
      spoolId: { not: null },
      gramsUsed: { gt: 0 },
    },
  });

  let committed = 0;
  for (const row of rows) {
    const didCommit = await commitUsageDelta(prisma, {
      spoolId: row.spoolId,
      usageRowId: row.id,
      grams: row.gramsUsed,
      label: row.slotLabel,
    });
    if (didCommit) committed += 1;
  }
  return committed;
}
