import WebSocket from 'ws';
import { getPrismaClient } from '../database';
import { LOG } from '../utils/logger';
import { getHAWebSocketUrl } from '../utils/haUrl';
import { fetchAndCacheCoverImage } from './coverImageCache';
import { isNotificationEnabled, sendNotification } from './notifications';
import { publishAllSpooltrackerHASensors } from './haSensors';
import { fetchHAEntityState, fetchHAEntityValue, fetchHAState, fetchHAStates } from './haState';
import { applyMultiSpoolDeduction, readPrintWeightUsages } from './multiSpoolDeduction';
import { slotLabel, syncPrinterSlotsFromHA, upsertActiveSlotFromHAState, type SlotIdentity, type SlotUsage } from './printerSlots';
import { commitUndeductedUsageRows } from './spoolUsageCommit';

const logger = LOG('HA_INTEGRATION');

let haSocket: WebSocket | null = null;
let messageId = 1;
let isConnected = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconcileTimer: ReturnType<typeof setInterval> | null = null;
let subscriptionId: number | null = null;

type TrackedPrintState = {
  printerId: string | null;
  lastStatus: string;
  printJobId: string | null;
  activeSlot?: SlotIdentity | null;
  lastWeightGrams?: number | null;
};

const trackedPrintStates = new Map<string, TrackedPrintState>();

function nextId(): number {
  return messageId++;
}

export function isHAConnected(): boolean {
  return isConnected;
}

export async function startHAIntegration(): Promise<void> {
  const token = process.env.SUPERVISOR_TOKEN;
  if (!token) {
    logger.info('SUPERVISOR_TOKEN not set — HA integration disabled (development mode)');
    return;
  }

  connect(token);

  if (reconcileTimer) clearInterval(reconcileTimer);
  reconcileTimer = setInterval(() => {
    void (async () => {
      await reconcileActivePrints();
      await reconcileInProgressJobs();
    })();
  }, 60_000);
}

function connect(token: string): void {
  if (haSocket) {
    try { haSocket.close(); } catch { /* ignore */ }
  }

  logger.info('Connecting to Home Assistant WebSocket API...');
  haSocket = new WebSocket(getHAWebSocketUrl());

  haSocket.on('open', () => {
    logger.info('WebSocket connection opened to HA');
  });

  haSocket.on('message', (data: WebSocket.Data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleHAMessage(msg, token);
    } catch (error) {
      logger.error('Failed to parse HA message:', error);
    }
  });

  haSocket.on('close', () => {
    logger.warn('HA WebSocket connection closed');
    isConnected = false;
    subscriptionId = null;
    scheduleReconnect(token);
  });

  haSocket.on('error', (error: Error) => {
    logger.error('HA WebSocket error:', error);
    isConnected = false;
  });
}

function scheduleReconnect(token: string): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    logger.info('Attempting to reconnect to HA...');
    connect(token);
  }, 30000);
}

function send(msg: Record<string, unknown>): void {
  if (haSocket && haSocket.readyState === WebSocket.OPEN) {
    haSocket.send(JSON.stringify(msg));
  }
}

function handleHAMessage(msg: Record<string, unknown>, token: string): void {
  switch (msg.type) {
    case 'auth_required':
      send({ type: 'auth', access_token: token });
      break;

    case 'auth_ok':
      logger.info('Authenticated with Home Assistant');
      isConnected = true;
      subscribeToStateChanges();
      setTimeout(() => {
        void reconcileActivePrints();
      }, 1_000);
      break;

    case 'auth_invalid':
      logger.error('HA authentication failed:', msg.message);
      isConnected = false;
      break;

    case 'event':
      if ((msg as Record<string, unknown>).id === subscriptionId) {
        const event = (msg as { event?: { data?: { entity_id?: string; new_state?: Record<string, unknown>; old_state?: Record<string, unknown> } } }).event;
        if (event?.data) {
          handleStateChange(event.data);
        }
      }
      break;

    case 'result':
      if ((msg as { success?: boolean }).success) {
        logger.debug('HA command succeeded, id:', msg.id);
      } else {
        logger.warn('HA command failed:', msg);
      }
      break;
  }
}

function subscribeToStateChanges(): void {
  const id = nextId();
  subscriptionId = id;
  send({
    id,
    type: 'subscribe_events',
    event_type: 'state_changed',
  });
  logger.info('Subscribed to HA state_changed events');
}

const PRINT_STATUS_STATES = new Set([
  'running', 'printing', 'idle', 'finish', 'finished', 'completed', 'failed', 'offline', 'unknown', 'unavailable',
]);

/** Parse HA progress sensor state (e.g. "42", "42.5", "42%") to 0–100, or null. */
export function parseProgressPercent(value: string | null | undefined): number | null {
  if (value == null) return null;
  const s = String(value).trim().replace(/%/g, '');
  if (s === '' || s === 'unknown' || s === 'unavailable') return null;
  const n = parseFloat(s);
  if (Number.isNaN(n)) return null;
  return Math.min(100, Math.max(0, n));
}

