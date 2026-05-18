import type { Prisma, PrismaClient, Printer, PrinterSlot } from '../generated/prisma/client';
import { fetchHAState, fetchHAStates, type HAState } from './haState';
import { LOG } from '../utils/logger';

const logger = LOG('PRINTER_SLOTS');

export type SlotIdentity = {
  sourceType: string;
  amsIndex: number;
  trayIndex: number;
  slotLabel: string;
};

export type SlotUsage = SlotIdentity & {
  gramsUsed: number;
  metersUsed?: number | null;
};

function asString(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

function asNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(String(value).replace(/%|g/gi, '').trim());
  return Number.isFinite(n) ? n : null;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const s = value.toLowerCase();
    if (['true', 'on', 'yes', '1'].includes(s)) return true;
    if (['false', 'off', 'no', '0'].includes(s)) return false;
  }
  return null;
}

function normalizeColor(value: unknown): string | null {
  const s = asString(value);
  if (!s) return null;
  return s.startsWith('#') ? s : `#${s}`;
}

function stableSlotWhere(printerId: string, slot: SlotIdentity) {
  return {
    printerId_sourceType_amsIndex_trayIndex: {
      printerId,
      sourceType: slot.sourceType,
      amsIndex: slot.amsIndex,
      trayIndex: slot.trayIndex,
    },
  };
}

function temporarySpoolName(data: Prisma.PrinterSlotUncheckedCreateInput): string {
  const type = data.filamentType && data.filamentType !== 'Empty' ? data.filamentType : 'Filament';
  return `Unverified ${type} (${data.slotLabel})`;
}

function temporarySpoolRemaining(data: Prisma.PrinterSlotUncheckedCreateInput): number {
  const trayWeight = typeof data.trayWeight === 'number' && data.trayWeight > 0 ? data.trayWeight : 1000;
  const remain = typeof data.remainPercent === 'number' && data.remainPercent >= 0 ? Math.min(100, data.remainPercent) : 100;
  return Math.max(0, trayWeight * (remain / 100));
}

function normalizeTagUid(value: unknown): string | null {
  const tag = asString(value);
  if (!tag) return null;
  return /^0+$/.test(tag) ? null : tag;
}

async function resolveSpoolIdForSlot(
  prisma: PrismaClient,
  printerId: string,
  identity: SlotIdentity,
  data: Prisma.PrinterSlotUncheckedCreateInput,
): Promise<string | null> {
  if (data.isEmpty || !data.tagUid) return null;

  const existingSlot = await prisma.printerSlot.findUnique({ where: stableSlotWhere(printerId, identity), include: { spool: true } });
  if (existingSlot?.spoolId && existingSlot.spool && !existingSlot.spool.isRfidTemporary) {
    if (existingSlot.spool.tagUid && existingSlot.spool.tagUid !== data.tagUid) {
      logger.info(`RFID tag changed in ${identity.slotLabel}; resolving spool by reported tag instead of previous assignment`);
    } else {
      try {
        await prisma.spool.update({
          where: { id: existingSlot.spoolId },
          data: {
            ...(data.tagUid && !existingSlot.spool.tagUid ? { tagUid: data.tagUid } : {}),
            ...(data.filamentId && !existingSlot.spool.filamentId ? { filamentId: data.filamentId } : {}),
          },
        });
      } catch (err) {
        logger.warn('Failed to bind RFID identity to assigned spool:', err);
      }
      return existingSlot.spoolId;
    }
  }

  const known = await prisma.spool.findFirst({ where: { tagUid: data.tagUid, archivedAt: null } });
  if (known) return known.id;

  const created = await prisma.spool.create({
    data: {
      name: temporarySpoolName(data),
      filamentType: data.filamentType && data.filamentType !== 'Empty' ? data.filamentType : 'Other',
      colorStyle: 'solid',
      color: data.colorHex ?? 'Unknown',
      colorHex: data.colorHex ?? null,
      manufacturer: data.filamentId ? 'Bambu Lab' : null,
      initialWeight: typeof data.trayWeight === 'number' && data.trayWeight > 0 ? data.trayWeight : 1000,
      remainingWeight: temporarySpoolRemaining(data),
      diameter: 1.75,
      tagUid: data.tagUid ?? null,
      filamentId: data.filamentId ?? null,
      isRfidTemporary: true,
      notes: 'Automatically created from an unknown AMS RFID tag. Review and validate this spool.',
    },
  });
  logger.info(`Created temporary RFID spool "${created.name}" for ${identity.slotLabel}`);
  return created.id;
}

export function slotLabel(slot: Pick<SlotIdentity, 'sourceType' | 'amsIndex' | 'trayIndex'>): string {
  if (slot.sourceType === 'external') {
    return slot.trayIndex === 1 ? 'External Spool 2' : 'External Spool';
  }
  if (slot.sourceType === 'hotend') {
    return slot.trayIndex >= 0 ? `Hotend ${slot.trayIndex + 1}` : 'Hotend';
  }
  return `AMS ${slot.amsIndex + 1} Tray ${slot.trayIndex + 1}`;
}

