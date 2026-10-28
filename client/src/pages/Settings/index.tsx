import { useState, useEffect } from 'react';
import { settingsApi, maintenanceApi } from '@services/api';
import { DEFAULT_NEW_SPOOL_WEIGHT_GRAMS, parseDefaultNewSpoolWeightGrams } from '@utils/defaultNewSpoolWeight';
import './index.css';

export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [lowThreshold, setLowThreshold] = useState('100');
  const [defaultNewSpoolWeight, setDefaultNewSpoolWeight] = useState(String(DEFAULT_NEW_SPOOL_WEIGHT_GRAMS));
  const [deductionMode, setDeductionMode] = useState('during_print');
  const [saving, setSaving] = useState(false);
  const [maintenanceStatus, setMaintenanceStatus] = useState('');

  useEffect(() => {
    const loadAll = async () => {
      try {
        const settingsRes = await settingsApi.getAll();
        setSettings(settingsRes.data);
        setLowThreshold(settingsRes.data['low_filament_threshold'] || '100');
        setDefaultNewSpoolWeight(
          String(parseDefaultNewSpoolWeightGrams(settingsRes.data['default_new_spool_weight_grams'])),
        );
        setDeductionMode(settingsRes.data['deduction_mode'] || 'during_print');
      } catch (err) {
        console.error('Failed to load settings:', err);
      }
    };
    loadAll();
  }, []);

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      const res = await settingsApi.update({
        low_filament_threshold: lowThreshold,
        default_new_spool_weight_grams: String(parseDefaultNewSpoolWeightGrams(defaultNewSpoolWeight)),
        deduction_mode: deductionMode,
      });
      setSettings(res.data);
    } catch (err) {
      console.error('Failed to save settings:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-page">
      <h2 className="page-title">Settings</h2>
      <p className="page-subtitle">Configure filament tracking preferences</p>

      <div className="settings-section">
        <h3 className="section-title">Printers &amp; Filament</h3>
        <div className="settings-card">
          <div className="form-group">
            <label>Filament deduction mode</label>
            <select value={deductionMode} onChange={(e) => setDeductionMode(e.target.value)} style={{ maxWidth: 260 }}>
              <option value="during_print">Deduct during print</option>
              <option value="on_completion">Deduct on completion</option>
            </select>
            <span className="form-hint">
              During-print mode keeps spool remaining weight saved as AMS usage is observed. Completion mode waits until the print finishes.
            </span>
          </div>
          <div className="form-group">
            <label>Default weight for new spools (grams)</label>
            <input
              type="number"
              value={defaultNewSpoolWeight}
              onChange={(e) => setDefaultNewSpoolWeight(e.target.value)}
              min="1"
              max="1000000"
              style={{ maxWidth: 200 }}
            />
            <span className="form-hint">
              Pre-fills initial and remaining weight when you add a spool. Currently:{' '}
              {parseDefaultNewSpoolWeightGrams(settings['default_new_spool_weight_grams'])}g
            </span>
          </div>
          <div className="form-group">
            <label>Low filament threshold (grams)</label>
            <input type="number" value={lowThreshold} onChange={(e) => setLowThreshold(e.target.value)} min="0" max="5000" style={{ maxWidth: 200 }} />
            <span className="form-hint">Used to identify spools that are running low.</span>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3 className="section-title">Maintenance</h3>
        <div className="settings-card">
          <div className="settings-actions">
            <button className="btn btn-secondary" onClick={async () => {
              const res = await maintenanceApi.resyncEntities();
              setMaintenanceStatus(`Synced ${res.data.updated} direct printer(s)`);
            }}>Sync direct printer slots</button>
            <button className="btn btn-secondary" onClick={async () => {
              const res = await maintenanceApi.commitPending();
              setMaintenanceStatus(`Committed ${res.data.committed} pending row(s)`);
            }}>Commit pending rows</button>
            <button className="btn btn-secondary" onClick={async () => {
              const res = await maintenanceApi.clearStaleJobs();
              setMaintenanceStatus(`Marked ${res.data.updated} stale job(s) failed`);
            }}>Clear stale jobs</button>
            <button className="btn btn-secondary" onClick={async () => {
              const res = await maintenanceApi.backfillAudit();
              setMaintenanceStatus(`Backfilled ${res.data.created} audit row(s)`);
            }}>Backfill audit</button>
          </div>
          {maintenanceStatus && <p className="form-hint">{maintenanceStatus}</p>}
        </div>
      </div>

      <div className="settings-actions">
        <button className="btn btn-primary" onClick={handleSaveSettings} disabled={saving}>
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}
