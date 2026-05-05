import type { PrintJob } from '@ha-addon/types';
import './Modal.css';

export type SpoolChangeApplyOptions = {
  recoverFilamentFromPreviousSpool: boolean;
  deductFilamentFromNewSpool: boolean;
};

interface PrintJobSpoolChangeConfirmModalProps {
  job: PrintJob;
  newSpoolId: string | null;
  newSpoolLabel: string;
  onCancel: () => void;
  onApply: (options: SpoolChangeApplyOptions) => void;
}

export default function PrintJobSpoolChangeConfirmModal({
  job,
  newSpoolId,
  newSpoolLabel,
  onCancel,
  onApply,
}: PrintJobSpoolChangeConfirmModalProps) {
  const oldName = job.spool?.name ?? 'Previous spool';
  const g = job.filamentUsed != null && job.filamentUsed > 0 ? Math.round(job.filamentUsed) : 0;
  const clearing = newSpoolId == null;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content modal-sm" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">Change linked spool</h3>
        <p className="modal-message">
          <strong>{job.projectName}</strong> is completed with <strong>{g}g</strong> recorded
          {job.spool ? <> on <strong>{oldName}</strong></> : ''}.
          {clearing ? (
            <> You are clearing the spool link.</>
          ) : (
            <> You are switching the link to <strong>{newSpoolLabel}</strong>.</>
          )}
        </p>
        <p className="modal-message print-job-status-confirm-hint">
          Choose how to adjust spool weights. If the wrong spool was deducted, restore weight to the old spool and
          optionally deduct from the correct spool.
        </p>
        <div className="print-job-status-modal-actions">
          {!clearing && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() =>
                onApply({ recoverFilamentFromPreviousSpool: true, deductFilamentFromNewSpool: true })}
            >
              Restore {g}g to {oldName} and deduct {g}g from {newSpoolLabel}
            </button>
          )}
          <button
            type="button"
            className={clearing ? 'btn btn-primary' : 'btn btn-secondary'}
            onClick={() =>
              onApply({ recoverFilamentFromPreviousSpool: true, deductFilamentFromNewSpool: false })}
          >
            Restore {g}g to {oldName} only
          </button>
          {!clearing && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() =>
                onApply({ recoverFilamentFromPreviousSpool: false, deductFilamentFromNewSpool: true })}
            >
              Deduct {g}g from {newSpoolLabel} only
            </button>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() =>
              onApply({ recoverFilamentFromPreviousSpool: false, deductFilamentFromNewSpool: false })}
          >
            Update link only (no weight change)
          </button>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
