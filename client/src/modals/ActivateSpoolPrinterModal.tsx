import { useState } from 'react';
import type { Printer, Spool } from '@ha-addon/types';
import './Modal.css';

interface ActivateSpoolPrinterModalProps {
  spool: Spool;
  printers: Printer[];
  onConfirm: (printerId: string | null) => void;
  onCancel: () => void;
}

export default function ActivateSpoolPrinterModal({
  spool,
  printers,
  onConfirm,
  onCancel,
}: ActivateSpoolPrinterModalProps) {
  const [printerId, setPrinterId] = useState<string>(printers[0]?.id ?? '');

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content modal-sm" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">Activate spool</h3>
        <p className="modal-message">
          Load <strong>{spool.name}</strong> on a printer, or mark it active without assigning to a printer.
        </p>
        <div className="form-group">
          <label htmlFor="activate-spool-printer">Printer</label>
          <select
            id="activate-spool-printer"
            value={printerId === '' ? '' : printerId}
            onChange={(e) => setPrinterId(e.target.value)}
          >
            <option value="">Active only — not loaded on a printer</option>
            {printers.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => onConfirm(printerId.trim() || null)}>
            Activate
          </button>
        </div>
      </div>
    </div>
  );
}
