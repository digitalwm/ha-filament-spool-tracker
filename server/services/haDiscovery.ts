import type { PrismaClient, Printer } from '../generated/prisma/client';
import { fetchHAStates } from './haState';

export type DiscoveredPrinterEntity = {
  entityId: string;
  deviceId: string;
  deviceName: string;
  model: string | null;
  entities: string[];
  entityPrefix: string;
  entityPrintStatus: string | null;
  entityTaskName: string | null;
  entityPrintWeight: string | null;
  entityCoverImage: string | null;
  entityPrintStart: string | null;
  entityPrintProgress: string | null;
};

type HAState = Awaited<ReturnType<typeof fetchHAStates>>[number];

const ENTITY_SUFFIXES = [
  'active_tray',
  'print_status',
  'print_weight',
  'print_progress',
  'task_name',
  'cover_image',
  'print_start',
  'ams_tray_\\d+',
  'ams_humidity_index',
  'ams_humidity',
  'ams_temperature',
  'externalspool_external_spool',
].join('|');

function isLikelyBambuEntity(state: HAState): boolean {
  const attrs = state.attributes ?? {};
  const entityId = state.entity_id.toLowerCase();
  const manufacturer = String(attrs.manufacturer ?? '').toLowerCase();
  const brand = String(attrs.brand ?? '').toLowerCase();
  const friendlyName = String(attrs.friendly_name ?? '').toLowerCase();
  return (
    entityId.includes('bambu') ||
    manufacturer.includes('bambu') ||
    brand.includes('bambu') ||
    friendlyName.includes('bambu') ||
    new RegExp(`_(${ENTITY_SUFFIXES})$`, 'i').test(entityId)
  );
}

function prefixFromEntityId(entityId: string): string {
  const objectId = entityId.split('.')[1] || entityId;
  return objectId
    .replace(new RegExp(`_(${ENTITY_SUFFIXES})$`, 'i'), '')
    .replace(/_ams_tray_\d+$/i, '') || objectId;
}

function findBySuffix(entities: string[], suffix: string): string | null {
  return entities.find((id) => id.toLowerCase().endsWith(suffix)) ?? null;
}

export async function discoverBambuPrinters(): Promise<DiscoveredPrinterEntity[]> {
  const states = await fetchHAStates();
  const groups = new Map<string, { prefix: string; states: HAState[] }>();

  for (const state of states.filter(isLikelyBambuEntity)) {
    const prefix = prefixFromEntityId(state.entity_id);
    if (!groups.has(prefix)) groups.set(prefix, { prefix, states: [] });
    groups.get(prefix)!.states.push(state);
  }

  return [...groups.values()].filter((group) =>
    group.states.some((state) =>
      /_(active_tray|print_status|print_weight|print_progress|task_name|ams_tray_\d+)$/i.test(state.entity_id),
    ),
  ).map((group) => {
    const entities = group.states.map((s) => s.entity_id).sort();
    const first = group.states[0];
    const firstName = String(first?.attributes?.friendly_name ?? group.prefix);
    const deviceName = firstName.replace(/\s+(Active tray|Print status|Print weight|Print progress|Task name|Cover image)$/i, '') || group.prefix;
    const model = String(first?.attributes?.model ?? '').trim() || null;
    return {
      entityId: entities[0],
      deviceId: group.prefix,
      deviceName,
      model,
      entities,
      entityPrefix: group.prefix,
      entityPrintStatus: findBySuffix(entities, '_print_status'),
      entityTaskName: findBySuffix(entities, '_task_name'),
      entityPrintWeight: findBySuffix(entities, '_print_weight'),
      entityCoverImage: findBySuffix(entities, '_cover_image'),
      entityPrintStart: findBySuffix(entities, '_print_start'),
      entityPrintProgress: findBySuffix(entities, '_print_progress'),
    };
  });
}

export async function updatePrinterDiscoveredEntities(
  prisma: PrismaClient,
  printer: Printer,
): Promise<Printer> {
  const discovered = await discoverBambuPrinters();
  const match =
    discovered.find((d) => d.deviceId === printer.entityPrefix || d.deviceId === printer.haDeviceId) ??
    discovered.find((d) => d.entities.some((id) => id.includes(printer.entityPrefix) || id.includes(printer.haDeviceId))) ??
    (discovered.length === 1 ? discovered[0] : null);

  if (!match) return printer;

  return prisma.printer.update({
    where: { id: printer.id },
    data: {
      haDeviceId: match.deviceId,
      entityPrefix: match.entityPrefix,
      model: printer.model ?? match.model,
      entityPrintStatus: match.entityPrintStatus,
      entityTaskName: match.entityTaskName,
      entityPrintWeight: match.entityPrintWeight,
      entityCoverImage: match.entityCoverImage,
      entityPrintStart: match.entityPrintStart,
      entityPrintProgress: match.entityPrintProgress,
    },
  });
}
