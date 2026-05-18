export {
  SPOOL_COLOR_STYLES,
  SPOOL_COLOR_STYLE_OPTIONS,
  normalizeSpoolColorStyle,
  getSpoolColorStyleLabel,
} from './spoolColorStyle';
export type { SpoolColorStyle } from './spoolColorStyle';

// ── Data Models ──

export interface Printer {
  id: string;
  name: string;
  haDeviceId: string;
  entityPrefix: string;
  model: string | null;
  isActive: boolean;
  activeSpoolId: string | null;
  entityPrintStatus: string | null;
  entityTaskName: string | null;
  entityPrintWeight: string | null;
  entityCoverImage: string | null;
  entityPrintStart: string | null;
  entityPrintProgress: string | null;
  createdAt: string;
  updatedAt: string;
  activeSpool?: Spool | null;
  slots?: PrinterSlot[];
  /** Dashboard-preferred spool: active AMS/feed slot spool when available, else legacy activeSpool. */
  displaySpool?: Spool | null;
  displaySlot?: PrinterSlot | null;
}

export interface PrinterSlot {
  id: string;
  printerId: string;
  spoolId: string | null;
  sourceType: string;
  amsIndex: number;
  trayIndex: number;
  slotLabel: string;
  entityId: string | null;
  isActive: boolean;
  isEmpty: boolean | null;
  tagUid: string | null;
  trayUuid: string | null;
  filamentId: string | null;
  filamentType: string | null;
  colorHex: string | null;
  trayWeight: number | null;
  remainPercent: number | null;
  createdAt: string;
  updatedAt: string;
  spool?: Spool | null;
  suggestedSpools?: Array<Spool & { matchScore?: number }>;
}

export interface PrinterTimelineEvent {
  id: string;
  at: string;
  type: string;
  label: string;
}

export interface Spool {
  id: string;
  name: string;
  filamentType: string;
  /** How the color swatch is drawn in the UI (solid, wood grain, multicolor ring, etc.). */
  colorStyle: string;
  color: string;
  colorHex: string | null;
  manufacturer: string | null;
  initialWeight: number;
  remainingWeight: number;
  spoolWeight: number | null;
  diameter: number;
  isActive: boolean;
  archivedAt: string | null;
  expirationDate: string | null;
  purchaseDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  /** Set when this spool is the active (loaded) spool on a printer. */
  loadedOnPrinter?: { id: string; name: string } | null;
  /** Temporary grams pending commit to remainingWeight; normally 0 because print deltas are saved immediately. */
  liveFilamentUsed?: number;
  /** Temporary projected remaining grams only when there is pending, not-yet-committed usage. */
  liveRemainingWeight?: number;
}

export interface SpoolAuditLog {
  id: string;
  spoolId: string;
  printJobId: string | null;
  usageId: string | null;
  action: string;
  reason: string | null;
  deltaGrams: number;
  beforeWeight: number;
  afterWeight: number;
  metadataJson: string | null;
  createdAt: string;
}

export interface PrintJob {
  id: string;
  printerId: string | null;
  spoolId: string | null;
  projectName: string;
  projectImage: string | null;
  filamentUsed: number | null;
  status: PrintJobStatus;
  startedAt: string;
  completedAt: string | null;
  progress: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  printer?: Printer | null;
  spool?: Spool | null;
  spoolUsages?: PrintJobSpoolUsage[];
}

export interface PrintJobSpoolUsage {
  id: string;
  printJobId: string;
  spoolId: string | null;
  slotId: string | null;
  sourceType: string;
  amsIndex: number;
  trayIndex: number;
  slotLabel: string | null;
  gramsUsed: number;
  metersUsed: number | null;
  deductedAt: string | null;
  createdAt: string;
  updatedAt: string;
  spool?: Spool | null;
  slot?: PrinterSlot | null;
}

export type PrintJobStatus = 'in_progress' | 'completed' | 'failed' | 'cancelled';

export type FilamentType = 'PLA' | 'PETG' | 'TPU' | 'ABS' | 'ASA' | 'Nylon' | 'PC' | 'PVA' | 'HIPS' | 'Other';

// ── API Request Types ──

