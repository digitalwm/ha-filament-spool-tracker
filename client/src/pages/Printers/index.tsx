import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { printersApi, spoolsApi } from '@services/api';
import type { Printer, PrinterSlot, Spool, PrinterTimelineEvent } from '@ha-addon/types';
import EditPrinterModal, { type EditPrinterSaveData } from '@modals/EditPrinterModal';
import AddPrinterModal from '@modals/AddPrinterModal';
import ConfirmModal from '@modals/ConfirmModal';
import ProgressBar from '@components/ProgressBar';
import SpoolColorSwatch from '@components/SpoolColorSwatch';
import SpoolSelect from '@components/SpoolSelect';
import AMSVisualTrayBoard from '@components/AMSVisualTrayBoard';
import './index.css';

export default function PrintersPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [editingPrinter, setEditingPrinter] = useState<Printer | null>(null);
  const [deletingPrinter, setDeletingPrinter] = useState<Printer | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [spools, setSpools] = useState<Spool[]>([]);
  const [timelines, setTimelines] = useState<Record<string, PrinterTimelineEvent[]>>({});
  const [imprintingSlotId, setImprintingSlotId] = useState<string | null>(null);
  const [slotIdentityFeedback, setSlotIdentityFeedback] = useState<{ slotId: string; message: string; error: boolean } | null>(null);

  useEffect(() => {
    const loadAll = async () => {
      try {
        const [printersRes, spoolsRes] = await Promise.all([
          printersApi.getAll(),
          spoolsApi.getAll(),
        ]);
        setPrinters(printersRes.data);
        setSpools(spoolsRes.data);
        const timelineEntries = await Promise.all(printersRes.data.map((p) => printersApi.getTimeline(p.id).then((r) => [p.id, r.data] as const).catch(() => [p.id, []] as const)));
        setTimelines(Object.fromEntries(timelineEntries));
      } catch (err) {
        console.error('Failed to load printers:', err);
      }
    };
    loadAll();
  }, []);

  const focusPrinterId = searchParams.get('focus');

  useEffect(() => {
    if (!focusPrinterId || printers.length === 0) return;

    const stripFocus = () =>
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('focus');
          return next;
        },
        { replace: true }
      );

    const el = document.getElementById(`printer-card-${focusPrinterId}`);
    if (!el) {
      stripFocus();
      return;
    }

    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    el.classList.add('printer-card--focused');
    const t = window.setTimeout(() => {
      el.classList.remove('printer-card--focused');
      stripFocus();
    }, 2200);
    return () => window.clearTimeout(t);
  }, [focusPrinterId, printers, setSearchParams]);

  const handleAddPrinter = async (data: { name: string; entityPrefix: string; model?: string }) => {
    try {
      const prefix = data.entityPrefix.trim();
      await printersApi.create({
        name: data.name.trim() || prefix.replace(/_/g, ' '),
        haDeviceId: prefix,
        entityPrefix: prefix,
        model: data.model,
      });
      const res = await printersApi.getAll();
      setPrinters(res.data);
      setShowAddModal(false);
    } catch (err) {
      console.error('Failed to add printer:', err);
    }
  };

  const handleSaveEdit = async (data: EditPrinterSaveData) => {
    if (!editingPrinter) return;
    try {
      const res = await printersApi.update(editingPrinter.id, data);
      setPrinters((prev) => prev.map((p) => (p.id === editingPrinter.id ? res.data : p)));
      setEditingPrinter(null);
    } catch (err) {
      console.error('Failed to update printer:', err);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingPrinter) return;
    try {
      await printersApi.delete(deletingPrinter.id);
      setPrinters((prev) => prev.filter((p) => p.id !== deletingPrinter.id));
      setDeletingPrinter(null);
    } catch (err) {
      console.error('Failed to delete printer:', err);
    }
  };

  const handleLoadedSpoolChange = async (printer: Printer, activeSpoolId: string | null) => {
    try {
      const res = await printersApi.update(printer.id, { activeSpoolId });
      setPrinters((prev) => prev.map((p) => (p.id === printer.id ? res.data : p)));
    } catch (err) {
      console.error('Failed to update loaded spool:', err);
    }
  };

  const handleSyncSlots = async (printer: Printer) => {
    try {
      await printersApi.syncSlots(printer.id);
      const res = await printersApi.getAll();
      setPrinters(res.data);
    } catch (err) {
      console.error('Failed to sync printer slots:', err);
    }
  };

  const handleSlotSpoolChange = async (printer: Printer, slotId: string, spoolId: string | null) => {
    try {
      await printersApi.updateSlot(printer.id, slotId, { spoolId });
      const [printersRes, spoolsRes] = await Promise.all([printersApi.getAll(), spoolsApi.getAll()]);
      setPrinters(printersRes.data);
      setSpools(spoolsRes.data);
      setSlotIdentityFeedback(null);
    } catch (err) {
      console.error('Failed to update printer slot:', err);
    }
  };

  const hasSlotIdentityConflict = (slot: PrinterSlot) => {
    if (!slot.spool) return false;
    const tagConflict = Boolean(slot.tagUid && slot.spool.tagUid && slot.tagUid !== slot.spool.tagUid);
    const filamentConflict = Boolean(slot.filamentId && slot.spool.filamentId && slot.filamentId !== slot.spool.filamentId);
    return tagConflict || filamentConflict;
  };

  const canImprintSlotIdentity = (slot: PrinterSlot) => {
    if (!slot.spoolId || !slot.spool || (!slot.tagUid && !slot.filamentId) || hasSlotIdentityConflict(slot)) return false;
    return true;
  };

  const handleImprintSlotIdentity = async (printer: Printer, slot: PrinterSlot) => {
    if (!slot.spoolId) return;
    setImprintingSlotId(slot.id);
    setSlotIdentityFeedback(null);
    try {
      await printersApi.updateSlot(printer.id, slot.id, { spoolId: slot.spoolId });
      const [printersRes, spoolsRes] = await Promise.all([printersApi.getAll(), spoolsApi.getAll()]);
      setPrinters(printersRes.data);
      setSpools(spoolsRes.data);
      setSlotIdentityFeedback({ slotId: slot.id, message: 'Printer IDs saved to the linked spool.', error: false });
    } catch (err) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setSlotIdentityFeedback({ slotId: slot.id, message: message ?? 'Could not save the printer IDs to this spool.', error: true });
    } finally {
      setImprintingSlotId(null);
    }
  };

  const handleRecoverActivePrint = async (printer: Printer) => {
    try {
      await printersApi.recoverActivePrint(printer.id);
      const [printersRes, spoolsRes] = await Promise.all([printersApi.getAll(), spoolsApi.getAll()]);
      setPrinters(printersRes.data);
      setSpools(spoolsRes.data);
    } catch (err) {
      console.error('Failed to recover active print:', err);
    }
  };

  return (
    <div className="printers-page">
      <div className="printers-page-heading">
        <div>
          <h2 className="page-title">Printers</h2>
          <p className="page-subtitle">Manage printer connections, loaded spools, and detected tray identities.</p>
        </div>
        <span className="printers-page-count">{printers.length} registered {printers.length === 1 ? 'printer' : 'printers'}</span>
      </div>

      <div className="printers-section">
        <div className="ha-connection-bar">
          <div className="ha-connection-status">
            <div>
              <strong>Direct printer connection</strong>
              <span>Printer telemetry and AMS identities are read directly over the local network.</span>
            </div>
          </div>
          <div className="ha-connection-bar-actions">
            <button className="btn btn-secondary btn-sm" onClick={() => setShowAddModal(true)}>
              Add printer
            </button>
          </div>
        </div>
      </div>

      {printers.length > 0 && (
        <div className="printers-section">
          <div className="printers-section-heading">
            <div>
              <h3 className="section-title">Registered printers</h3>
              <p>Live assignments and the identifiers reported by each printer.</p>
            </div>
          </div>
          <div className="printer-cards">
            {printers.map((printer) => (
              <div key={printer.id} id={`printer-card-${printer.id}`} className="printer-card">
                <div className="printer-card-top">
                  <div className="printer-card-icon">🖨️</div>
                  <div className="printer-card-heading">
                    <span className="printer-card-name">{printer.name}</span>
                    {(printer.model && printer.model !== printer.name) || printer.entityPrefix !== printer.name ? (
                      <span className="printer-card-meta">
                        {printer.model && printer.model !== printer.name
                          ? printer.model
                          : `ID: ${printer.entityPrefix}`}
                      </span>
                    ) : null}
                  </div>
                  <div className="printer-card-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm btn-icon"
                      onClick={() => setEditingPrinter(printer)}
                      title="Edit printer"
                      aria-label="Edit printer"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                      <span className="btn-icon-label">Edit</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm btn-icon"
                      onClick={() => setDeletingPrinter(printer)}
                      title="Remove printer"
                      aria-label="Remove printer"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                      <span className="btn-icon-label">Remove</span>
                    </button>
                  </div>
                </div>
                <div className="printer-card-spool">
                  <span className="printer-card-spool-label">Mounted spool</span>
                  {printer.activeSpool ? (
                    <>
                      <div className="printer-mounted-spool">
                        <button
                          type="button"
                          className="printer-card-spool-preview"
                          onClick={() => navigate(`/spools/${printer.activeSpool!.id}`)}
                        >
                          <SpoolColorSwatch
                            className="printer-card-spool-dot"
                            colorHex={printer.activeSpool.colorHex}
                            colorStyle={printer.activeSpool.colorStyle}
                            colorName={printer.activeSpool.color}
                          />
                          <span className="printer-card-spool-name">{printer.activeSpool.name}</span>
                          <span className="printer-card-spool-weight">
                            {Math.round(printer.activeSpool.remainingWeight)}g / {Math.round(printer.activeSpool.initialWeight)}g
                          </span>
                        </button>
                        <ProgressBar value={printer.activeSpool.remainingWeight} max={printer.activeSpool.initialWeight} size="sm" />
                      </div>
                      <SpoolSelect
                        value={printer.activeSpoolId ?? null}
                        onChange={(id) => handleLoadedSpoolChange(printer, id)}
                        spools={spools.filter((s) => s.archivedAt === null)}
                        placeholder="None"
                        aria-label="Change loaded spool"
                        className="printer-card-spool-select"
                      />
                    </>
                  ) : (
                    <SpoolSelect
                      value={null}
                      onChange={(id) => handleLoadedSpoolChange(printer, id)}
                      spools={spools.filter((s) => s.archivedAt === null)}
                      placeholder="Select spool…"
                      aria-label="Select loaded spool"
                      className="printer-card-spool-select printer-card-spool-select-empty"
                    />
                  )}
                </div>
                <div className="printer-card-slots">
                  <div className="printer-card-slots-header">
                    <div className="printer-slots-title">
                      <span className="printer-card-spool-label">AMS / feed slots</span>
                      <span className="printer-slot-health">
                        {printer.slots?.some((slot) => slot.isActive)
                          ? `Currently using ${printer.slots.find((slot) => slot.isActive)?.slotLabel}`
                          : 'No active tray detected'}
                      </span>
                    </div>
                    <div className="printer-slot-toolbar">
                      <span className="printer-slot-assigned">
                        {(printer.slots ?? []).filter((slot) => !slot.isEmpty && slot.spoolId).length} / {(printer.slots ?? []).filter((slot) => !slot.isEmpty).length} loaded trays linked
                      </span>
                      <button type="button" className="btn btn-secondary btn-xs" onClick={() => handleSyncSlots(printer)}>Sync from printer</button>
                      <button type="button" className="btn btn-secondary btn-xs" onClick={() => handleRecoverActivePrint(printer)}>Recover print</button>
                    </div>
                  </div>
                  {printer.slots && printer.slots.length > 0 ? (
                    <>
                    <AMSVisualTrayBoard
                      slots={printer.slots}
                      spools={spools}
                      editable
                      onSlotSpoolChange={(slot, spoolId) => handleSlotSpoolChange(printer, slot.id, spoolId)}
                    />
                    <div className="printer-slot-list">
                      {printer.slots.map((slot) => (
                        <div key={slot.id} className={`printer-slot-row ${slot.isActive ? 'printer-slot-row-active' : ''}`}>
                          <div className="printer-slot-info">
                            <span className="printer-slot-label">{slot.slotLabel}</span>
                            <div className="printer-slot-meta">
                              <span>{slot.filamentType || 'Unknown material'}{slot.colorHex ? ` · ${slot.colorHex}` : ''}{slot.isEmpty ? ' · Empty' : ''}</span>
                              <div className="printer-slot-identifiers">
                                <span>
                                  <span>RFID / Tag UID</span>
                                  {slot.tagUid ? <code>{slot.tagUid}</code> : <em>Not reported</em>}
                                </span>
                                {slot.trayUuid && !/^0+$/.test(slot.trayUuid.replace(/-/g, '')) && (
                                  <span><span>Tray UUID</span><code>{slot.trayUuid}</code></span>
                                )}
                                <span>
                                  <span>Filament ID</span>
                                  {slot.filamentId ? <code>{slot.filamentId}</code> : <em>Not reported</em>}
                                </span>
                              </div>
                            </div>
                          </div>
                          <SpoolSelect
                            value={slot.spoolId ?? null}
                            onChange={(id) => handleSlotSpoolChange(printer, slot.id, id)}
                            spools={spools.filter((s) => s.archivedAt === null)}
                            placeholder="Assign spool"
                            size="sm"
                            aria-label={`Assign spool to ${slot.slotLabel}`}
                            dropdownAction={canImprintSlotIdentity(slot) ? {
                              label: imprintingSlotId === slot.id ? 'Imprinting detected IDs…' : 'Imprint detected IDs on this spool',
                              disabled: imprintingSlotId === slot.id,
                              onSelect: () => void handleImprintSlotIdentity(printer, slot),
                            } : undefined}
                          />
                          {slotIdentityFeedback?.slotId === slot.id && (
                            <div className={`printer-slot-imprint-result ${slotIdentityFeedback.error ? 'is-error' : 'is-success'}`} role="status">
                              {slotIdentityFeedback.message}
                            </div>
                          )}
                          {!slotIdentityFeedback && !slot.spoolId && (slot.tagUid || slot.filamentId) && (
                            <div className="printer-slot-imprint-note">Choose a spool from the dropdown to link the detected IDs to it.</div>
                          )}
                          {!slotIdentityFeedback && slot.spoolId && hasSlotIdentityConflict(slot) && (
                            <div className="printer-slot-imprint-note">The linked spool has a different ID saved. Verify it before changing the spool identity.</div>
                          )}
                          {!slot.isEmpty && !slot.spoolId && (
                            <div className="printer-slot-warning">
                              Filament detected, no spool assigned
                            </div>
                          )}
                          {!slot.spoolId && slot.suggestedSpools && slot.suggestedSpools.length > 0 && (
                            <div className="printer-slot-suggestions">
                              {slot.suggestedSpools.map((spool) => (
                                <button
                                  key={spool.id}
                                  type="button"
                                  className="btn btn-secondary btn-xs"
                                  onClick={() => handleSlotSpoolChange(printer, slot.id, spool.id)}
                                >
                                  Use {spool.name}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    </>
                  ) : (
                    <p className="printer-slot-empty">No slots synced yet.</p>
                  )}
                </div>
                <div className="printer-timeline">
                  <span className="printer-card-spool-label">Timeline</span>
                  {(timelines[printer.id] ?? []).slice(0, 5).map((event) => (
                    <div key={event.id} className={`printer-timeline-event printer-timeline-event-${event.type}`}>
                      <span>{new Date(event.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      <span>{event.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {printers.length === 0 && (
        <div className="printers-empty">
          <p>No printers yet. Add a printer record, then configure its direct LAN connection in the deployment environment.</p>
        </div>
      )}

      {showAddModal && (
        <AddPrinterModal
          onSave={handleAddPrinter}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {editingPrinter && (
        <EditPrinterModal
          printer={editingPrinter}
          spools={spools}
          onSave={handleSaveEdit}
          onClose={() => setEditingPrinter(null)}
        />
      )}

      {deletingPrinter && (
        <ConfirmModal
          title="Remove Printer"
          message={`Remove "${deletingPrinter.name}"? Print jobs linked to this printer will keep their history but won't be associated with a printer anymore.`}
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeletingPrinter(null)}
        />
      )}
    </div>
  );
}
