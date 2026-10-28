import type { PrinterSlot, Spool } from '@ha-addon/types';
import SpoolColorSwatch from './SpoolColorSwatch';
import SpoolSelect from './SpoolSelect';
import './AMSVisualTrayBoard.css';

interface AMSVisualTrayBoardProps {
  slots?: PrinterSlot[];
  spools?: Spool[];
  editable?: boolean;
  compact?: boolean;
  size?: 'compact' | 'normal' | 'large';
  onSlotSpoolChange?: (slot: PrinterSlot, spoolId: string | null) => void;
}

function trayNumber(slot: PrinterSlot): string {
  if (slot.sourceType === 'external') return 'EXT';
  return String((slot.trayIndex ?? 0) + 1);
}

function slotColor(slot: PrinterSlot): string | null {
  return slot.colorHex ?? slot.spool?.colorHex ?? null;
}

function remainingPercent(slot: PrinterSlot): number {
  if (slot.spool && slot.spool.initialWeight > 0) {
    return Math.max(0, Math.min(100, (slot.spool.remainingWeight / slot.spool.initialWeight) * 100));
  }
  if (slot.remainPercent != null && Number.isFinite(slot.remainPercent) && slot.remainPercent >= 0) {
    return Math.max(0, Math.min(100, slot.remainPercent));
  }
  return slot.isEmpty ? 0 : 100;
}

function remainingLabel(slot: PrinterSlot): string {
  if (slot.spool) return `${Math.round(slot.spool.remainingWeight)}g`;
  if (slot.remainPercent != null && Number.isFinite(slot.remainPercent) && slot.remainPercent >= 0) {
    return `${Math.round(slot.remainPercent)}%`;
  }
  return slot.isEmpty ? '0%' : '—';
}

function normalizeHex(value: string | null | undefined): string | null {
  const s = (value ?? '').replace(/^#/, '').slice(0, 6).toLowerCase();
  return s.length === 6 ? s : null;
}

function parseRgb(hex: string | null): { r: number; g: number; b: number } | null {
  if (!hex) return null;
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

function colorDistance(a: string | null, b: string | null): number | null {
  const ca = parseRgb(a);
  const cb = parseRgb(b);
  if (!ca || !cb) return null;
  return Math.sqrt(
    (ca.r - cb.r) ** 2 +
    (ca.g - cb.g) ** 2 +
    (ca.b - cb.b) ** 2,
  );
}

type ColorFamily = 'red' | 'orange' | 'yellow' | 'green' | 'cyan' | 'blue' | 'purple' | 'pink' | 'brown' | 'black' | 'gray' | 'white';

function colorFamilyFromName(value: string | null | undefined): ColorFamily | null {
  const name = (value ?? '').trim().toLowerCase();
  if (!name) return null;
  if (/black|charcoal/.test(name)) return 'black';
  if (/white|ivory|cream/.test(name)) return 'white';
  if (/gray|grey|silver/.test(name)) return 'gray';
  if (/brown|tan|beige|wood/.test(name)) return 'brown';
  if (/red|crimson|scarlet|burgundy|maroon/.test(name)) return 'red';
  if (/orange|copper/.test(name)) return 'orange';
  if (/yellow|gold|amber/.test(name)) return 'yellow';
  if (/green|lime|olive/.test(name)) return 'green';
  if (/cyan|teal|turquoise|aqua/.test(name)) return 'cyan';
  if (/blue|navy|azure/.test(name)) return 'blue';
  if (/purple|violet|magenta/.test(name)) return 'purple';
  if (/pink|rose/.test(name)) return 'pink';
  return null;
}

function colorFamilyFromHex(value: string | null): ColorFamily | null {
  const rgb = parseRgb(value);
  if (!rgb) return null;
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));

  if (saturation < 0.12) {
    if (lightness < 0.18) return 'black';
    if (lightness > 0.88) return 'white';
    return 'gray';
  }

  let hue = 0;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  hue = (hue * 60 + 360) % 360;

  if (hue < 15 || hue >= 345) return 'red';
  if (hue < 45) return 'orange';
  if (hue < 70) return 'yellow';
  if (hue < 165) return 'green';
  if (hue < 200) return 'cyan';
  if (hue < 255) return 'blue';
  if (hue < 300) return 'purple';
  return 'pink';
}

