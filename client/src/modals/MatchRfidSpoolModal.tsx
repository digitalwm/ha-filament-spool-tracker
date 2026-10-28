import { useMemo, useState } from 'react';
import type { Spool } from '@ha-addon/types';
import SpoolSelect from '@components/SpoolSelect';
import './Modal.css';

interface MatchRfidSpoolModalProps {
  temporarySpool: Spool;
  spools: Spool[];
  onConfirm: (targetSpoolId: string) => Promise<void>;
  onCancel: () => void;
}

export default function MatchRfidSpoolModal({
  temporarySpool,
  spools,
  onConfirm,
  onCancel,
}: MatchRfidSpoolModalProps) {
  const [targetSpoolId, setTargetSpoolId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eligibleSpools = useMemo(
    () => spools.filter((spool) =>
      spool.id !== temporarySpool.id
      && spool.archivedAt === null
      && !spool.isRfidTemporary
      && !spool.tagUid
    ),
    [spools, temporarySpool.id],
  );

  const handleConfirm = async () => {
    if (!targetSpoolId) return;
    setSaving(true);
    setError(null);
    try {
      await onConfirm(targetSpoolId);
    } catch (err) {
      const message = typeof err === 'object'
        && err !== null
        && 'response' in err
        && typeof err.response === 'object'
        && err.response !== null
        && 'data' in err.response
        && typeof err.response.data === 'object'
        && err.response.data !== null
        && 'error' in err.response.data
        ? String(err.response.data.error)
        : 'Failed to match RFID spool';
      setError(message);
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" onClick={(event) => event.stopPropagation()}>
        <h3 className="modal-title">Match RFID to Existing Spool</h3>
        <p>
          Select the existing spool that is physically loaded as <strong>{temporarySpool.name}</strong>.
          Its weight and history will be kept, and RFID <strong>{temporarySpool.tagUid ?? 'unknown'}</strong> will be linked to it.
        </p>

        {eligibleSpools.length > 0 ? (
          <div className="form-group">
            <label>Existing spool without RFID</label>
            <SpoolSelect
              value={targetSpoolId}
              onChange={setTargetSpoolId}
              spools={eligibleSpools}
              placeholder="Choose existing spool"
            />
          </div>
        ) : (
          <p className="form-hint">No active, validated spools without an RFID tag are available.</p>
        )}

        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleConfirm()}
            disabled={!targetSpoolId || saving}
          >
            {saving ? 'Matching...' : 'Match RFID'}
          </button>
        </div>
      </div>
    </div>
  );
}
