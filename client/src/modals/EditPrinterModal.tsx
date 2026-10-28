import { useState, useEffect } from 'react';
import type { Printer, Spool } from '@ha-addon/types';
import './Modal.css';

export type EditPrinterSaveData = {
  name: string;
  entityPrefix: string;
  haDeviceId: string;
  model?: string;
  activeSpoolId?: string | null;
};

interface EditPrinterModalProps {
  printer: Printer;
  spools?: Spool[];
  onSave: (data: EditPrinterSaveData) => void;
  onClose: () => void;
}

export default function EditPrinterModal({ printer, spools = [], onSave, onClose }: EditPrinterModalProps) {
  const [name, setName] = useState(printer.name);
  const [entityPrefix, setEntityPrefix] = useState(printer.entityPrefix);
  const [model, setModel] = useState(printer.model || '');
  const [activeSpoolId, setActiveSpoolId] = useState(printer.activeSpoolId ?? '');

  useEffect(() => {
    setName(printer.name);
    setEntityPrefix(printer.entityPrefix);
    setModel(printer.model || '');
    setActiveSpoolId(printer.activeSpoolId ?? '');
  }, [printer]);

  const prefix = entityPrefix.trim();
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      name: name.trim(),
      entityPrefix: prefix,
      haDeviceId: prefix,
      model: model.trim() || undefined,
      activeSpoolId: activeSpoolId.trim() || null,
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Edit Printer</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <form className="modal-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Name *</label>
            <input
              required
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Bambu X1C"
            />
          </div>
          <div className="form-group">
            <label>Printer Key</label>
            <input
              type="text"
              value={entityPrefix}
              onChange={(e) => setEntityPrefix(e.target.value)}
              placeholder="e.g., p2s_00m09a360200242"
            />
            <span className="form-hint">
              Stable key used to identify this printer record.
            </span>
          </div>
          <div className="form-group">
            <label>Model</label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="e.g., X1 Carbon"
            />
          </div>
          <div className="form-group">
            <label>Loaded spool</label>
            <select
              value={activeSpoolId}
              onChange={(e) => setActiveSpoolId(e.target.value)}
            >
              <option value="">None</option>
              {spools.filter((s) => s.archivedAt === null).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.filamentType})
                </option>
              ))}
            </select>
            <span className="form-hint">
              Spool currently loaded on this printer. Used to auto-deduct filament when a print completes and the job has no spool assigned.
            </span>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">Save</button>
          </div>
        </form>
      </div>
    </div>
  );
}
