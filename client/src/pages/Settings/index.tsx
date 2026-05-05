import { useState, useEffect } from 'react';
import { settingsApi, haApi } from '@services/api';
import type { HAConnectionStatus } from '@ha-addon/types';
import { DEFAULT_NEW_SPOOL_WEIGHT_GRAMS, parseDefaultNewSpoolWeightGrams } from '@utils/defaultNewSpoolWeight';
import './index.css';

export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [haStatus, setHaStatus] = useState<HAConnectionStatus | null>(null);
  const [lowThreshold, setLowThreshold] = useState('100');
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [filamentChangeNotificationsEnabled, setFilamentChangeNotificationsEnabled] = useState(true);
  const [defaultNewSpoolWeight, setDefaultNewSpoolWeight] = useState(String(DEFAULT_NEW_SPOOL_WEIGHT_GRAMS));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const loadAll = async () => {
      try {
        const [settingsRes, haStatusRes] = await Promise.all([
          settingsApi.getAll(),
          haApi.getStatus(),
        ]);
        setSettings(settingsRes.data);
        setHaStatus(haStatusRes.data);
        setLowThreshold(settingsRes.data['low_filament_threshold'] || '100');
        if (settingsRes.data['notifications_enabled'] != null) {
          setNotificationsEnabled(settingsRes.data['notifications_enabled'] !== 'false' && settingsRes.data['notifications_enabled'] !== '0');
        }
        if (settingsRes.data['filament_change_notifications_enabled'] != null) {
          setFilamentChangeNotificationsEnabled(
            settingsRes.data['filament_change_notifications_enabled'] !== 'false' &&
            settingsRes.data['filament_change_notifications_enabled'] !== '0',
          );
        }
        setDefaultNewSpoolWeight(
          String(parseDefaultNewSpoolWeightGrams(settingsRes.data['default_new_spool_weight_grams'])),
        );
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
        notifications_enabled: notificationsEnabled ? 'true' : 'false',
        filament_change_notifications_enabled: filamentChangeNotificationsEnabled ? 'true' : 'false',
        default_new_spool_weight_grams: String(parseDefaultNewSpoolWeightGrams(defaultNewSpoolWeight)),
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
      <p className="page-subtitle">Configure notifications and preferences</p>

      <div className="settings-section">
        <h3 className="section-title">Home Assistant Connection</h3>
        <div className="settings-card">
          <div className="ha-status-row">
            <span className={`ha-status-indicator ${haStatus?.connected ? 'connected' : 'disconnected'}`} />
            <span>{haStatus?.connected ? 'Connected to Home Assistant' : 'Not connected'}</span>
            {haStatus?.connected && (
              <span className="ha-printer-count">{haStatus.printerCount} Bambu printer(s) detected</span>
            )}
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3 className="section-title">Printers &amp; Filament</h3>
        <div className="settings-card">
          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={filamentChangeNotificationsEnabled}
                onChange={(e) => setFilamentChangeNotificationsEnabled(e.target.checked)}
              />
              Enable filament-change reminder
            </label>
            <p className="form-hint">
              When enabled, a notification is sent when the Bambu integration suggests filament was changed on a printer.
            </p>
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
        </div>
      </div>

      <div className="settings-section">
        <h3 className="section-title">Notifications</h3>
        <div className="settings-card">
          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={notificationsEnabled}
                onChange={(e) => setNotificationsEnabled(e.target.checked)}
              />
              Enable Home Assistant notifications
            </label>
            <p className="form-hint">
              When disabled, low filament, unassigned jobs, expiring spools, and stuck in-progress job alerts will not be sent.
            </p>
          </div>
          <div className="form-group">
            <label>Low Filament Threshold (grams)</label>
            <input
              type="number"
              value={lowThreshold}
              onChange={(e) => setLowThreshold(e.target.value)}
              min="0"
              max="5000"
              style={{ maxWidth: 200 }}
            />
            <span className="form-hint">
              Get notified when a spool drops below this weight. Currently: {settings['low_filament_threshold'] || '100'}g
            </span>
          </div>
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
