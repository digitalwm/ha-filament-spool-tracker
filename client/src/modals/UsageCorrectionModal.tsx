import { useState } from 'react';
import type { PrintJob, PrintJobSpoolUsage, Spool } from '@ha-addon/types';
import './Modal.css';

interface UsageCorrectionModalProps {
  job: PrintJob;
  usage: PrintJobSpoolUsage;
  spools: Spool[];
  onCancel: () => void;
  onApply: (data: { gramsUsed: number; spoolId?: string | null }) => void;
}

export default function UsageCorrectionModal({
  job,
  usage,
  spools,
  onCancel,
  onApply,
}: UsageCorrectionModalProps) {
  const [gramsUsed, setGramsUsed] = useState(String(Math.round(usage.gramsUsed * 10) / 10));
  const [spoolId, setSpoolId] = useState(usage.spoolId ?? '');
  const grams = Number(gramsUsed);
  const valid = Number.isFinite(grams) && grams >= 0;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content modal-sm" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">Correct spool usage</h3>
        <p className="modal-message">
          Adjust <strong>{usage.slotLabel ?? 'this slot'}</strong> for <strong>{job.projectName}</strong>.
          Saved spool weight will be corrected automatically when this usage was already deducted.
        </p>
        <div className="form-group">
          <label>Grams used</label>
          <input
            type="number"
            min="0"
            step="0.1"
            value={gramsUsed}
            onChange={(e) => setGramsUsed(e.target.value)}
            autoFocus
          />
        </div>
        <div className="form-group">
          <label>Spool</label>
          <select value={spoolId} onChange={(e) => setSpoolId(e.target.value)}>
            <option value="">Unassigned</option>
            {spools.filter((s) => s.archivedAt === null).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.filamentType}, {Math.round(s.remainingWeight)}g left)
              </option>
            ))}
          </select>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!valid}
            onClick={() => onApply({ gramsUsed: grams, spoolId: spoolId || null })}
          >
            Save correction
          </button>
        </div>
      </div>
    </div>
  );
}