function slotFromPrintWeightLabel(label: string): SlotIdentity | null {
  const ams = /^AMS\s+(\d+)\s+Tray\s+(\d+)$/i.exec(label.trim());
  if (ams) {
    const amsIndex = Number(ams[1]) - 1;
    const trayIndex = Number(ams[2]) - 1;
    if (amsIndex >= 0 && trayIndex >= 0) {
      return { sourceType: 'ams', amsIndex, trayIndex, slotLabel: slotLabel({ sourceType: 'ams', amsIndex, trayIndex }) };
    }
  }
  const external = /^External Spool(?:\s+(\d+))?$/i.exec(label.trim());
  if (external) {
    const trayIndex = external[1] ? Math.max(0, Number(external[1]) - 1) : 0;
    return { sourceType: 'external', amsIndex: -1, trayIndex, slotLabel: slotLabel({ sourceType: 'external', amsIndex: -1, trayIndex }) };
  }
  return null;
}

export function parsePrintWeightSlotUsages(attributes: Record<string, unknown> | undefined): SlotUsage[] {
  if (!attributes) return [];
  const usages: SlotUsage[] = [];
  for (const [key, raw] of Object.entries(attributes)) {
    const identity = slotFromPrintWeightLabel(key);
    if (!identity) continue;
    const gramsUsed = asNumber(raw);
    if (gramsUsed == null || gramsUsed <= 0) continue;
    usages.push({ ...identity, gramsUsed });
  }
  return usages;
}

function inferAmsIndexFromEntity(entityId: string, attrs: Record<string, unknown>, fallback: number | null): number | null {
  const explicit = asNumber(attrs.ams_index ?? attrs.amsIndex);
  if (explicit != null) return explicit;
  const m = /(?:^|_)ams[_\s-]*(\d+)(?:_|$)/i.exec(entityId.replace(/^sensor\./, ''));
  if (m) return Math.max(0, Number(m[1]) - 1);
  return fallback;
}

function inferTrayIndexFromEntity(entityId: string, attrs: Record<string, unknown>): number | null {
  const explicit = asNumber(attrs.tray_index ?? attrs.trayIndex);
  if (explicit != null) return explicit;
  const slot = asNumber(attrs.slot);
  if (slot != null) return Math.max(0, slot - 1);
  if (/external[_\s-]*spool|externalspool|vt[_\s-]*tray|virtual/i.test(entityId)) return 0;
  const m = /(?:^|_)tray[_\s-]*(\d+)(?:_|$)/i.exec(entityId.replace(/^sensor\./, ''));
  if (m) return Math.max(0, Number(m[1]) - 1);
  return null;
}

function isTrayLikeState(state: HAState, printer: Printer, requirePrefix = true): boolean {
  const entity = state.entity_id.toLowerCase();
  const prefix = (printer.entityPrefix || printer.haDeviceId).toLowerCase();
  const attrs = state.attributes ?? {};
  if (requirePrefix && !entity.includes(prefix)) return false;
  if (entity.endsWith('_active_tray')) return false;
  if (/external[_\s-]*spool|externalspool|vt[_\s-]*tray|virtual/i.test(entity)) return true;
  if (/tray[_\s-]*\d+/i.test(entity) && /ams|tray/i.test(entity)) return true;
  return attrs.slot != null && (
    attrs.filament_id != null ||
    attrs.tray_uuid != null ||
    attrs.tag_uid != null ||
    attrs.type != null ||
    attrs.color != null
  );
}

function upsertDataFromState(
  printerId: string,
  state: HAState,
  sourceType: string,
  amsIndex: number,
  trayIndex: number,
  activeOverride?: boolean,
): Prisma.PrinterSlotUncheckedCreateInput {
  const attrs = state.attributes ?? {};
  const label = slotLabel({ sourceType, amsIndex, trayIndex });
  const isExternal = sourceType === 'external';
  const isEmpty = isExternal || asBoolean(attrs.empty) || /^empty$/i.test(String(state.state ?? ''));
  return {
    printerId,
    sourceType,
    amsIndex,
    trayIndex,
    slotLabel: label,
    entityId: state.entity_id,
    isActive: activeOverride ?? asBoolean(attrs.active) ?? false,
    isEmpty,
    tagUid: isExternal ? null : normalizeTagUid(attrs.tag_uid),
    trayUuid: isExternal ? null : asString(attrs.tray_uuid),
    filamentId: isExternal ? null : asString(attrs.filament_id),
    filamentType: isExternal ? 'Empty' : asString(attrs.type) ?? (isEmpty ? 'Empty' : asString(state.state)),
    colorHex: isExternal ? null : normalizeColor(attrs.color),
    trayWeight: isExternal ? null : asNumber(attrs.tray_weight),
    remainPercent: isExternal ? null : asNumber(attrs.remain),
  };
}

