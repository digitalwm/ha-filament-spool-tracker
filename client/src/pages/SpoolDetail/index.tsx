import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { spoolsApi, printJobsApi } from '@services/api';
import type { Spool, PrintJob, SpoolCreateRequest, SpoolAuditLog } from '@ha-addon/types';
import PrintJobCard from '@components/PrintJobCard';
import SpoolColorSwatch from '@components/SpoolColorSwatch';
import SpoolMetaBadges from '@components/SpoolMetaBadges';
import ProgressBar from '@components/ProgressBar';
import AddEditSpoolModal from '@modals/AddEditSpoolModal';
import DeductFilamentModal from '@modals/DeductFilamentModal';
import ConfirmModal from '@modals/ConfirmModal';
import './index.css';

export default function SpoolDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [spool, setSpool] = useState<Spool | null>(null);
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [auditLogs, setAuditLogs] = useState<SpoolAuditLog[]>([]);
  const [auditFilter, setAuditFilter] = useState('all');
  const [expandedAuditId, setExpandedAuditId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeductModal, setShowDeductModal] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const [spoolRes, jobsRes, auditRes] = await Promise.all([
          spoolsApi.getById(id),
          printJobsApi.getAll({ spoolId: id, limit: 100 }),
          spoolsApi.getAudit(id),
        ]);
        if (cancelled) return;
        setSpool(spoolRes.data);
        setJobs(jobsRes.data);
        setAuditLogs(auditRes.data);
      } catch {
        if (!cancelled) setError('Failed to load spool');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    return () => { cancelled = true; };
  }, [id]);

  if (loading && !spool) {
    return (
      <div className="spool-detail-page">
        <div className="loading-container"><div className="spinner" /><p>Loading...</p></div>
      </div>
    );
  }

  if (error || !spool) {
    return (
      <div className="spool-detail-page">
        <p className="spool-detail-error">{error || 'Spool not found'}</p>
        <button className="btn btn-secondary" onClick={() => navigate('/spools')}>Back to Spools</button>
      </div>
    );
  }

  const handleSaveEdit = async (data: SpoolCreateRequest) => {
    if (!spool) return;
    try {
      const updated = await spoolsApi.update(spool.id, {
        ...data,
        ...(spool.isRfidTemporary ? { isRfidTemporary: false } : {}),
      });
      setSpool(updated.data);
      setShowEditModal(false);
    } catch (err) {
      console.error('Failed to update spool:', err);
    }
  };

  const handleDeduct = async (amount: number, _reason: string) => {
    if (!spool) return;
    try {
      const updated = await spoolsApi.deduct(spool.id, { amount });
      setSpool(updated.data);
      setShowDeductModal(false);
    } catch (err) {
      console.error('Failed to deduct filament:', err);
    }
  };

  const handleArchive = async () => {
    if (!spool) return;
    try {
      await spoolsApi.archive(spool.id);
      setConfirmArchive(false);
      navigate('/spools');
    } catch (err) {
      console.error('Failed to archive spool:', err);
    }
  };

  const handleUndoAudit = async (log: SpoolAuditLog) => {
    if (!spool) return;
    try {
      await spoolsApi.undoAudit(spool.id, log.id);
      const [spoolRes, auditRes] = await Promise.all([spoolsApi.getById(spool.id), spoolsApi.getAudit(spool.id)]);
      setSpool(spoolRes.data);
      setAuditLogs(auditRes.data);
    } catch (err) {
      console.error('Failed to undo audit entry:', err);
    }
  };

  const displayRemaining = spool.liveRemainingWeight ?? spool.remainingWeight;
  const remainingPercent = spool.initialWeight > 0 ? Math.max(0, Math.min(100, (displayRemaining / spool.initialWeight) * 100)) : 0;
  const isActive = spool.isActive || !!spool.loadedOnPrinter;
  const formatDate = (dateStr: string | null) => dateStr ? new Date(dateStr).toLocaleDateString() : 'Not set';
  const formatMetadata = (metadataJson: string) => {
    try {
      return JSON.stringify(JSON.parse(metadataJson), null, 2);
    } catch {
      return metadataJson;
    }
  };

  return (
    <div className="spool-detail-page">
      <nav className="spool-detail-breadcrumb">
        <button type="button" className="breadcrumb-link" onClick={() => navigate('/spools')}>
          ← Spools
        </button>
      </nav>

      <div className="spool-detail-header">
        <SpoolColorSwatch
          className="spool-detail-dot"
          colorHex={spool.colorHex}
          colorStyle={spool.colorStyle}
          colorName={spool.color}
        />
        <div className="spool-detail-info">
          <div className="spool-detail-title-row">
            <h1 className="spool-detail-name">{spool.name}</h1>
            {spool.isRfidTemporary ? (
              <span className="spool-detail-review-badge" title={spool.tagUid ? `RFID ${spool.tagUid}` : 'Unknown RFID spool'}>
                Review RFID
              </span>
            ) : spool.archivedAt ? (
              <span className="spool-detail-archived-badge">Archived</span>
            ) : isActive ? (
              <span className="spool-detail-active-badge" title={spool.loadedOnPrinter ? `Loaded on ${spool.loadedOnPrinter.name}` : undefined}>
                {spool.loadedOnPrinter ? `On ${spool.loadedOnPrinter.name}` : 'Active'}
              </span>
            ) : null}
          </div>
          <SpoolMetaBadges filamentType={spool.filamentType} colorStyle={spool.colorStyle} />
          <span className="spool-detail-meta">
            {Math.round(displayRemaining)}g / {Math.round(spool.initialWeight)}g remaining
          </span>
        </div>
        <div className="spool-detail-actions">
          <button className="btn btn-secondary btn-sm" onClick={() => setShowDeductModal(true)}>
            Deduct
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowEditModal(true)}>
            Edit
          </button>
          {spool.archivedAt === null && (
            <button className="btn btn-danger btn-sm" onClick={() => setConfirmArchive(true)}>
              Archive
            </button>
          )}
        </div>
      </div>

      <div className="spool-detail-progress">
        <ProgressBar value={displayRemaining} max={spool.initialWeight} size="md" />
      </div>

      <section className="spool-detail-overview" aria-label="Spool information">
        <div className="spool-detail-metric">
          <span className="spool-detail-metric-label">Remaining</span>
          <strong>{Math.round(displayRemaining)}g</strong>
          <span>{Math.round(remainingPercent)}%</span>
        </div>
        <div className="spool-detail-metric">
          <span className="spool-detail-metric-label">Starting</span>
          <strong>{Math.round(spool.initialWeight)}g</strong>
          <span>{spool.spoolWeight != null ? `${Math.round(spool.spoolWeight)}g spool` : 'Spool weight not set'}</span>
        </div>
        <div className="spool-detail-metric">
          <span className="spool-detail-metric-label">Material</span>
          <strong>{spool.filamentType}</strong>
          <span>{spool.manufacturer || 'Manufacturer not set'}</span>
        </div>
        <div className="spool-detail-metric">
          <span className="spool-detail-metric-label">Diameter</span>
          <strong>{spool.diameter}mm</strong>
          <span>{spool.color}</span>
        </div>
        <div className="spool-detail-metric">
          <span className="spool-detail-metric-label">RFID tag</span>
          <strong>{spool.tagUid || 'Not linked'}</strong>
          <span>{spool.filamentId || 'No filament ID'}</span>
        </div>
        <div className="spool-detail-metric">
          <span className="spool-detail-metric-label">Dates</span>
          <strong>Purchased {formatDate(spool.purchaseDate)}</strong>
          <span>Expires {formatDate(spool.expirationDate)}</span>
        </div>
        {spool.notes && (
          <div className="spool-detail-notes">
            <span className="spool-detail-metric-label">Notes</span>
            <p>{spool.notes}</p>
          </div>
        )}
      </section>

      <section className="spool-detail-section">
        <h2 className="section-title">Audit log</h2>
        <div className="spool-audit-filters">
          {['all', 'deduct', 'manual_deduct', 'usage_correction_deduct', 'undo'].map((filter) => (
            <button
              key={filter}
              type="button"
              className={`btn btn-secondary btn-xs ${auditFilter === filter ? 'btn-primary' : ''}`}
              onClick={() => setAuditFilter(filter)}
            >
              {filter === 'all' ? 'All' : filter.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
        {auditLogs.length === 0 ? (
          <p className="spool-detail-empty">No weight changes recorded yet.</p>
        ) : (
          <div className="spool-audit-list">
            {auditLogs
              .filter((log) => auditFilter === 'all' || (auditFilter === 'undo' ? log.action.startsWith('undo_') : log.action === auditFilter))
              .slice(0, 12)
              .map((log) => {
                const isExpanded = expandedAuditId === log.id;
                const canUndo = !log.action.startsWith('undo_') && ['manual_deduct', 'usage_correction_deduct', 'usage_correction_restore'].includes(log.action);
                return (
                  <div key={log.id} className="spool-audit-entry">
                    <div
                      className="spool-audit-row spool-audit-row-clickable"
                      role="button"
                      tabIndex={0}
                      onClick={() => setExpandedAuditId(isExpanded ? null : log.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') setExpandedAuditId(isExpanded ? null : log.id);
                      }}
                    >
                      <span>{new Date(log.createdAt).toLocaleString()}</span>
                      <strong>{log.action}</strong>
                      <span>{Math.round(log.deltaGrams * 10) / 10}g</span>
                      <span>{Math.round(log.beforeWeight)}g → {Math.round(log.afterWeight)}g</span>
                      <span className="spool-audit-row-actions">
                        {canUndo && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleUndoAudit(log);
                            }}
                          >
                            Undo
                          </button>
                        )}
                        <span className="btn btn-secondary btn-xs">{isExpanded ? 'Hide' : 'Details'}</span>
                      </span>
                    </div>
                    {isExpanded && (
                      <div className="spool-audit-detail">
                        <div><strong>Reason:</strong> {log.reason || 'None'}</div>
                        <div><strong>Print job:</strong> {log.printJobId || 'None'}</div>
                        <div><strong>Usage row:</strong> {log.usageId || 'None'}</div>
                        {log.metadataJson && (
                          <pre>{formatMetadata(log.metadataJson)}</pre>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        )}
      </section>

      <section className="spool-detail-section">
        <h2 className="section-title">Print jobs</h2>
        {jobs.length === 0 ? (
          <p className="spool-detail-empty">No print jobs recorded for this spool yet.</p>
        ) : (
          <div className="spool-detail-jobs">
            {jobs.map((job) => (
              <PrintJobCard key={job.id} job={job} />
            ))}
          </div>
        )}
      </section>

      {showEditModal && spool && (
        <AddEditSpoolModal
          key={spool.id}
          spool={spool}
          onSave={handleSaveEdit}
          onCancel={() => setShowEditModal(false)}
        />
      )}

      {showDeductModal && spool && (
        <DeductFilamentModal
          spool={spool}
          onConfirm={handleDeduct}
          onCancel={() => setShowDeductModal(false)}
        />
      )}

      {confirmArchive && spool && (
        <ConfirmModal
          title="Archive Spool"
          message={`Archive "${spool.name}"? It will be hidden from active lists but not deleted.`}
          confirmLabel="Archive"
          confirmVariant="danger"
          onConfirm={handleArchive}
          onCancel={() => setConfirmArchive(false)}
        />
      )}
    </div>
  );
}
