import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { spoolsApi, settingsApi, printersApi } from '@services/api';
import { DEFAULT_NEW_SPOOL_WEIGHT_GRAMS, parseDefaultNewSpoolWeightGrams } from '@utils/defaultNewSpoolWeight';
import type { Spool, SpoolColorStyle, SpoolCreateRequest, Printer } from '@ha-addon/types';
import { normalizeSpoolColorStyle, SPOOL_COLOR_STYLE_OPTIONS } from '@ha-addon/types';
import SpoolCard from '@components/SpoolCard';
import AddEditSpoolModal from '@modals/AddEditSpoolModal';
import ActivateSpoolPrinterModal from '@modals/ActivateSpoolPrinterModal';
import DeductFilamentModal from '@modals/DeductFilamentModal';
import ConfirmModal from '@modals/ConfirmModal';
import './index.css';

type SpoolFilter = 'all' | 'active' | 'archived' | 'low';

const LOW_FILAMENT_THRESHOLD = 100; // grams — keep in sync with server/dashboard

export default function SpoolsPage() {
  const [spools, setSpools] = useState<Spool[]>([]);
  const [filter, setFilter] = useState<SpoolFilter>('all');
  const [styleFilter, setStyleFilter] = useState<'all' | SpoolColorStyle>('all');
  const [loading, setLoading] = useState(true);

  const navigate = useNavigate();
  const location = useLocation();
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingSpool, setEditingSpool] = useState<Spool | null>(null);
  const [deductingSpool, setDeductingSpool] = useState<Spool | null>(null);
  const [deletingSpool, setDeletingSpool] = useState<Spool | null>(null);
  const [activatePrinterModal, setActivatePrinterModal] = useState<{ spool: Spool; printers: Printer[] } | null>(null);
  const [defaultNewSpoolWeightGrams, setDefaultNewSpoolWeightGrams] = useState(DEFAULT_NEW_SPOOL_WEIGHT_GRAMS);

  useEffect(() => {
    let cancelled = false;
    void settingsApi.getAll().then((res) => {
      if (cancelled) return;
      setDefaultNewSpoolWeightGrams(parseDefaultNewSpoolWeightGrams(res.data['default_new_spool_weight_grams']));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const fetchSpools = useCallback(async () => {
    try {
      const status = filter === 'all' || filter === 'low' ? undefined : filter;
      const response = await spoolsApi.getAll(status);
      const allSpools = response.data;
      if (filter === 'low') {
        setSpools(allSpools.filter((s) => s.archivedAt === null && s.remainingWeight <= LOW_FILAMENT_THRESHOLD));
      } else {
        setSpools(allSpools);
      }
    } catch (err) {
      console.error('Failed to fetch spools:', err);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchSpools();
  }, [fetchSpools]);

  // Initialize filter from query string (e.g. /spools?filter=active)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const raw = params.get('filter');
    if (!raw) return;
    const value = raw.toLowerCase() as SpoolFilter;
    if (value === 'all' || value === 'active' || value === 'archived' || value === 'low') {
      setFilter(value);
    }
  }, [location.search]);

  const visibleSpools = useMemo(() => {
    if (styleFilter === 'all') return spools;
    return spools.filter((s) => normalizeSpoolColorStyle(s.colorStyle) === styleFilter);
  }, [spools, styleFilter]);

  const handleSave = async (data: SpoolCreateRequest) => {
    try {
      if (editingSpool) {
        await spoolsApi.update(editingSpool.id, data);
      } else {
        await spoolsApi.create(data);
      }
      setShowAddModal(false);
      setEditingSpool(null);
      fetchSpools();
    } catch (err) {
      console.error('Failed to save spool:', err);
    }
  };

  const handleDeduct = async (amount: number, _reason: string) => {
    if (!deductingSpool) return;
    try {
      await spoolsApi.deduct(deductingSpool.id, { amount });
      setDeductingSpool(null);
      fetchSpools();
    } catch (err) {
      console.error('Failed to deduct filament:', err);
    }
  };

  const handleDelete = async () => {
    if (!deletingSpool) return;
    try {
      await spoolsApi.delete(deletingSpool.id);
      setDeletingSpool(null);
      fetchSpools();
    } catch (err) {
      console.error('Failed to delete spool:', err);
    }
  };

  const handleArchive = async (spool: Spool) => {
    try {
      await spoolsApi.archive(spool.id);
      fetchSpools();
    } catch (err) {
      console.error('Failed to archive spool:', err);
    }
  };

  const handleActivate = async (spool: Spool) => {
    try {
      const printersRes = await printersApi.getAll();
      const printers = printersRes.data.filter((p) => p.isActive);
      if (printers.length === 0) {
        await spoolsApi.activate(spool.id);
      } else if (printers.length === 1) {
        await spoolsApi.activate(spool.id, { printerId: printers[0].id });
      } else {
        setActivatePrinterModal({ spool, printers });
        return;
      }
      fetchSpools();
    } catch (err) {
      console.error('Failed to activate spool:', err);
    }
  };

  const finishActivateWithPrinter = async (printerId: string | null) => {
    if (!activatePrinterModal) return;
    const { spool } = activatePrinterModal;
    try {
      await spoolsApi.activate(spool.id, printerId ? { printerId } : {});
      setActivatePrinterModal(null);
      fetchSpools();
    } catch (err) {
      console.error('Failed to activate spool:', err);
    }
  };

  return (
    <div className="spools-page">
      <div className="spools-header">
        <div>
          <h2 className="page-title">Spools</h2>
          <p className="page-subtitle">Manage your filament spools</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
          + Add Spool
        </button>
      </div>

      <div className="spools-filters">
        <div className="spools-filters-presets">
          {(['all', 'active', 'archived', 'low'] as SpoolFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              className={`btn ${filter === f ? 'btn-primary' : 'btn-secondary'} btn-sm`}
              onClick={() => setFilter(f)}
            >
              {f === 'low' ? 'Low' : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <div className="spools-filter-style">
          <label htmlFor="spools-style-filter">Style</label>
          <select
            id="spools-style-filter"
            className="spools-filter-style-select"
            value={styleFilter}
            onChange={(e) => {
              const v = e.target.value;
              setStyleFilter(v === 'all' ? 'all' : normalizeSpoolColorStyle(v));
            }}
          >
            <option value="all">All styles</option>
            {SPOOL_COLOR_STYLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="loading-container"><div className="spinner" /><p>Loading spools...</p></div>
      ) : spools.length === 0 ? (
        <div className="empty-state">
          <h3>No spools yet</h3>
          <p>Add your first filament spool to start tracking usage.</p>
          <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>+ Add Your First Spool</button>
        </div>
      ) : visibleSpools.length === 0 ? (
        <div className="empty-state">
          <h3>No matching spools</h3>
          <p>No spools use the selected swatch style with the current status filter.</p>
          <button type="button" className="btn btn-primary" onClick={() => setStyleFilter('all')}>
            Clear style filter
          </button>
        </div>
      ) : (
        <div className="spools-grid">
          {visibleSpools.map((spool) => (
            <SpoolCard
              key={spool.id}
              spool={spool}
              onEdit={(s) => setEditingSpool(s)}
              onDeduct={(s) => setDeductingSpool(s)}
              onArchive={handleArchive}
              onDelete={(s) => setDeletingSpool(s)}
              onActivate={handleActivate}
              onNameClick={(s) => navigate(`/spools/${s.id}`)}
            />
          ))}
        </div>
      )}

      {activatePrinterModal && (
        <ActivateSpoolPrinterModal
          spool={activatePrinterModal.spool}
          printers={activatePrinterModal.printers}
          onConfirm={(printerId) => void finishActivateWithPrinter(printerId)}
          onCancel={() => setActivatePrinterModal(null)}
        />
      )}

      {(showAddModal || editingSpool) && (
        <AddEditSpoolModal
          spool={editingSpool}
          defaultWeightGrams={defaultNewSpoolWeightGrams}
          onSave={handleSave}
          onCancel={() => { setShowAddModal(false); setEditingSpool(null); }}
        />
      )}

      {deductingSpool && (
        <DeductFilamentModal
          spool={deductingSpool}
          onConfirm={handleDeduct}
          onCancel={() => setDeductingSpool(null)}
        />
      )}

      {deletingSpool && (
        <ConfirmModal
          title="Delete Spool"
          message={`Are you sure you want to delete "${deletingSpool.name}"? This action cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={handleDelete}
          onCancel={() => setDeletingSpool(null)}
        />
      )}
    </div>
  );
}
