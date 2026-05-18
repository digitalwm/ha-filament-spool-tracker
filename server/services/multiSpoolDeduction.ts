import type { PrismaClient, Printer } from '../generated/prisma/client';
import { LOG } from '../utils/logger';
import { fetchHAState, fetchHAStates } from './haState';
import {
  ensureSlotsForUsages,
  findSlotForUsage,
  parsePrintWeightSlotUsages,
  type SlotUsage,
} from './printerSlots';

const logger = LOG('MULTI_SPOOL');

export type MultiSpoolDeductionResult = {
  totalGrams: number;
  usageCount: number;
  deductedCount: number;
  unassignedCount: number;
  primarySpoolId: string | null;
};

function parseTotalGrams(value: string | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(String(value).replace(/g/gi, '').trim());
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export async function readPrintWeightUsages(
  printer: Pick<Printer, 'entityPrefix' | 'haDeviceId' | 'entityPrintWeight'>,
): Promise<{ totalGrams: number | null; usages: SlotUsage[] }> {
  const prefix = printer.entityPrefix || printer.haDeviceId;
  const entityId = printer.entityPrintWeight ?? `sensor.${prefix}_print_weight`;
  let state = await fetchHAState(entityId);
  if (!state) {
    const states = await fetchHAStates();
    state = states.find((s) => s.entity_id.toLowerCase().endsWith('_print_weight')) ?? null;
  }
  if (!state) return { totalGrams: null, usages: [] };
  return {
    totalGrams: parseTotalGrams(state.state),
    usages: parsePrintWeightSlotUsages(state.attributes),
  };
}

export async function applyMultiSpoolDeduction(
  prisma: PrismaClient,
  params: {
    printJobId: string;
    printer: Printer;
    totalGrams: number | null;
    usages: SlotUsage[];
    fallbackSpoolId?: string | null;
    failed?: boolean;
  },
): Promise<MultiSpoolDeductionResult> {
  const existing = await prisma.printJobSpoolUsage.findMany({
    where: { printJobId: params.printJobId },
    orderBy: [{ sourceType: 'asc' }, { amsIndex: 'asc' }, { trayIndex: 'asc' }],
  });
  if (existing.length > 0) {
    if (params.failed) {
      return {
        totalGrams: params.totalGrams ?? existing.reduce((sum, u) => sum + u.gramsUsed, 0),
        usageCount: existing.length,
        deductedCount: 0,
        unassignedCount: existing.filter((u) => !u.spoolId).length,
        primarySpoolId: existing.find((u) => u.spoolId)?.spoolId ?? null,
      };
    }

    let deductedCount = 0;
    let unassignedCount = 0;
    let primarySpoolId: string | null = null;

    for (const usage of existing) {
      if (!usage.spoolId) {
        unassignedCount += 1;
        continue;
      }
      if (!primarySpoolId) primarySpoolId = usage.spoolId;
      if (usage.deductedAt || usage.gramsUsed <= 0) continue;

      const spool = await prisma.spool.findUnique({ where: { id: usage.spoolId } });
      if (!spool) {
        unassignedCount += 1;
        continue;
      }

      const newWeight = Math.max(0, spool.remainingWeight - usage.gramsUsed);
      await prisma.spool.update({
        where: { id: usage.spoolId },
        data: { remainingWeight: newWeight },
      });
      await prisma.printJobSpoolUsage.update({
        where: { id: usage.id },
        data: { deductedAt: new Date() },
      });
      deductedCount += 1;
      logger.info(`Deducted ${usage.gramsUsed}g from "${spool.name}" for ${usage.slotLabel ?? 'AMS slot'}`);
    }

    return {
      totalGrams: params.totalGrams ?? existing.reduce((sum, u) => sum + u.gramsUsed, 0),
      usageCount: existing.length,
      deductedCount,
      unassignedCount,
      primarySpoolId,
    };
  }

  if (params.failed) {
    return {
      totalGrams: params.totalGrams ?? 0,
      usageCount: 0,
      deductedCount: 0,
      unassignedCount: 0,
      primarySpoolId: null,
    };
  }

  const usages = params.usages.filter((u) => u.gramsUsed > 0);
  if (usages.length === 0) {
    return {
      totalGrams: params.totalGrams ?? 0,
      usageCount: 0,
      deductedCount: 0,
      unassignedCount: 0,
      primarySpoolId: null,
    };
  }

  await ensureSlotsForUsages(prisma, params.printer.id, usages);

  let deductedCount = 0;
  let unassignedCount = 0;
  let primarySpoolId: string | null = null;

  for (const usage of usages) {
    const slot = await findSlotForUsage(prisma, params.printer.id, usage);
    const spoolId = slot?.spoolId ?? null;
    if (!primarySpoolId && spoolId) primarySpoolId = spoolId;

    await prisma.printJobSpoolUsage.create({
      data: {
        printJobId: params.printJobId,
        spoolId,
        slotId: slot?.id ?? null,
        sourceType: usage.sourceType,
        amsIndex: usage.amsIndex,
        trayIndex: usage.trayIndex,
        slotLabel: usage.slotLabel,
        gramsUsed: usage.gramsUsed,
        metersUsed: usage.metersUsed ?? null,
        deductedAt: spoolId ? new Date() : null,
      },
    });

    if (spoolId) {
      const spool = await prisma.spool.findUnique({ where: { id: spoolId } });
      if (spool) {
        const newWeight = Math.max(0, spool.remainingWeight - usage.gramsUsed);
        await prisma.spool.update({
          where: { id: spoolId },
          data: { remainingWeight: newWeight },
        });
        deductedCount += 1;
        logger.info(`Deducted ${usage.gramsUsed}g from "${spool.name}" for ${usage.slotLabel}`);
      }
    } else {
      unassignedCount += 1;
    }
  }

  return {
    totalGrams: params.totalGrams ?? usages.reduce((sum, u) => sum + u.gramsUsed, 0),
    usageCount: usages.length,
    deductedCount,
    unassignedCount,
    primarySpoolId,
  };
}