export interface SpoolCreateRequest {
  name: string;
  filamentType: string;
  colorStyle?: string;
  color: string;
  colorHex?: string;
  manufacturer?: string;
  initialWeight: number;
  remainingWeight?: number;
  spoolWeight?: number;
  diameter?: number;
  expirationDate?: string;
  purchaseDate?: string;
  notes?: string;
}

export interface SpoolUpdateRequest extends Partial<SpoolCreateRequest> {
  isActive?: boolean;
}

export interface DeductionRequest {
  amount: number;
  reason?: string;
}

export interface PrinterCreateRequest {
  name: string;
  haDeviceId: string;
  entityPrefix: string;
  model?: string;
  activeSpoolId?: string | null;
  entityPrintStatus?: string | null;
  entityTaskName?: string | null;
  entityPrintWeight?: string | null;
  entityCoverImage?: string | null;
  entityPrintStart?: string | null;
  entityPrintProgress?: string | null;
}

export interface PrinterUpdateRequest extends Partial<PrinterCreateRequest> {
  isActive?: boolean;
  activeSpoolId?: string | null;
}

export interface PrintJobCreateRequest {
  projectName: string;
  printerId?: string | null;
  spoolId?: string | null;
  projectImage?: string | null;
  filamentUsed?: number | null;
  status?: PrintJobStatus;
  notes?: string | null;
}

export interface PrintJobUpdateRequest {
  spoolId?: string | null;
  status?: PrintJobStatus;
  notes?: string;
  progress?: number | null;
  /** When marking completed: set true to skip subtracting `filamentUsed` from the linked spool. */
  skipFilamentDeduction?: boolean;
  /** When leaving `completed`: set true to add `filamentUsed` back to the linked spool (undo deduction). */
  restoreFilament?: boolean;
  /** When changing `spoolId` on an already-completed job: add `filamentUsed` back to the previously linked spool. */
  recoverFilamentFromPreviousSpool?: boolean;
  /** When changing `spoolId` on an already-completed job: subtract `filamentUsed` from the newly linked spool. */
  deductFilamentFromNewSpool?: boolean;
}

export interface SettingsUpdateRequest {
  [key: string]: string;
}

// ── API Response Types ──

export interface DashboardStats {
  totalSpools: number;
  activeSpools: number;
  totalFilamentStock: number;
  registeredPrinters: number;
  activePrintJobs: number;
  lowFilamentAlerts: number;
  recentPrintJobs: PrintJob[];
  lowFilamentSpools: Spool[];
  activeSpoolsList: Spool[];
  /** Printers with activeSpool for dashboard "loaded spool" quick update */
  printersList: Printer[];
  /** Non-archived spools for loaded-spool dropdowns */
  spoolsList: Pick<Spool, 'id' | 'name' | 'filamentType' | 'colorStyle' | 'color' | 'colorHex' | 'remainingWeight' | 'liveRemainingWeight'>[];
  /** In-progress jobs (for dashboard); includes printer and spool when linked */
  activeInProgressPrintJobs: PrintJob[];
  /** Live HA strings keyed by `printerId` (ETA / current print weight) */
  printerJobLiveMetrics: Record<string, { eta: string | null; filamentGrams: string | null }>;
  deductionMode: 'during_print' | 'on_completion' | string;
  dashboardWarnings: Array<{
    type: 'unassigned_active_tray';
    printerId: string;
    printerName: string;
    slotId: string;
    slotLabel: string;
  }>;
}

export interface HAConnectionStatus {
  connected: boolean;
  printerCount: number;
}

export interface HADiscoveredEntity {
  entityId: string;
  deviceId: string;
  deviceName: string;
  model: string | null;
  entities: string[];
  entityPrefix?: string;
  entityPrintStatus?: string | null;
  entityTaskName?: string | null;
  entityPrintWeight?: string | null;
  entityCoverImage?: string | null;
  entityPrintStart?: string | null;
  entityPrintProgress?: string | null;
}

export interface HealthStatus {
  status: string;
  timestamp: string;
  uptime: number;
  database: {
    connected: boolean;
  };
}

export interface AppSettings {
  [key: string]: string;
}
