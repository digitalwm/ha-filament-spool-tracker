import { useState } from 'react';
import './Modal.css';

interface AddPrinterModalProps {
  onSave: (data: { name: string; entityPrefix: string; model?: string }) => void;
  onClose: () => void;
}

export default function AddPrinterModal({ onSave, onClose }: AddPrinterModalProps) {
  const [name, setName] = useState('');
  const [entityPrefix, setEntityPrefix] = useState('');
  const [model, setModel] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const prefix = entityPrefix.trim();
    if (!prefix) return;
    onSave({
      name: name.trim() || prefix.replace(/_/g, ' '),
      entityPrefix: prefix,
      model: model.trim() || undefined,
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Add Printer</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <form className="modal-form" onSubmit={handleSubmit}>
          <p className="modal-hint">
            Add the printer record here. Its direct LAN connection is configured in the SpoolTracker deployment environment.
          </p>
          <div className="form-group">
            <label>Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Bambu X1C"
            />
            <span className="form-hint">Optional — defaults to entity prefix with spaces</span>
          </div>
          <div className="form-group">
            <label>Printer Key *</label>
            <input
              required
              type="text"
              value={entityPrefix}
              onChange={(e) => setEntityPrefix(e.target.value)}
              placeholder="e.g., bambu_x1c_01s"
            />
            <span className="form-hint">
              Stable identifier for this printer record. Use the same value when associating the direct printer configuration.
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
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">Add Printer</button>
          </div>
        </form>
      </div>
    </div>
  );
}
