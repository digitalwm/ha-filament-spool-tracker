import mqtt, { type MqttClient } from 'mqtt';
import { Client as FtpClient } from 'basic-ftp';
import { PassThrough } from 'node:stream';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { getPrismaClient } from '../database';
import type { Printer } from '../generated/prisma/client';
import { LOG } from '../utils/logger';
import { cacheCoverImageBuffer } from './coverImageCache';
import { applyMultiSpoolDeduction } from './multiSpoolDeduction';
import { slotLabel, upsertPrinterSlotFromDirect } from './printerSlots';

const logger = LOG('BAMBU_DIRECT');

export type DirectPrinterStatus = {
  connected: boolean;
  state: string | null;
  progress: number | null;
  remainingMinutes: number | null;
  model: string | null;
  filename: string | null;
  activeSlot: { sourceType: 'ams' | 'external'; amsIndex: number; trayIndex: number } | null;
  filamentGrams: number | null;
  slotUsages: Array<{ sourceType: 'ams' | 'external'; amsIndex: number; trayIndex: number; gramsUsed: number }>;
  canAttributeToActiveSpool: boolean;
  updatedAt: string | null;
};

const emptyStatus = (): DirectPrinterStatus => ({
  connected: false, state: null, progress: null, remainingMinutes: null, model: null,
  filename: null, activeSlot: null, filamentGrams: null, slotUsages: [], canAttributeToActiveSpool: false, updatedAt: null,
});

let client: MqttClient | null = null;
let status: DirectPrinterStatus = emptyStatus();
let configuredPrinterId: string | null = process.env.BAMBU_PRINTER_ID?.trim() || null;
let lastMetadataFile: string | null = null;
let metadataCoverImage: Buffer | null = null;
let metadataBusy = false;
let lastState = '';
let reconnectLoop: ReturnType<typeof setInterval> | null = null;

export function isDirectPrinterId(printerId: string | null | undefined): boolean {
  return Boolean(configuredPrinterId && printerId === configuredPrinterId);
}

export function getDirectPrinterStatus(printerId?: string): DirectPrinterStatus | null {
  if (printerId && !isDirectPrinterId(printerId)) return null;
  return configuredPrinterId ? { ...status, activeSlot: status.activeSlot ? { ...status.activeSlot } : null, slotUsages: [...status.slotUsages] } : null;
}

export async function syncDirectPrinterSlots(printer: Printer): Promise<void> {
  if (!configuredPrinterId || printer.id !== configuredPrinterId || !latestPrint) return;
  await updateSlots(printer, latestPrint);
}

let latestPrint: Record<string, unknown> | null = null;
let metadataFilaments: Array<{ trayInfoId: string | null; type: string | null; color: string | null; gramsUsed: number }> = [];
let reportProcessing = false;
let pendingReport: Record<string, unknown> | null = null;
let lastSlotSignature = '';
let projectedJobId: string | null = null;
let projectedFilename: string | null = null;
let lastProjectedUsage = new Map<string, number>();