/** Parse print_weight (or similar) HA state to grams for `filamentUsed`, or null. */
export function parseHaFilamentUsedGrams(value: string | null | undefined): number | null {
  if (value == null) return null;
  const s = String(value).trim().replace(/g/gi, '');
  if (s === '' || s === 'unknown' || s === 'unavailable') return null;
  const n = parseFloat(s);
  if (Number.isNaN(n) || n < 0) return null;
  return n;
}

async function handleStateChange(data: {
  entity_id?: string;
  new_state?: Record<string, unknown>;
  old_state?: Record<string, unknown>;
}): Promise<void> {
  const { entity_id, new_state, old_state } = data;
  if (!entity_id || !new_state) return;

  const state = (new_state.state as string)?.toLowerCase();
  const attrs = (new_state.attributes as Record<string, unknown>) ?? {};
  const manufacturer = (attrs.manufacturer as string)?.toLowerCase() ?? '';
  const brand = (attrs.brand as string)?.toLowerCase() ?? '';
  const friendlyName = (attrs.friendly_name as string)?.toLowerCase() ?? '';

  const prefix = entity_id.replace(/^sensor\./, '').replace(/_print_status$/, '');
  const isBambu =
    entity_id.toLowerCase().includes('bambu') ||
    manufacturer.includes('bambu') ||
    brand.includes('bambu') ||
    friendlyName.includes('bambu') ||
    /_(print_status|print_progress|active_tray|ams_tray_\d+)$/i.test(entity_id) ||
    (PRINT_STATUS_STATES.has(state ?? '') && /^(p1|p2|p2s|x1|x1c|a1|a1m|h2|p1s)(_|$)/i.test(prefix));

  if (!isBambu) return;

  if (entity_id.endsWith('_print_status')) {
    logger.debug(`Print status event: entity_id=${entity_id} state=${state} isBambu=${isBambu} prefix=${prefix}`);
    await handlePrintStatusChange(entity_id, new_state, old_state);
    return;
  }

  if (entity_id.endsWith('_print_progress') && entity_id.startsWith('sensor.')) {
    await handlePrintProgressChange(entity_id, new_state, old_state);
    return;
  }

  if (entity_id.endsWith('_active_tray') && entity_id.startsWith('sensor.')) {
    await handleActiveTrayChange(entity_id, new_state);
    return;
  }

  // Heuristic: Bambu filament/material entities changing likely indicate a manual filament change.
  const oldState = (old_state?.state as string | undefined)?.toLowerCase();
  if (oldState === state) return;

  if (/_filament_|_material_|_color_|ams_/i.test(entity_id)) {
    await handleTrayInventoryChange(entity_id);
    await maybeNotifyFilamentChange(prefix);
  }
}

async function findPrinterByPrefix(printerPrefix: string) {
  const prisma = getPrismaClient();
  if (!prisma) return null;
  const printer = await prisma.printer.findFirst({
    where: {
      OR: [
        { entityPrefix: { contains: printerPrefix } },
        { haDeviceId: { contains: printerPrefix } },
      ],
    },
  });
  if (printer) return printer;
  const printers = await prisma.printer.findMany({ where: { isActive: true } });
  return printers.length === 1 ? printers[0] : null;
}

async function handleActiveTrayChange(entityId: string, newState: Record<string, unknown>): Promise<void> {
  const prisma = getPrismaClient();
  if (!prisma) return;

  const printerPrefix = entityId.replace(/^sensor\./, '').replace(/_active_tray$/, '');
  const printer = await findPrinterByPrefix(printerPrefix);
  if (!printer) return;

  await upsertActiveSlotFromHAState(prisma, printer, {
    entity_id: entityId,
    state: String(newState.state ?? ''),
    attributes: (newState.attributes as Record<string, unknown>) ?? {},
  });

  const tracked = trackedPrintStates.get(printerPrefix);
  if (tracked?.printJobId) {
    const currentUsed = await readCurrentPrintUsedGrams(printer, printerPrefix);
    const usage = accumulateTrackedSlotUsage(tracked, currentUsed);
    if (usage) await persistLiveSlotUsage(prisma, printer.id, tracked.printJobId, usage);
    tracked.activeSlot = activeSlotFromAttributes((newState.attributes as Record<string, unknown>) ?? {});
    tracked.lastWeightGrams = currentUsed;
    trackedPrintStates.set(printerPrefix, tracked);
  }

  const activeSlot = await prisma.printerSlot.findFirst({ where: { printerId: printer.id, isActive: true } });
  if (activeSlot && !activeSlot.isEmpty && !activeSlot.spoolId) {
    if (!(await isNotificationEnabled('notify_unassigned_active_tray_enabled'))) return;
    const key = `unassigned_active_tray_notified_${printer.id}_${activeSlot.id}`;
    const last = await prisma.setting.findUnique({ where: { key } });
    const lastAt = last ? Number(last.value) : 0;
    if (!Number.isFinite(lastAt) || Date.now() - lastAt > 30 * 60 * 1000) {
      await sendNotification(
        'Active AMS tray has no spool',
        `${printer.name} is using ${activeSlot.slotLabel}, but no spool is assigned in SpoolTracker.`,
      );
      await prisma.setting.upsert({
        where: { key },
        update: { value: String(Date.now()) },
        create: { key, value: String(Date.now()) },
      });
    }
  }
}