function hasMismatch(slot: PrinterSlot): boolean {
  if (!slot.spool || slot.isEmpty) return false;
  const typeMismatch =
    Boolean(slot.filamentType) &&
    slot.filamentType !== 'Empty' &&
    slot.spool.filamentType.toLowerCase() !== slot.filamentType!.toLowerCase();
  const trayHex = normalizeHex(slot.colorHex);
  const spoolHex = normalizeHex(slot.spool.colorHex);
  const distance = colorDistance(trayHex, spoolHex);
  const detectedFamily = colorFamilyFromHex(trayHex);
  const savedFamily = colorFamilyFromName(slot.spool.color);
  const colorMismatch = detectedFamily && savedFamily
    ? detectedFamily !== savedFamily
    : distance != null && distance > 48;
  return typeMismatch || colorMismatch;
}

export default function AMSVisualTrayBoard({
  slots = [],
  spools = [],
  editable = false,
  compact = false,
  size,
  onSlotSpoolChange,
}: AMSVisualTrayBoardProps) {
  if (slots.length === 0) {
    return <div className="ams-board ams-board-empty">No AMS slots synced</div>;
  }

  return (
    <div className={`ams-board ams-board-${size ?? (compact ? 'compact' : 'normal')}`}>
      {slots.map((slot) => {
        const assigned = Boolean(slot.spoolId);
        const detected = !slot.isEmpty;
        const mismatch = hasMismatch(slot);
        const fillPercent = remainingPercent(slot);
        const fillColor = slotColor(slot) ?? '#6e7681';
        return (
          <div
            key={slot.id}
            className={[
              'ams-tray',
              slot.isActive ? 'ams-tray-active' : '',
              slot.isEmpty ? 'ams-tray-empty' : '',
              detected && !assigned ? 'ams-tray-unassigned' : '',
              mismatch ? 'ams-tray-mismatch' : '',
            ].filter(Boolean).join(' ')}
            style={{
              ['--ams-fill-percent' as string]: `${fillPercent}%`,
              ['--ams-fill-color' as string]: fillColor,
            }}
            title={`${slot.slotLabel}${slot.spool ? ` · ${slot.spool.name}` : ''}`}
          >
            <div className="ams-tray-top">
              <span className="ams-tray-number">{trayNumber(slot)}</span>
              {slot.isActive && <span className="ams-tray-live">Using</span>}
              {!slot.isActive && slot.sourceType === 'external' && <span className="ams-tray-state">Not active</span>}
              {mismatch && <span className="ams-tray-mismatch-label">Check</span>}
            </div>
            <div className="ams-tray-visual">
              <div className="ams-tray-level" title={`${Math.round(fillPercent)}% remaining`} aria-hidden>
                <span />
              </div>
              <div className="ams-tray-spool">
                <SpoolColorSwatch
                  className="ams-tray-swatch"
                  colorHex={slotColor(slot)}
                  colorStyle={slot.spool?.colorStyle ?? 'solid'}
                  colorName={slot.spool?.color ?? slot.filamentType ?? 'Unknown'}
                />
              </div>
            </div>
            <div className="ams-tray-main">
              <span className="ams-tray-name">
                {slot.spool?.name ?? (slot.isEmpty ? 'Empty' : slot.sourceType === 'external' ? 'No spool assigned' : slot.filamentType ?? 'Unassigned')}
              </span>
              <span className="ams-tray-meta">
                {remainingLabel(slot)} left
              </span>
            </div>
            {editable && onSlotSpoolChange && (
              <SpoolSelect
                value={slot.spoolId ?? null}
                onChange={(id) => onSlotSpoolChange(slot, id)}
                spools={spools.filter((s) => s.archivedAt === null)}
                placeholder="Assign spool"
                size="sm"
                aria-label={`Assign spool to ${slot.slotLabel}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