export async function startDirectBambuIntegration(): Promise<void> {
  const { host, serial, accessCode, printerId } = directConfig();
  if (!host || !serial || !accessCode || !printerId) {
    logger.info('Direct Bambu integration disabled; set BAMBU_PRINTER_HOST, BAMBU_PRINTER_SERIAL, BAMBU_PRINTER_ACCESS_CODE, and BAMBU_PRINTER_ID to enable it');
    return;
  }
  configuredPrinterId = printerId;
  const prisma = getPrismaClient();
  const printer = prisma ? await prisma.printer.findUnique({ where: { id: printerId } }) : null;
  if (!printer) {
    logger.warn('Direct Bambu integration is configured but BAMBU_PRINTER_ID does not match a registered printer');
    return;
  }
  const url = `mqtts://${host}:8883`;
  const reportTopic = `device/${serial}/report`;
  const requestTopic = `device/${serial}/request`;
  client = mqtt.connect(url, {
    username: 'bblp', password: accessCode, protocolVersion: 4, reconnectPeriod: 5000,
    connectTimeout: 10000, rejectUnauthorized: false,
  });
  client.on('connect', () => {
    status.connected = true;
    logger.info(`Connected to printer MQTT at ${host}`);
    client?.subscribe(reportTopic, (error) => {
      if (error) logger.warn('Could not subscribe to printer reports:', error.message);
      else client?.publish(requestTopic, JSON.stringify({ pushing: { command: 'pushall' } }));
    });
  });
  client.on('reconnect', () => { status.connected = false; });
  client.on('close', () => { status.connected = false; });
  client.on('error', (error) => logger.warn('Printer MQTT error:', error.message));
  client.on('message', (_topic, payload) => {
    try {
      const message = JSON.parse(payload.toString()) as Record<string, unknown>;
      const print = (message.print ?? message) as Record<string, unknown>;
      latestPrint = { ...(latestPrint ?? {}), ...print };
      const nextStatus = statusFromPrint(latestPrint);
      status = {
        ...status,
        ...nextStatus,
        state: nextStatus.state ?? status.state,
        progress: nextStatus.progress ?? status.progress,
        remainingMinutes: nextStatus.remainingMinutes ?? status.remainingMinutes,
        model: nextStatus.model ?? status.model,
        filename: nextStatus.filename ?? status.filename,
        activeSlot: nextStatus.activeSlot ?? (readActiveTrayIndex(latestPrint) === 255 ? null : status.activeSlot),
        connected: true,
        updatedAt: new Date().toISOString(),
      };
      if (metadataFilaments.length > 0) status.slotUsages = mapMetadataFilamentsToSlots(metadataFilaments, latestPrint);
      pendingReport = latestPrint;
      if (!reportProcessing) void drainReportQueue(printer);
    } catch (error) {
      logger.warn('Could not parse printer report:', error instanceof Error ? error.message : error);
    }
  });
  if (reconnectLoop) clearInterval(reconnectLoop);
  reconnectLoop = setInterval(() => {
    if (client?.connected) client.publish(requestTopic, JSON.stringify({ pushing: { command: 'pushall' } }));
  }, 15_000);
}

async function drainReportQueue(printer: Printer): Promise<void> {
  reportProcessing = true;
  try {
    while (pendingReport) {
      const next = pendingReport;
      pendingReport = null;
      try {
        await processReport(printer, next);
      } catch (error) {
        logger.warn('Could not process printer report:', error instanceof Error ? error.message : error);
      }
    }
  } finally {
    reportProcessing = false;
    if (pendingReport) void drainReportQueue(printer);
  }
}

function directConfig() {
  return {
    host: process.env.BAMBU_PRINTER_HOST?.trim(),
    serial: process.env.BAMBU_PRINTER_SERIAL?.trim(),
    accessCode: process.env.BAMBU_PRINTER_ACCESS_CODE?.trim(),
    printerId: process.env.BAMBU_PRINTER_ID?.trim(),
  };
}

function num(value: unknown): number | null {
  const n = Number(value);
  return value == null || value === '' || !Number.isFinite(n) ? null : n;
}