async function handleTrayInventoryChange(entityId: string): Promise<void> {
  const prisma = getPrismaClient();
  if (!prisma) return;
  const normalized = entityId.replace(/^sensor\./, '');
  const printers = await prisma.printer.findMany();
  const printer = printers.find((p) => {
    const prefix = p.entityPrefix || p.haDeviceId;
    return prefix && normalized.toLowerCase().includes(prefix.toLowerCase());
  });
  if (!printer) return;
  await syncPrinterSlotsFromHA(prisma, printer);
}

async function maybeNotifyFilamentChange(printerPrefix: string): Promise<void> {
  const prisma = getPrismaClient();
  if (!prisma) return;

  try {
    const filamentSetting = await prisma.setting.findUnique({ where: { key: 'filament_change_notifications_enabled' } });
    const filamentEnabled = filamentSetting ? filamentSetting.value !== 'false' && filamentSetting.value !== '0' : true;
    if (!filamentEnabled) {
      logger.debug('Filament-change notification suppressed by settings');
      return;
    }

    const printer = await prisma.printer.findFirst({
      where: {
        OR: [
          { entityPrefix: { contains: printerPrefix } },
          { haDeviceId: { contains: printerPrefix } },
        ],
      },
    });
    const name = printer?.name ?? printerPrefix;
    await sendNotification(
      'Filament may have changed',
      `It looks like filament may have changed on printer "${name}". ` +
        'If you switched spools, don’t forget to update the loaded spool in SpoolTracker.'
    );
  } catch (err) {
    logger.error('Failed to send filament-change notification:', err);
  }
}

async function handlePrintProgressChange(
  entityId: string,
  newState: Record<string, unknown>,
  oldState?: Record<string, unknown> | null,
): Promise<void> {
  const prisma = getPrismaClient();
  if (!prisma) return;

  const newRaw = newState.state as string | undefined;
  const oldRaw = oldState?.state as string | undefined;
  if (newRaw === oldRaw) return;

  const pct = parseProgressPercent(newRaw);
  if (pct == null) return;

  const prefix = entityId.replace(/^sensor\./, '').replace(/_print_progress$/, '');

  try {
    let printer = await prisma.printer.findFirst({
      where: {
        OR: [
          { entityPrintProgress: entityId },
          {
            AND: [
              { entityPrintProgress: null },
              { OR: [{ entityPrefix: prefix }, { haDeviceId: prefix }] },
            ],
          },
        ],
      },
    });
    if (!printer) printer = await findPrinterByPrefix(prefix);
    if (!printer) return;

    const job = await prisma.printJob.findFirst({
      where: { printerId: printer.id, status: 'in_progress' },
      orderBy: { startedAt: 'desc' },
    });
    if (!job) return;
    if (!job.projectImage) {
      await cacheCoverImageForJob(prisma, printer, prefix, job.id);
    }

    const weightData = await readPrintWeightUsages(printer);
    const grams = weightData.totalGrams;

    const tracked = trackedPrintStates.get(prefix);
    if (tracked?.printJobId === job.id) {
      const currentUsed = grams != null ? grams * (pct / 100) : null;
      const usage = accumulateTrackedSlotUsage(tracked, currentUsed);
      if (usage) await persistLiveSlotUsage(prisma, printer.id, job.id, usage);
      tracked.lastWeightGrams = currentUsed;
      trackedPrintStates.set(prefix, tracked);
    }

    await prisma.printJob.update({
      where: { id: job.id },
      data: {
        progress: pct,
        ...(grams != null ? { filamentUsed: grams } : {}),
      },
    });
  } catch (err) {
    logger.error('Failed to update print progress from HA:', err);
  }
}

