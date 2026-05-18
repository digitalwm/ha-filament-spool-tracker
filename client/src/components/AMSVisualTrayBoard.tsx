import type { PrinterSlot, Spool } from '@ha-addon/types';
import SpoolColorSwatch from './SpoolColorSwatch';
import SpoolSelect from './SpoolSelect';
import './AMSVisualTrayBoard.css';

interface AMSVisualTrayBoardProps {
  slots?: PrinterSlot[];
  spools?: Spool[];
  editable?: boolean;
  compact?: boolean;
  onSlotSpoolChange?: (slot: PrinterSlot, spoolId: string | null) => void;
}

function trayNumber(slot: PrinterSlot): string {
  if (slot.sourceType === 'external') return 'EXT';
  return String((slot.trayIndex ?? 0) + 1);
}

function slotColor(slot: PrinterSlot): string | null {
  return slot.spool?.colorHex ?? slot.colorHex ?? null;
}

export default function AMSVisualTrayBoard({
  slots = [],
  spools = [],
  editable = false,
  compact = false,
  onSlotSpoolChange,
}: AMSVisualTrayBoardProps) {
  if (slots.length === 0) {
    return <div className="ams-board ams-board-empty">No AMS slots synced</div>;
  }

  return (
    <div className={`ams-board ${compact ? 'ams-board-compact' : ''}`}>
      {slots.map((slot) => {
        const assigned = Boolean(slot.spoolId);
        const detected = !slot.isEmpty;
        return (
          <div
            key={slot.id}
            className={[
              'ams-tray',
              slot.isActive ? 'ams-tray-active' : '',
              slot.isEmpty ? 'ams-tray-empty' : '',
              detected && !assigned ? 'ams-tray-unassigned' : '',
            ].filter(Boolean).join(' ')}
            title={`${slot.slotLabel}${slot.spool ? ` · ${slot.spool.name}` : ''}`}
          >
            <div className="ams-tray-top">
              <span className="ams-tray-number">{trayNumber(slot)}</span>
              {slot.isActive && <span className="ams-tray-live">Using</span>}
            </div>
            <div className="ams-tray-spool">
              <SpoolColorSwatch
                className="ams-tray-swatch"
                colorHex={slotColor(slot)}
                colorStyle={slot.spool?.colorStyle ?? 'solid'}
                colorName={slot.spool?.color ?? slot.filamentType ?? 'Unknown'}
              />
            </div>
            <div className="ams-tray-main">
              <span className="ams-tray-name">
                {slot.spool?.name ?? (slot.isEmpty ? 'Empty' : slot.filamentType ?? 'Unassigned')}
              </span>
              {!compact && (
                <span className="ams-tray-meta">
                  {slot.spool ? `${Math.round(slot.spool.remainingWeight)}g left` : slot.colorHex ?? slot.slotLabel}
                </span>
              )}
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
