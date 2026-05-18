import { Link } from 'react-router-dom';
import type { PrintJob, PrintJobStatus, Spool } from '@ha-addon/types';
import { getApiBaseURL } from '../services/api';
import StatusBadge from './StatusBadge';
import SpoolColorSwatch from './SpoolColorSwatch';
import SpoolSelect from './SpoolSelect';
import './PrintJobCard.css';

const STATUS_SELECT_OPTIONS: { value: PrintJobStatus; label: string }[] = [
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
];

function projectImageSrc(projectImage: string | null): string | undefined {
  if (!projectImage) return undefined;
  if (projectImage.startsWith('http://') || projectImage.startsWith('https://')) return projectImage;
  const base = getApiBaseURL();
  return base.endsWith('/') ? base + projectImage.replace(/^\//, '') : base + (projectImage.startsWith('/') ? projectImage : '/' + projectImage);
}

interface PrintJobCardProps {
  job: PrintJob;
  onAssignSpool?: (job: PrintJob) => void;
  /** When set with `spoolsForReassign`, show a spool dropdown (e.g. Print History) to change the linked spool. */
  onSpoolChange?: (job: PrintJob, newSpoolId: string | null) => void;
  spoolsForReassign?: Spool[];
  onDelete?: (job: PrintJob) => void;
  onComplete?: (job: PrintJob) => void;
  /** When set, status is editable via a dropdown (e.g. Print History). */
  onStatusChange?: (job: PrintJob, nextStatus: PrintJobStatus) => void;
  onUsageCorrect?: (job: PrintJob, usageId: string) => void;
}

export default function PrintJobCard({
  job,
  onAssignSpool,
  onSpoolChange,
  spoolsForReassign,
  onDelete,
  onComplete,
  onStatusChange,
  onUsageCorrect,
}: PrintJobCardProps) {
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  };

  const multiSpoolUsages = (job.spoolUsages ?? []).filter((u) => u.gramsUsed > 0);
  const usageTotal = multiSpoolUsages.reduce((sum, usage) => sum + usage.gramsUsed, 0);
  const usageColors = ['#ffffff', '#111111', '#808080', '#2d6a4f', '#58a6ff', '#f0883e'];

  return (
    <div className="print-job-card">
      <div className="print-job-left">
        {job.projectImage ? (
          <img src={projectImageSrc(job.projectImage)} alt={job.projectName} className="print-job-thumb" />
        ) : (
          <div className="print-job-thumb-placeholder" />
        )}
      </div>
      <div className="print-job-info">
        <div className="print-job-header">
          <h4 className="print-job-name">{job.projectName}</h4>
          <div className="print-job-header-actions">
            {onStatusChange ? (
              <select
                className={`print-job-status-select print-job-status-select--${job.status}`}
                value={job.status}
                onChange={(e) => onStatusChange(job, e.target.value as PrintJobStatus)}
                aria-label="Print job status"
              >
                {STATUS_SELECT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <StatusBadge status={job.status} />
            )}
            {onComplete && job.status === 'in_progress' && !onStatusChange && (
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={() => onComplete(job)}
                title="Mark print as completed"
              >
                Mark completed
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                className="print-job-delete-btn"
                onClick={() => onDelete(job)}
                title="Delete print job"
                aria-label="Delete print job"
              >
                Delete
              </button>
            )}
          </div>
        </div>
        <div className="print-job-meta">
          {job.printer && <span className="meta-item">Printer: {job.printer.name}</span>}
          {job.spool && onSpoolChange && spoolsForReassign && spoolsForReassign.length > 0 ? (
            <span className="meta-item print-job-spool-reassign">
              <div className="print-job-spool-select-wrap">
                <SpoolSelect
                  value={job.spool.id}
                  onChange={(id) => onSpoolChange(job, id)}
                  spools={spoolsForReassign}
                  placeholder="No spool"
                  size="sm"
                  aria-label="Change linked spool"
                />
              </div>
            </span>
          ) : job.spool ? (
            <span className="meta-item">
              <SpoolColorSwatch
                className="spool-dot"
                colorHex={job.spool.colorHex}
                colorStyle={job.spool.colorStyle}
                colorName={job.spool.color}
              />
              <Link to={`/spools/${job.spool.id}`} className="print-job-spool-link">
                {job.spool.name}
              </Link>
            </span>
          ) : (
            job.status === 'completed' && onAssignSpool && (
              <button className="btn btn-secondary btn-sm" onClick={() => onAssignSpool(job)}>
                Assign Spool
              </button>
            )
          )}
          {job.filamentUsed != null && (
            <span className="meta-item">{Math.round(job.filamentUsed)}g used</span>
          )}
          <span className="meta-item meta-date">{formatDate(job.startedAt)}</span>
        </div>
        {multiSpoolUsages.length > 0 && (
          <div className="print-job-usage-list">
            <div className="print-job-usage-stack" title="Per-spool usage split">
              {multiSpoolUsages.map((usage, idx) => (
                <span
                  key={usage.id}
                  style={{
                    width: `${Math.max(4, (usage.gramsUsed / Math.max(usageTotal, 1)) * 100)}%`,
                    background: usage.spool?.colorHex ?? usageColors[idx % usageColors.length],
                  }}
                />
              ))}
            </div>
            <span className="print-job-usage-summary">
              {job.status === 'completed' ? 'Deducted' : 'Tracked'}: {Math.round(usageTotal)}g
            </span>
            {multiSpoolUsages.map((usage) => (
              <span key={usage.id} className="print-job-usage-pill">
                {usage.slotLabel ?? 'Slot'}: {Math.round(usage.gramsUsed)}g
                {usage.spool ? ` · ${usage.spool.name}` : ' · unassigned'}
                {job.status === 'completed' ? (usage.deductedAt ? ' · saved' : ' · pending') : ''}
                {onUsageCorrect && (
                  <button
                    type="button"
                    className="print-job-usage-correct"
                    onClick={() => onUsageCorrect(job, usage.id)}
                  >
                    Correct
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