async function handlePrintStatusChange(
  entityId: string,
  newState: Record<string, unknown>,
  oldState?: Record<string, unknown> | null,
): Promise<void> {
  const prisma = getPrismaClient();
  if (!prisma) return;

  const newStatus = (newState.state as string)?.toLowerCase();
  const oldStatus = (oldState?.state as string)?.toLowerCase();

  if (newStatus === oldStatus) return;

  const printerPrefix = entityId.replace(/_print_status$/, '').replace(/^sensor\./, '');

  const isPrinting = newStatus === 'running' || newStatus === 'printing';
  const isFinished = newStatus === 'finish' || newStatus === 'finished' || newStatus === 'completed' || newStatus === 'idle';
  const isFailed = newStatus === 'failed';
  const wasPrinting = oldStatus === 'running' || oldStatus === 'printing';

  if (isPrinting && !wasPrinting) {
    await onPrintStarted(prisma, printerPrefix, entityId);
  } else if ((isFinished || isFailed) && wasPrinting) {
    await onPrintFinished(prisma, printerPrefix, isFailed);
  }
}

/** Same print if HA start time and job startedAt are within this many ms (clock skew). */
const SAME_PRINT_TIME_TOLERANCE_MS = 30 * 1000;

/** Parse HA print start entity state (ISO date string or timestamp) to ms, or null. */
function parsePrintStartMs(value: string | null | undefined): number | null {
  if (value == null || String(value).trim() === '') return null;
  const s = String(value).trim();
  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) return parsed;
  const num = Number(s);
  return Number.isNaN(num) ? null : num;
}

async function cacheCoverImageForJob(
  prisma: NonNullable<ReturnType<typeof getPrismaClient>>,
  printer: { entityCoverImage: string | null; entityPrefix: string; haDeviceId: string },
  printerPrefix: string,
  jobId: string,
): Promise<void> {
  try {
    const coverImageEntity = printer.entityCoverImage ?? `image.${printerPrefix || printer.entityPrefix || printer.haDeviceId}_cover_image`;
    const coverImageHaPath = await fetchEntityValue(coverImageEntity, 'entity_picture');
    if (!coverImageHaPath || !coverImageHaPath.startsWith('/')) return;
    const cachedPath = await fetchAndCacheCoverImage(coverImageHaPath, jobId);
    if (!cachedPath) return;
    await prisma.printJob.update({
      where: { id: jobId },
      data: { projectImage: cachedPath },
    });
  } catch (err) {
    logger.debug('Cover image cache retry failed:', err);
  }
}

