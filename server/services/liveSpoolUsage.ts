import type { PrismaClient } from '../generated/prisma/client';
import { fetchHAStates } from './haState';
import { readPrintWeightUsages } from './multiSpoolDeduction';

function parseProgressPercent(value: string | null | undefined): number | null {
  if (value == null) return null;
  const s = String(value).trim().replace(/%/g, '');
  if (s === '' || s === 'unknown' || s === 'unavailable') return null;
  const n = parseFloat(s);
  if (Number.isNaN(n)) return null;
  return Math.min(100, Math.max(0, n));
}

function parseGrams(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const n = Number(String(raw).replace(/g/gi, '').trim());
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export async function getLiveUsedBySpoolId(prisma: PrismaClient): Promise<Record<string, number>> {
  const liveUsedBySpoolId: Record<string, number> = {};
  const activeJobs = await prisma.printJob.findMany({
    where: { status: 'in_progress', printerId: { not: null } },
    include: {
      spoolUsages: true,
      printer: { include: { slots: true } },
    },
  });

  if (activeJobs.length === 0) return liveUsedBySpoolId;

  const allHaStates = await fetchHAStates();

  for (const job of activeJobs) {
    const printer = job.printer;
    if (!printer) continue;

    const printWeight = await readPrintWeightUsages(printer);
    const totalGrams = printWeight.totalGrams ?? job.filamentUsed ?? null;

    let progress = job.progress;
    if (progress == null) {
      const progressState = allHaStates.find((s) => s.entity_id.toLowerCase().endsWith('_print_progress'));
      progress = parseProgressPercent(progressState?.state) ?? null;
    }
    const progressRatio = progress != null ? Math.min(1, Math.max(0, progress / 100)) : 1;
    const projectedUsed = totalGrams != null && totalGrams > 0 ? totalGrams * progressRatio : null;

    if (job.spoolUsages.length > 0) {
      let persistedUsed = 0;
      for (const usage of job.spoolUsages) {
        persistedUsed += usage.gramsUsed;
        if (usage.deductedAt || !usage.spoolId || usage.gramsUsed <= 0) continue;
        liveUsedBySpoolId[usage.spoolId] = (liveUsedBySpoolId[usage.spoolId] ?? 0) + usage.gramsUsed;
      }
      const activeSlot = printer.slots.find((s) => s.isActive && s.spoolId);
      const liveRemainder = projectedUsed != null ? projectedUsed - persistedUsed : 0;
      if (activeSlot?.spoolId && liveRemainder > 0.01) {
        liveUsedBySpoolId[activeSlot.spoolId] = (liveUsedBySpoolId[activeSlot.spoolId] ?? 0) + liveRemainder;
      }
      continue;
    }

    if (totalGrams == null || totalGrams <= 0) continue;

    if (printWeight.usages.length > 0) {
      for (const usage of printWeight.usages) {
        const slot = printer.slots.find(
          (s) =>
            s.sourceType === usage.sourceType &&
            s.amsIndex === usage.amsIndex &&
            s.trayIndex === usage.trayIndex &&
            s.spoolId,
        );
        if (!slot?.spoolId) continue;
        liveUsedBySpoolId[slot.spoolId] = (liveUsedBySpoolId[slot.spoolId] ?? 0) + usage.gramsUsed * progressRatio;
      }
      continue;
    }

    const activeSlot = printer.slots.find((s) => s.isActive && s.spoolId);
    const spoolId = activeSlot?.spoolId ?? job.spoolId ?? printer.activeSpoolId;
    if (!spoolId) continue;
    const used = parseGrams(String(totalGrams)) ?? 0;
    liveUsedBySpoolId[spoolId] = (liveUsedBySpoolId[spoolId] ?? 0) + used * progressRatio;
  }

  return liveUsedBySpoolId;
}
