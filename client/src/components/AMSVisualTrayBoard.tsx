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
  return slot.spool?.colorHex ?? slot.colorHex ?? null;
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
            </div>
            <div className="ams-tray-visual">
              <div className="ams-tray-level" aria-hidden>
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
                {slot.spool?.name ?? (slot.isEmpty ? 'Empty' : slot.filamentType ?? 'Unassigned')}
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