async function onPrintStarted(
  prisma: NonNullable<ReturnType<typeof getPrismaClient>>,
  printerPrefix: string,
  _entityId: string,
): Promise<void> {
  try {
    let printer = await prisma.printer.findFirst({
      where: { entityPrefix: { contains: printerPrefix } },
    });
    if (!printer) {
      const activePrinters = await prisma.printer.findMany({ where: { isActive: true } });
      if (activePrinters.length === 1) printer = activePrinters[0];
    }

    if (!printer) {
      printer = await prisma.printer.create({
        data: {
          name: printerPrefix.replace(/_/g, ' '),
          haDeviceId: printerPrefix,
          entityPrefix: printerPrefix,
        },
      });
      logger.info(`Auto-registered printer: ${printer.name}`);
    }

    const taskNameEntity = printer.entityTaskName ?? `sensor.${printerPrefix}_task_name`;
    const printWeightEntity = printer.entityPrintWeight ?? `sensor.${printerPrefix}_print_weight`;
    const coverImageEntity = printer.entityCoverImage ?? `image.${printerPrefix}_cover_image`;
    const printStartEntity = printer.entityPrintStart ?? `sensor.${printerPrefix}_print_start`;
    const printProgressEntity = printer.entityPrintProgress ?? `sensor.${printerPrefix}_print_progress`;
    const projectName = await fetchEntityState(taskNameEntity) || 'Unknown Print';
    const printWeight = await fetchEntityState(printWeightEntity);
    const coverImageHaPath = await fetchEntityValue(coverImageEntity, 'entity_picture');
    const haPrintStartRaw = await fetchEntityState(printStartEntity);
    const haPrintStartMs = parsePrintStartMs(haPrintStartRaw);

    const existingInProgress = await prisma.printJob.findFirst({
      where: { printerId: printer.id, status: 'in_progress' },
      orderBy: { startedAt: 'desc' },
    });

    if (existingInProgress) {
      const existingStartedMs = existingInProgress.startedAt.getTime();
      const samePrintByTime =
        haPrintStartMs != null &&
        Math.abs(haPrintStartMs - existingStartedMs) < SAME_PRINT_TIME_TOLERANCE_MS;
      if (samePrintByTime) {
        if (!existingInProgress.projectImage) {
          await cacheCoverImageForJob(prisma, printer, printerPrefix, existingInProgress.id);
        }
        const activeSlot = await readActiveSlot(printerPrefix);
        const currentUsed = await readCurrentPrintUsedGrams(printer, printerPrefix);
        if (activeSlot && currentUsed != null) {
          await backfillLiveUsageToActiveSlot(prisma, printer.id, existingInProgress.id, activeSlot, currentUsed);
        }
        trackedPrintStates.set(printerPrefix, {
          printerId: printer.id,
          lastStatus: 'in_progress',
          printJobId: existingInProgress.id,
          activeSlot,
          lastWeightGrams: currentUsed,
        });
        logger.debug(`Skipping duplicate job create: same print start time, existing job ${existingInProgress.id}`);
        return;
      }
      if (haPrintStartMs == null) {
        const sameName = (existingInProgress.projectName || '').trim() === (projectName || '').trim();
        const startedRecently = Date.now() - existingStartedMs < 3 * 60 * 1000;
        if (sameName || startedRecently) {
          if (!existingInProgress.projectImage) {
            await cacheCoverImageForJob(prisma, printer, printerPrefix, existingInProgress.id);
          }
          const activeSlot = await readActiveSlot(printerPrefix);
          const currentUsed = await readCurrentPrintUsedGrams(printer, printerPrefix);
          if (activeSlot && currentUsed != null) {
            await backfillLiveUsageToActiveSlot(prisma, printer.id, existingInProgress.id, activeSlot, currentUsed);
          }
          trackedPrintStates.set(printerPrefix, {
            printerId: printer.id,
            lastStatus: 'in_progress',
            printJobId: existingInProgress.id,
            activeSlot,
            lastWeightGrams: currentUsed,
          });
          logger.debug(`Skipping duplicate job create: no print-start entity, using name/recent fallback, job ${existingInProgress.id}`);
          return;
        }
      }
      await prisma.printJob.update({
        where: { id: existingInProgress.id },
        data: { status: 'completed', completedAt: new Date(), progress: 100 },
      });
      logger.info(`Superseded in-progress job ${existingInProgress.id} ("${existingInProgress.projectName}") by new print "${projectName}"`);
    }

    const initialProgress = parseProgressPercent(await fetchEntityState(printProgressEntity));
    const totalGrams = parseHaFilamentUsedGrams(printWeight);

    const job = await prisma.printJob.create({
      data: {
        printerId: printer.id,
        projectName,
        projectImage: null,
        filamentUsed: printWeight ? parseFloat(printWeight) : null,
        status: 'in_progress',
        ...(initialProgress != null ? { progress: initialProgress } : {}),
      },
    });

    if (coverImageHaPath && coverImageHaPath.startsWith('/')) {
      await cacheCoverImageForJob(prisma, printer, printerPrefix, job.id);
    }

    trackedPrintStates.set(printerPrefix, {
      printerId: printer.id,
      lastStatus: 'in_progress',
      printJobId: job.id,
      activeSlot: await readActiveSlot(printerPrefix),
      lastWeightGrams: totalGrams != null && initialProgress != null ? totalGrams * (initialProgress / 100) : 0,
    });
    const tracked = trackedPrintStates.get(printerPrefix);
    if (tracked?.activeSlot && tracked.lastWeightGrams != null && tracked.lastWeightGrams > 0) {
      await backfillLiveUsageToActiveSlot(prisma, printer.id, job.id, tracked.activeSlot, tracked.lastWeightGrams);
    }

    logger.info(`Print started: "${projectName}" on ${printer.name}`);
  } catch (error) {
    logger.error('Failed to log print start:', error);
  }
}