export async function syncPrinterSlotsFromHA(prisma: PrismaClient, printer: Printer): Promise<PrinterSlot[]> {
  const allStates = await fetchHAStates();
  if (allStates.length === 0) return prisma.printerSlot.findMany({ where: { printerId: printer.id }, include: { spool: true } });

  const activeEntity = `sensor.${printer.entityPrefix || printer.haDeviceId}_active_tray`;
  let activeTrayState = await fetchHAState(activeEntity);
  if (!activeTrayState) {
    activeTrayState = allStates.find((s) => s.entity_id.toLowerCase().endsWith('_active_tray')) ?? null;
  }
  const activeAttrs = activeTrayState?.attributes ?? {};
  const activeAms = activeTrayState ? inferAmsIndexFromEntity(activeTrayState.entity_id, activeAttrs, -1) : null;
  const activeTray = activeTrayState ? inferTrayIndexFromEntity(activeTrayState.entity_id, activeAttrs) : null;

  let candidates = allStates.filter((s) => isTrayLikeState(s, printer));
  if (candidates.length === 0) {
    candidates = allStates.filter((s) => isTrayLikeState(s, printer, false));
  }
  for (const state of candidates) {
    const attrs = state.attributes ?? {};
    const trayIndex = inferTrayIndexFromEntity(state.entity_id, attrs);
    if (trayIndex == null) continue;
    const amsIndex = inferAmsIndexFromEntity(state.entity_id, attrs, 0) ?? 0;
    const sourceType = /external|virtual|vt_tray/i.test(state.entity_id) ? 'external' : 'ams';
    const isActive = sourceType === 'ams' && activeAms === amsIndex && activeTray === trayIndex;
    const data = upsertDataFromState(printer.id, state, sourceType, amsIndex, trayIndex, isActive);
    const identity = { sourceType, amsIndex, trayIndex, slotLabel: data.slotLabel };
    const spoolId = await resolveSpoolIdForSlot(prisma, printer.id, identity, data);
    await prisma.printerSlot.upsert({
      where: stableSlotWhere(printer.id, identity),
      create: { ...data, ...(spoolId ? { spoolId } : {}) },
      update: {
        slotLabel: data.slotLabel,
        entityId: data.entityId,
        ...(spoolId ? { spoolId } : {}),
        isActive: data.isActive,
        isEmpty: data.isEmpty,
        tagUid: data.tagUid,
        trayUuid: data.trayUuid,
        filamentId: data.filamentId,
        filamentType: data.filamentType,
        colorHex: data.colorHex,
        trayWeight: data.trayWeight,
        remainPercent: data.remainPercent,
      },
    });
  }

  return prisma.printerSlot.findMany({
    where: { printerId: printer.id },
    orderBy: [{ sourceType: 'asc' }, { amsIndex: 'asc' }, { trayIndex: 'asc' }],
    include: { spool: true },
  });
}

export async function upsertActiveSlotFromHAState(
  prisma: PrismaClient,
  printer: Printer,
  state: HAState,
): Promise<void> {
  const attrs = state.attributes ?? {};
  const amsIndex = inferAmsIndexFromEntity(state.entity_id, attrs, asNumber(attrs.ams_index)) ?? -1;
  const trayIndex = inferTrayIndexFromEntity(state.entity_id, attrs);
  if (trayIndex == null) return;
  const sourceType = amsIndex === 255 || /external/i.test(String(state.state)) ? 'external' : 'ams';
  const normalizedAms = sourceType === 'external' ? -1 : (amsIndex ?? -1);
  const data = upsertDataFromState(printer.id, state, sourceType, normalizedAms, trayIndex, true);
  const identity = { sourceType, amsIndex: normalizedAms, trayIndex, slotLabel: data.slotLabel };
  const spoolId = await resolveSpoolIdForSlot(prisma, printer.id, identity, data);

  await prisma.$transaction(async (tx) => {
    await tx.printerSlot.updateMany({ where: { printerId: printer.id }, data: { isActive: false } });
    await tx.printerSlot.upsert({
      where: stableSlotWhere(printer.id, identity),
      create: { ...data, ...(spoolId ? { spoolId } : {}) },
      update: {
        slotLabel: data.slotLabel,
        isActive: true,
        ...(spoolId ? { spoolId } : {}),
        entityId: data.entityId,
        tagUid: data.tagUid,
        trayUuid: data.trayUuid,
        filamentId: data.filamentId,
        filamentType: data.filamentType,
        colorHex: data.colorHex,
        trayWeight: data.trayWeight,
        remainPercent: data.remainPercent,
      },
    });
  });
}

export async function findSlotForUsage(
  prisma: PrismaClient,
  printerId: string,
  usage: SlotIdentity,
): Promise<(PrinterSlot & { spool: { id: string; name: string; remainingWeight: number } | null }) | null> {
  return prisma.printerSlot.findUnique({
    where: stableSlotWhere(printerId, usage),
    include: { spool: { select: { id: true, name: true, remainingWeight: true } } },
  });
}

export async function ensureSlotsForUsages(prisma: PrismaClient, printerId: string, usages: SlotIdentity[]): Promise<void> {
  for (const usage of usages) {
    try {
      await prisma.printerSlot.upsert({
        where: stableSlotWhere(printerId, usage),
        create: { printerId, ...usage },
        update: { slotLabel: usage.slotLabel },
      });
    } catch (err) {
      logger.warn('Failed to ensure printer slot:', err);
    }
  }
}