function statusFromPrint(print: Record<string, unknown>): DirectPrinterStatus {
  const ams = print.ams as Record<string, unknown> | undefined;
  const activeRaw = readActiveTrayIndex(print);
  const ext = activeRaw === 254;
  const model = stringValue(print.subtask_name) ?? stringValue(print.gcode_file);
  const filename = stringValue(print.gcode_file);
  return {
    connected: true,
    state: stringValue(print.gcode_state),
    progress: num(print.mc_percent),
    remainingMinutes: num(print.mc_remaining_time),
    model: model?.replace(/\.gcode\.3mf$/i, '').replace(/\.3mf$/i, '') ?? null,
    filename,
    activeSlot: activeRaw == null || activeRaw === 255 ? null : {
      sourceType: ext ? 'external' : 'ams', amsIndex: ext ? -1 : 0, trayIndex: ext ? 0 : activeRaw,
    },
    filamentGrams: status.filamentGrams,
    slotUsages: status.slotUsages,
    canAttributeToActiveSpool: status.canAttributeToActiveSpool,
    updatedAt: new Date().toISOString(),
  };
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function processReport(printer: Printer, print: Record<string, unknown>): Promise<void> {
  const prisma = getPrismaClient();
  if (!prisma) return;
  await updateSlots(printer, print);
  await readMetadata(print);
  const state = String(print.gcode_state ?? '').toUpperCase();
  const running = ['RUNNING', 'PAUSE', 'PREPARE'].includes(state);
  const activeJob = await prisma.printJob.findFirst({ where: { printerId: printer.id, status: 'in_progress' }, orderBy: { startedAt: 'desc' } });
  if (running) {
    const name = status.model ?? 'Unknown Print';
    let job = activeJob;
    if (activeJob) {
      const data = {
        ...(activeJob.projectName !== name ? { projectName: name } : {}),
        ...(status.progress != null && activeJob.progress !== status.progress ? { progress: status.progress } : {}),
        ...(status.filamentGrams != null && activeJob.filamentUsed !== status.filamentGrams ? { filamentUsed: status.filamentGrams } : {}),
      };
      if (Object.keys(data).length > 0) await prisma.printJob.update({ where: { id: activeJob.id }, data });
    } else {
      const activeSlot = await prisma.printerSlot.findFirst({ where: { printerId: printer.id, isActive: true, spoolId: { not: null } } });
      job = await prisma.printJob.create({ data: { printerId: printer.id, spoolId: activeSlot?.spoolId ?? printer.activeSpoolId, projectName: name, status: 'in_progress', progress: status.progress ?? undefined, filamentUsed: status.filamentGrams ?? undefined } });
      logger.info(`Direct printer reports print started: ${name}`);
    }
    if (job && !job.projectImage && metadataCoverImage) {
      const projectImage = cacheCoverImageBuffer(job.id, metadataCoverImage);
      if (projectImage) {
        await prisma.printJob.update({ where: { id: job.id }, data: { projectImage } });
        job.projectImage = projectImage;
        logger.info(`Cached active printer model preview for ${name}`);
      }
    }
    if (job) await persistProjectedUsage(prisma, printer, job.id, status.progress ?? 0);
  } else if (activeJob && ['FINISH', 'FAILED', 'IDLE'].includes(state)) {
    const failed = state === 'FAILED';
    if (!failed) await persistProjectedUsage(prisma, printer, activeJob.id, 100);
    const job = await prisma.printJob.update({
      where: { id: activeJob.id },
      data: { status: failed ? 'failed' : 'completed', completedAt: new Date(), progress: failed ? undefined : 100, filamentUsed: status.filamentGrams ?? activeJob.filamentUsed ?? undefined },
    });
    await applyMultiSpoolDeduction(prisma, { printJobId: job.id, printer, totalGrams: status.filamentGrams, usages: [], fallbackSpoolId: printer.activeSpoolId, failed });
    projectedJobId = null;
    projectedFilename = null;
    lastProjectedUsage.clear();
    logger.info(`Direct printer print ${failed ? 'failed' : 'completed'}: ${job.projectName}`);
  }
  if (state !== lastState) {
    lastState = state;
    if (!running && state === 'IDLE') status.remainingMinutes = 0;
  }
}

async function persistProjectedUsage(
  prisma: NonNullable<ReturnType<typeof getPrismaClient>>,
  printer: Printer,
  printJobId: string,
  progress: number,
): Promise<void> {
  if (status.filamentGrams == null || status.slotUsages.length === 0) return;
  const filename = status.filename;
  if (projectedJobId !== printJobId || (filename && projectedFilename && filename !== projectedFilename)) {
    projectedJobId = printJobId;
    projectedFilename = filename;
    lastProjectedUsage = new Map(status.slotUsages.map((usage) => [
      `${usage.sourceType}:${usage.amsIndex}:${usage.trayIndex}`,
      usage.gramsUsed * Math.max(0, Math.min(100, progress)) / 100,
    ]));
    return;
  }
  if (filename) projectedFilename = filename;
  const next = new Map<string, number>();
  for (const usage of status.slotUsages) {
    const key = `${usage.sourceType}:${usage.amsIndex}:${usage.trayIndex}`;
    const projected = usage.gramsUsed * Math.max(0, Math.min(100, progress)) / 100;
    const delta = projected - (lastProjectedUsage.get(key) ?? 0);
    if (delta > 0.01) await persistDirectUsageDelta(prisma, printer.id, printJobId, usage, delta);
    next.set(key, projected);
  }
  lastProjectedUsage = next;
}

async function persistDirectUsageDelta(
  prisma: NonNullable<ReturnType<typeof getPrismaClient>>,
  printerId: string,
  printJobId: string,
  usage: DirectPrinterStatus['slotUsages'][number],
  gramsUsed: number,
): Promise<void> {
  const identity = { printerId_sourceType_amsIndex_trayIndex: { printerId, sourceType: usage.sourceType, amsIndex: usage.amsIndex, trayIndex: usage.trayIndex } };
  const slot = await prisma.printerSlot.findUnique({ where: identity });
  const spoolId = slot?.spoolId ?? null;
  const label = usage.sourceType === 'external' ? 'External Spool' : `AMS ${usage.amsIndex + 1} Tray ${usage.trayIndex + 1}`;
  await prisma.$transaction(async (tx) => {
    const mode = await tx.setting.findUnique({ where: { key: 'deduction_mode' } });
    const deductDuringPrint = (mode?.value ?? 'during_print') !== 'on_completion';
    const where = { printJobId_sourceType_amsIndex_trayIndex: { printJobId, sourceType: usage.sourceType, amsIndex: usage.amsIndex, trayIndex: usage.trayIndex } };
    const existing = await tx.printJobSpoolUsage.findUnique({ where });
    const previouslyUndeducted = existing && !existing.deductedAt ? existing.gramsUsed : 0;
    const deductAmount = deductDuringPrint && spoolId ? previouslyUndeducted + gramsUsed : 0;
    const deductedAt = deductDuringPrint && spoolId ? new Date() : null;
    await tx.printJobSpoolUsage.upsert({
      where,
      create: {
        printJobId, spoolId, slotId: slot?.id ?? null,
        sourceType: usage.sourceType, amsIndex: usage.amsIndex, trayIndex: usage.trayIndex,
        slotLabel: slot?.slotLabel ?? slotLabel({ sourceType: usage.sourceType, amsIndex: usage.amsIndex, trayIndex: usage.trayIndex }), gramsUsed, deductedAt,
      },
      update: { spoolId, slotId: slot?.id ?? null, slotLabel: slot?.slotLabel ?? label, gramsUsed: { increment: gramsUsed }, deductedAt },
    });
    if (spoolId && deductAmount > 0) {
      const spool = await tx.spool.findUnique({ where: { id: spoolId } });
      if (!spool) return;
      const remainingWeight = Math.max(0, spool.remainingWeight - deductAmount);
      await tx.spool.update({ where: { id: spoolId }, data: { remainingWeight } });
      await tx.spoolAuditLog.create({
        data: {
          spoolId, printJobId, action: 'deduct', reason: label,
          deltaGrams: -deductAmount, beforeWeight: spool.remainingWeight, afterWeight: remainingWeight,
        },
      });
    }
  });
}

function extractTrays(print: Record<string, unknown>): Array<{ amsIndex: number; trayIndex: number; tray: Record<string, unknown> }> {
  const ams = print.ams as Record<string, unknown> | undefined;
  const groups = Array.isArray(ams?.ams) ? ams.ams : Array.isArray(ams) ? ams : [];
  const trays: Array<{ amsIndex: number; trayIndex: number; tray: Record<string, unknown> }> = [];
  for (let ai = 0; ai < groups.length; ai++) {
    const group = groups[ai] as Record<string, unknown>;
    const groupId = num(group.id) ?? ai;
    const contents = Array.isArray(group.tray) ? group.tray : [];
    for (let ti = 0; ti < contents.length; ti++) {
      const tray = contents[ti] as Record<string, unknown>;
      trays.push({ amsIndex: groupId, trayIndex: num(tray.id) ?? ti, tray });
    }
  }
  return trays;
}

async function updateSlots(printer: Printer, print: Record<string, unknown>): Promise<void> {
  const prisma = getPrismaClient();
  if (!prisma) return;
  const ams = print.ams as Record<string, unknown> | undefined;
  const activeIndex = readActiveTrayIndex(print);
  const trays = extractTrays(print);
  const slotSignature = JSON.stringify([
    activeIndex,
    trays.map(({ amsIndex, trayIndex, tray }) => ({
      amsIndex, trayIndex,
      state: tray.state,
      type: tray.tray_type,
      materialId: tray.tray_info_idx,
      tag: tray.tag_uid,
      uuid: tray.tray_uuid,
      color: tray.tray_color,
      weight: tray.tray_weight,
      remain: tray.remain,
    })),
  ]);
  if (slotSignature === lastSlotSignature) return;
  lastSlotSignature = slotSignature;
  await prisma.printerSlot.updateMany({ where: { printerId: printer.id }, data: { isActive: false } });
  for (const item of trays) {
    const type = stringValue(item.tray.tray_type);
    const empty = !type || /^empty$/i.test(type);
    const isActive = item.amsIndex === 0 && item.trayIndex === activeIndex;
    await upsertPrinterSlotFromDirect(prisma, printer, {
      sourceType: 'ams', amsIndex: item.amsIndex, trayIndex: item.trayIndex, active: isActive, empty,
      tagUid: stringValue(item.tray.tag_uid), trayUuid: stringValue(item.tray.tray_uuid),
      filamentId: stringValue(item.tray.tray_info_idx), filamentType: type,
      colorHex: stringValue(item.tray.tray_color), trayWeight: num(item.tray.tray_weight), remainPercent: num(item.tray.remain),
    });
  }
  if (activeIndex === 254) {
    await upsertPrinterSlotFromDirect(prisma, printer, { sourceType: 'external', amsIndex: -1, trayIndex: 0, active: true, empty: false, filamentType: 'External' });
  }
}

/**
 * The printer reports the loaded tray in the nested AMS status. Some firmware
 * also sends a top-level `print.tray_now` value which can be stale or refer to
 * a different tray context. Prefer the AMS-reported value when present so an
 * attached AMS spool is not shown as the external spool.
 */
function readActiveTrayIndex(print: Record<string, unknown>): number | null {
  const ams = print.ams as Record<string, unknown> | undefined;
  const nested = num(ams?.tray_now);
  const root = num(print.tray_now);
  const reported = [nested, root];

  // A valid AMS tray index is stronger evidence than a conflicting sentinel
  // from the other report field. A1 reports 254 for external and 255 for none.
  const amsTray = reported.find((value) => value != null && value >= 0 && value <= 253);
  if (amsTray != null) return amsTray;
  if (reported.includes(254)) return 254;
  if (reported.includes(255)) return 255;
  return null;
}

async function readMetadata(print: Record<string, unknown>): Promise<void> {
  const filename = stringValue(print.gcode_file);
  if (!filename || !filename.toLowerCase().endsWith('.3mf') || filename === lastMetadataFile || metadataBusy) return;
  metadataCoverImage = null;
  const { host, accessCode } = directConfig();
  if (!host || !accessCode) return;
  metadataBusy = true;
  try {
    const ftp = new FtpClient(12000);
    ftp.ftp.verbose = false;
    let bytes: Buffer | null = null;
    try {
      await ftp.access({ host, port: 990, user: 'bblp', password: accessCode, secure: 'implicit', secureOptions: { rejectUnauthorized: false } });
      const safeFilename = path.posix.basename(filename);
      for (const remotePath of [`/cache/${safeFilename}`, `/${safeFilename}`]) {
        const stream = new PassThrough();
        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        try {
          await ftp.downloadTo(stream, remotePath);
          bytes = Buffer.concat(chunks);
          break;
        } catch {
          // Printers differ on whether the active sliced project is stored in cache or root.
          stream.destroy();
        }
      }
      if (!bytes) throw new Error('Active sliced 3MF was not found in printer cache or root');
    } finally {
      ftp.close();
    }
    const zip = unzipSync(bytes);
    const thumbnailPaths = [
      'Metadata/plate_1.png',
      'Metadata/bbl_thumbnail.png',
      'Auxiliaries/.thumbnails/thumbnail_middle.png',
      'Auxiliaries/.thumbnails/thumbnail_3mf.png',
      'Auxiliaries/.thumbnails/thumbnail_small.png',
    ];
    const thumbnail = thumbnailPaths.map((thumbnailPath) => zip[thumbnailPath]).find((entry) => entry && entry.length > 0);
    metadataCoverImage = thumbnail ? Buffer.from(thumbnail) : null;
    const configEntry = zip['Metadata/slice_info.config'];
    if (!configEntry) throw new Error('slice_info.config missing from printer 3MF');
    const xml = Buffer.from(configEntry).toString('utf8');
    const filaments: typeof metadataFilaments = [];
    for (const match of xml.matchAll(/<filament\b([^>]+)\/?\s*>/gi)) {
      const attrs = Object.fromEntries([...match[1].matchAll(/([\w_]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
      const grams = num(attrs.used_g);
      if (grams == null || grams <= 0) continue;
      filaments.push({ trayInfoId: stringValue(attrs.tray_info_idx), type: stringValue(attrs.type), color: stringValue(attrs.color), gramsUsed: grams });
    }
    metadataFilaments = filaments;
    status.filamentGrams = filaments.reduce((sum, filament) => sum + filament.gramsUsed, 0) || null;
    status.canAttributeToActiveSpool = filaments.length === 1;
    status.slotUsages = mapMetadataFilamentsToSlots(filaments, latestPrint);
    lastMetadataFile = filename;
    logger.info(`Read sliced filament estimate from printer cache for ${filename}`);
    if (!metadataCoverImage) logger.info(`No model preview image was embedded in ${filename}`);
  } catch (error) {
    logger.warn('Could not read filament estimate from printer cache:', error instanceof Error ? error.message : error);
  } finally {
    metadataBusy = false;
  }
}

function mapMetadataFilamentsToSlots(
  filaments: typeof metadataFilaments,
  print: Record<string, unknown> | null,
): DirectPrinterStatus['slotUsages'] {
  if (!print) return [];
  const trays = extractTrays(print);
  const result: DirectPrinterStatus['slotUsages'] = [];
  for (const filament of filaments) {
    const trayId = filament.trayInfoId?.toLowerCase();
    const wantedColor = filament.color?.replace(/^#/, '').slice(0, 6).toLowerCase();
    let candidates = trayId ? trays.filter((item) => stringValue(item.tray.tray_info_idx)?.toLowerCase() === trayId) : [];
    if (candidates.length !== 1 && wantedColor) {
      candidates = trays.filter((item) => stringValue(item.tray.tray_color)?.replace(/^#/, '').slice(0, 6).toLowerCase() === wantedColor);
      if (filament.type) candidates = candidates.filter((item) => stringValue(item.tray.tray_type)?.toLowerCase() === filament.type?.toLowerCase());
    }
    if (candidates.length !== 1) continue;
    const item = candidates[0];
    result.push({ sourceType: 'ams', amsIndex: item.amsIndex, trayIndex: item.trayIndex, gramsUsed: filament.gramsUsed });
  }
  return result;
}