async function onPrintFinished(
  prisma: NonNullable<ReturnType<typeof getPrismaClient>>,
  printerPrefix: string,
  failed: boolean,
): Promise<void> {
  try {
    const tracked = trackedPrintStates.get(printerPrefix);
    let jobId = tracked?.printJobId ?? null;
    const printerId = tracked?.printerId ?? null;

    const status = failed ? 'failed' : 'completed';

    const printerRecord = printerId
      ? await prisma.printer.findUnique({ where: { id: printerId }, include: { activeSpool: true } })
      : await prisma.printer.findFirst({ where: { entityPrefix: { contains: printerPrefix } }, include: { activeSpool: true } });
    const resolvedPrinterRecord = printerRecord ?? await (async () => {
      const activePrinters = await prisma.printer.findMany({ where: { isActive: true }, include: { activeSpool: true } });
      return activePrinters.length === 1 ? activePrinters[0] : null;
    })();

    if (!jobId && resolvedPrinterRecord) {
      // Fallback: find most recent in-progress job for this printer (e.g. after restart or lost WS state).
      const latestJob = await prisma.printJob.findFirst({
        where: { printerId: resolvedPrinterRecord.id, status: 'in_progress' },
        orderBy: { startedAt: 'desc' },
      });
      if (!latestJob) {
        logger.warn(`No tracked or in-progress print job found for printer prefix: ${printerPrefix}`);
        return;
      }
      jobId = latestJob.id;
    }

    if (!jobId) {
      logger.warn(`No tracked print job and no printer record for prefix: ${printerPrefix}`);
      return;
    }
    const printWeightData = resolvedPrinterRecord
      ? await readPrintWeightUsages(resolvedPrinterRecord)
      : { totalGrams: null, usages: [] };
    if (tracked) {
      const usage = accumulateTrackedSlotUsage(tracked, printWeightData.totalGrams);
      if (usage && resolvedPrinterRecord) await persistLiveSlotUsage(prisma, resolvedPrinterRecord.id, jobId, usage);
    }
    const persistedUsages = await prisma.printJobSpoolUsage.findMany({ where: { printJobId: jobId } });
    const trackedUsages: SlotUsage[] = persistedUsages.map((u) => ({
      sourceType: u.sourceType,
      amsIndex: u.amsIndex,
      trayIndex: u.trayIndex,
      slotLabel: u.slotLabel ?? slotLabel({ sourceType: u.sourceType, amsIndex: u.amsIndex, trayIndex: u.trayIndex }),
      gramsUsed: u.gramsUsed,
      metersUsed: u.metersUsed ?? undefined,
    }));
    const usageRows = printWeightData.usages.length > 0 ? printWeightData.usages : trackedUsages;
    const filamentUsed = printWeightData.totalGrams;

    const currentJob = await prisma.printJob.findUnique({ where: { id: jobId }, select: { spoolId: true } });
    const spoolToDeduct = currentJob?.spoolId ?? resolvedPrinterRecord?.activeSpoolId ?? null;

    const job = await prisma.printJob.update({
      where: { id: jobId },
      data: {
        status,
        completedAt: new Date(),
        filamentUsed: filamentUsed ?? undefined,
        progress: failed ? undefined : 100,
        ...(spoolToDeduct != null && currentJob?.spoolId == null ? { spoolId: spoolToDeduct } : {}),
      },
      include: { spool: true },
    });

    const effectiveSpoolId = job.spoolId ?? spoolToDeduct;
    const multiDeduction = resolvedPrinterRecord
      ? await applyMultiSpoolDeduction(prisma, {
          printJobId: job.id,
          printer: resolvedPrinterRecord,
          totalGrams: filamentUsed,
          usages: usageRows,
          fallbackSpoolId: effectiveSpoolId,
          failed,
        })
      : null;

    if (multiDeduction?.primarySpoolId && job.spoolId == null) {
      await prisma.printJob.update({
        where: { id: job.id },
        data: { spoolId: multiDeduction.primarySpoolId },
      });
    }

    const handledBySlotUsage = (multiDeduction?.usageCount ?? 0) > 0;

    if (!handledBySlotUsage && !failed && effectiveSpoolId && filamentUsed) {
      const spool = await prisma.spool.findUnique({ where: { id: effectiveSpoolId } });
      if (spool) {
        const newWeight = Math.max(0, spool.remainingWeight - filamentUsed);
        await prisma.spool.update({
          where: { id: effectiveSpoolId },
          data: { remainingWeight: newWeight },
        });
        logger.info(`Deducted ${filamentUsed}g from spool "${spool.name}" (${newWeight}g remaining)`);

        const settings = await prisma.setting.findUnique({ where: { key: 'low_filament_threshold' } });
        const threshold = settings ? parseFloat(settings.value) : 100;
        if (newWeight <= threshold) {
          await sendNotification(
            `Low Filament: ${spool.name}`,
            `Spool "${spool.name}" has only ${Math.round(newWeight)}g remaining (threshold: ${threshold}g).`,
            'notify_low_filament_enabled',
          );
        }
      }
    }

    if (!effectiveSpoolId && (multiDeduction?.deductedCount ?? 0) === 0) {
      await sendNotification(
        'Unassigned Print Job',
        `Print job "${job.projectName}" completed but has no spool assigned. Assign a spool to printer "${resolvedPrinterRecord?.name ?? 'this printer'}" or to the print job in SpoolTracker.`,
        'notify_unassigned_completed_jobs_enabled',
      );
    }

    trackedPrintStates.delete(printerPrefix);
    logger.info(`Print ${status}: "${job.projectName}"`);

    // Spool remaining weight may have changed; refresh the HA sensor.
    await publishAllSpooltrackerHASensors();
  } catch (error) {
    logger.error('Failed to log print finish:', error);
  }
}

async function reconcileInProgressJobs(): Promise<void> {
  const prisma = getPrismaClient();
  if (!prisma) return;

  try {
    const inProgress = await prisma.printJob.findMany({
      where: { status: 'in_progress', printerId: { not: null } },
      include: { printer: true },
    });

    if (inProgress.length === 0) return;

    for (const job of inProgress) {
      const printer = job.printer;
      if (!printer) continue;
      await commitUndeductedUsageRows(prisma, job.id);
      const prefix = printer.entityPrefix || printer.haDeviceId;
      if (!prefix) continue;
      const statusEntity = printer.entityPrintStatus ?? `sensor.${prefix}_print_status`;
      const status = (await fetchEntityState(statusEntity))?.toLowerCase();
      if (!status) continue;

      const isFinished = status === 'finish' || status === 'finished' || status === 'completed' || status === 'idle';
      const isFailed = status === 'failed';
      if (isFinished || isFailed) {
        logger.info(`Reconciliation: job ${job.id} for printer ${prefix} has HA status "${status}", finalizing.`);
        await onPrintFinished(prisma, prefix, isFailed);
        continue;
      }

      const progressEntity = printer.entityPrintProgress ?? `sensor.${prefix}_print_progress`;
      const weightEntity = printer.entityPrintWeight ?? `sensor.${prefix}_print_weight`;
      const [progressRaw, weightRaw] = await Promise.all([
        fetchEntityState(progressEntity),
        fetchEntityState(weightEntity),
      ]);
      const pct = parseProgressPercent(progressRaw);
      const grams = parseHaFilamentUsedGrams(weightRaw);
      if (!job.projectImage) {
        await cacheCoverImageForJob(prisma, printer, prefix, job.id);
      }
      if (pct != null || grams != null) {
        await prisma.printJob.update({
          where: { id: job.id },
          data: {
            ...(pct != null ? { progress: pct } : {}),
            ...(grams != null ? { filamentUsed: grams } : {}),
          },
        });
      }
    }
  } catch (err) {
    logger.error('Failed to reconcile in-progress jobs from HA status:', err);
  }
}

async function reconcileActivePrints(): Promise<void> {
  const prisma = getPrismaClient();
  if (!prisma) return;

  try {
    const states = await fetchHAStates();
    const runningStatuses = states.filter((s) => {
      const id = s.entity_id.toLowerCase();
      const state = String(s.state ?? '').toLowerCase();
      return id.endsWith('_print_status') && (state === 'running' || state === 'printing');
    });

    for (const statusState of runningStatuses) {
      const prefix = statusState.entity_id.replace(/^sensor\./, '').replace(/_print_status$/, '');
      const printer = await findPrinterByPrefix(prefix);
      if (!printer) continue;

      const existing = await prisma.printJob.findFirst({
        where: { printerId: printer.id, status: 'in_progress' },
        orderBy: { startedAt: 'desc' },
      });
      if (existing) {
        if (!existing.projectImage) {
          await cacheCoverImageForJob(prisma, printer, prefix, existing.id);
        }
        const totalGrams = parseHaFilamentUsedGrams(await fetchEntityState(`sensor.${prefix}_print_weight`));
        const progress = parseProgressPercent(await fetchEntityState(`sensor.${prefix}_print_progress`));
        const activeSlot = await readActiveSlot(prefix);
        const currentUsed = totalGrams != null && progress != null ? totalGrams * (progress / 100) : null;
        if (activeSlot && currentUsed != null) {
          await backfillLiveUsageToActiveSlot(prisma, printer.id, existing.id, activeSlot, currentUsed);
          await commitUndeductedUsageRows(prisma, existing.id);
        }
        trackedPrintStates.set(prefix, {
          printerId: printer.id,
          lastStatus: 'in_progress',
          printJobId: existing.id,
          activeSlot,
          lastWeightGrams: currentUsed,
        });
        continue;
      }

      logger.info(`Reconciliation: HA reports active print for ${prefix}; creating in-progress job.`);
      await onPrintStarted(prisma, prefix, statusState.entity_id);
    }
  } catch (err) {
    logger.error('Failed to reconcile active prints from HA:', err);
  }
}

export async function fetchEntityState(entityId: string): Promise<string | null> {
  return fetchHAEntityState(entityId);
}

function activeSlotFromAttributes(attrs: Record<string, unknown>): SlotIdentity | null {
  const amsRaw = Number(attrs.ams_index);
  const trayRaw = Number(attrs.tray_index);
  if (!Number.isFinite(trayRaw)) return null;
  const sourceType = amsRaw === 255 || /external/i.test(String(attrs.name ?? '')) ? 'external' : 'ams';
  const amsIndex = sourceType === 'external' ? -1 : (Number.isFinite(amsRaw) ? amsRaw : 0);
  const trayIndex = trayRaw;
  return { sourceType, amsIndex, trayIndex, slotLabel: slotLabel({ sourceType, amsIndex, trayIndex }) };
}

async function readActiveSlot(printerPrefix: string): Promise<SlotIdentity | null> {
  const raw = await fetchHAState(`sensor.${printerPrefix}_active_tray`);
  return activeSlotFromAttributes(raw?.attributes ?? {});
}

function accumulateTrackedSlotUsage(
  tracked: TrackedPrintState,
  currentWeightGrams: number | null,
): SlotUsage | null {
  if (!tracked.activeSlot || currentWeightGrams == null || tracked.lastWeightGrams == null) return null;
  const delta = currentWeightGrams - tracked.lastWeightGrams;
  if (!Number.isFinite(delta) || delta <= 0) return null;
  return {
    ...tracked.activeSlot,
    gramsUsed: delta,
  };
}

async function readCurrentPrintUsedGrams(
  printer: NonNullable<Awaited<ReturnType<typeof findPrinterByPrefix>>>,
  printerPrefix: string,
): Promise<number | null> {
  const [weightData, progressRaw] = await Promise.all([
    readPrintWeightUsages(printer),
    fetchEntityState(`sensor.${printerPrefix}_print_progress`),
  ]);
  const progress = parseProgressPercent(progressRaw);
  if (weightData.totalGrams == null || progress == null) return null;
  return weightData.totalGrams * (progress / 100);
}

async function persistLiveSlotUsage(
  prisma: NonNullable<ReturnType<typeof getPrismaClient>>,
  printerId: string,
  printJobId: string,
  usage: SlotUsage,
): Promise<void> {
  if (usage.gramsUsed <= 0) return;

  const slot = await prisma.printerSlot.findUnique({
    where: {
      printerId_sourceType_amsIndex_trayIndex: {
        printerId,
        sourceType: usage.sourceType,
        amsIndex: usage.amsIndex,
        trayIndex: usage.trayIndex,
      },
    },
  });
  const spoolId = slot?.spoolId ?? null;

  const where = {
    printJobId_sourceType_amsIndex_trayIndex: {
      printJobId,
      sourceType: usage.sourceType,
      amsIndex: usage.amsIndex,
      trayIndex: usage.trayIndex,
    },
  };

  await prisma.$transaction(async (tx) => {
    const deductionMode = await tx.setting.findUnique({ where: { key: 'deduction_mode' } });
    const deductDuringPrint = (deductionMode?.value ?? 'during_print') !== 'on_completion';
    const existing = await tx.printJobSpoolUsage.findUnique({ where });
    const undeductedExisting = existing && !existing.deductedAt ? existing.gramsUsed : 0;
    const deductAmount = deductDuringPrint && spoolId ? undeductedExisting + usage.gramsUsed : 0;
    const deductedAt = deductDuringPrint && spoolId ? new Date() : null;

    await tx.printJobSpoolUsage.upsert({
      where,
      create: {
        printJobId,
        spoolId,
        slotId: slot?.id ?? null,
        sourceType: usage.sourceType,
        amsIndex: usage.amsIndex,
        trayIndex: usage.trayIndex,
        slotLabel: usage.slotLabel,
        gramsUsed: usage.gramsUsed,
        deductedAt,
      },
      update: {
        spoolId,
        slotId: slot?.id ?? null,
        slotLabel: usage.slotLabel,
        gramsUsed: { increment: usage.gramsUsed },
        deductedAt,
      },
    });

    if (spoolId && deductAmount > 0) {
      const spool = await tx.spool.findUnique({ where: { id: spoolId } });
      if (spool) {
        await tx.spool.update({
          where: { id: spoolId },
          data: { remainingWeight: Math.max(0, spool.remainingWeight - deductAmount) },
        });
        await tx.spoolAuditLog.create({
          data: {
            spoolId,
            printJobId,
            usageId: existing?.id ?? null,
            action: 'deduct',
            reason: usage.slotLabel,
            deltaGrams: -deductAmount,
            beforeWeight: spool.remainingWeight,
            afterWeight: Math.max(0, spool.remainingWeight - deductAmount),
          },
        });
        logger.info(`Deducted ${deductAmount}g from "${spool.name}" for ${usage.slotLabel}`);
      }
    }
  });
}

async function backfillLiveUsageToActiveSlot(
  prisma: NonNullable<ReturnType<typeof getPrismaClient>>,
  printerId: string,
  printJobId: string,
  activeSlot: SlotIdentity,
  currentUsedGrams: number,
): Promise<void> {
  const aggregate = await prisma.printJobSpoolUsage.aggregate({
    where: { printJobId },
    _sum: { gramsUsed: true },
  });
  const persisted = aggregate._sum.gramsUsed ?? 0;
  const missing = currentUsedGrams - persisted;
  if (!Number.isFinite(missing) || missing <= 0.01) return;
  await persistLiveSlotUsage(prisma, printerId, printJobId, {
    ...activeSlot,
    gramsUsed: missing,
  });
}

/** Fetch state or a specific attribute. attribute "state" or omitted = entity state; else attributes[attribute]. */
async function fetchEntityValue(entityId: string, attribute?: string): Promise<string | null> {
  return fetchHAEntityValue(entityId, attribute);
}

export function stopHAIntegration(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (reconcileTimer) {
    clearInterval(reconcileTimer);
    reconcileTimer = null;
  }
  if (haSocket) {
    try { haSocket.close(); } catch { /* ignore */ }
    haSocket = null;
  }
  isConnected = false;
  logger.info('HA integration stopped');
}
