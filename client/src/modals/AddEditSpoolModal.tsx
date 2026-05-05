import { useState, useEffect, useRef } from 'react';
import type { Spool, SpoolColorStyle, SpoolCreateRequest } from '@ha-addon/types';
import { DEFAULT_NEW_SPOOL_WEIGHT_GRAMS } from '@utils/defaultNewSpoolWeight';
import { normalizeSpoolColorStyle, SPOOL_COLOR_STYLE_OPTIONS } from '@ha-addon/types';
import SpoolColorSwatch from '@components/SpoolColorSwatch';
import './Modal.css';

const FILAMENT_BASE_TYPES = ['PLA', 'PETG', 'TPU', 'ABS', 'ASA', 'Nylon', 'PC', 'PVA', 'HIPS'] as const;

function splitFilamentBase(ft: string): { base: string; custom: string } {
  if ((FILAMENT_BASE_TYPES as readonly string[]).includes(ft)) {
    return { base: ft, custom: '' };
  }
  return { base: 'Other', custom: ft };
}

function resolvedFilamentType(filamentBase: string, filamentCustom: string): string {
  return filamentBase === 'Other' ? filamentCustom.trim() || 'Other' : filamentBase;
}

const PRESET_COLORS: { name: string; hex: string }[] = [
  { name: 'White', hex: '#ffffff' },
  { name: 'Black', hex: '#1a1a1a' },
  { name: 'Gray', hex: '#808080' },
  { name: 'Red', hex: '#d62828' },
  { name: 'Orange', hex: '#f77f00' },
  { name: 'Yellow', hex: '#fcbf49' },
  { name: 'Green', hex: '#2d6a4f' },
  { name: 'Lime', hex: '#80b918' },
  { name: 'Blue', hex: '#1d3557' },
  { name: 'Light Blue', hex: '#48cae4' },
  { name: 'Purple', hex: '#7b2cbf' },
  { name: 'Pink', hex: '#ff69b4' },
  { name: 'Brown', hex: '#6f4518' },
  { name: 'Beige', hex: '#d4a373' },
  { name: 'Silver', hex: '#c0c0c0' },
  { name: 'Gold', hex: '#c9a227' },
  { name: 'Transparent', hex: '#e8e8e8' },
];

function matchColorName(spool: Spool | null | undefined): string {
  if (spool?.color) {
    const match = PRESET_COLORS.find((c) => c.name === spool.color);
    return match?.name ?? PRESET_COLORS[0].name;
  }
  return PRESET_COLORS[0].name;
}

interface AddEditSpoolModalProps {
  spool?: Spool | null;
  /** Used for new spools only: pre-fills initial and remaining weight (grams). */
  defaultWeightGrams?: number;
  onSave: (data: SpoolCreateRequest) => void;
  onCancel: () => void;
}

export default function AddEditSpoolModal({
  spool,
  defaultWeightGrams = DEFAULT_NEW_SPOOL_WEIGHT_GRAMS,
  onSave,
  onCancel,
}: AddEditSpoolModalProps) {
  const initialSplit = spool ? splitFilamentBase(spool.filamentType) : { base: 'PLA', custom: '' };
  const [filamentBase, setFilamentBase] = useState(initialSplit.base);
  const [filamentCustom, setFilamentCustom] = useState(initialSplit.custom);
  const [selectedColor, setSelectedColor] = useState(() => matchColorName(spool));
  const [colorStyle, setColorStyle] = useState<SpoolColorStyle>(() => normalizeSpoolColorStyle(spool?.colorStyle));

  const [name, setName] = useState(() => {
    if (spool?.name) return spool.name;
    const r = resolvedFilamentType(initialSplit.base, initialSplit.custom);
    return `${r} - ${matchColorName(spool)}`;
  });
  /** Skip first effect run so we do not overwrite the loaded name on edit (or initial add name). */
  const skipMaterialColorNameUpdateOnce = useRef(true);

  const [manufacturer, setManufacturer] = useState(spool?.manufacturer ?? '');
  const [initialWeight, setInitialWeight] = useState(String(spool?.initialWeight ?? defaultWeightGrams));
  const [remainingWeight, setRemainingWeight] = useState(
    String(spool?.remainingWeight ?? spool?.initialWeight ?? defaultWeightGrams),
  );

  const prevDefaultWeightGrams = useRef(defaultWeightGrams);
  useEffect(() => {
    if (spool) {
      prevDefaultWeightGrams.current = defaultWeightGrams;
      return;
    }
    if (prevDefaultWeightGrams.current === defaultWeightGrams) return;
    prevDefaultWeightGrams.current = defaultWeightGrams;
    setInitialWeight(String(defaultWeightGrams));
    setRemainingWeight(String(defaultWeightGrams));
  }, [spool, defaultWeightGrams]);

  useEffect(() => {
    if (skipMaterialColorNameUpdateOnce.current) {
      skipMaterialColorNameUpdateOnce.current = false;
      return;
    }
    const r = resolvedFilamentType(filamentBase, filamentCustom);
    setName(`${r} - ${selectedColor}`);
  }, [filamentBase, filamentCustom, selectedColor]);

  const [spoolWeight, setSpoolWeight] = useState(String(spool?.spoolWeight ?? ''));
  const [diameter, setDiameter] = useState(String(spool?.diameter ?? 1.75));
  const [purchaseDate, setPurchaseDate] = useState(spool?.purchaseDate?.split('T')[0] ?? '');
  const [expirationDate, setExpirationDate] = useState(spool?.expirationDate?.split('T')[0] ?? '');
  const [notes, setNotes] = useState(spool?.notes ?? '');

  const getColorHex = () => PRESET_COLORS.find((c) => c.name === selectedColor)?.hex ?? '#ffffff';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const rType = resolvedFilamentType(filamentBase, filamentCustom);
    const finalName = name.trim() || `${rType} - ${selectedColor}`;
    onSave({
      name: finalName,
      filamentType: rType,
      colorStyle,
      color: selectedColor,
      colorHex: getColorHex(),
      manufacturer: manufacturer || undefined,
      initialWeight: parseFloat(initialWeight),
      remainingWeight: parseFloat(remainingWeight),
      spoolWeight: spoolWeight ? parseFloat(spoolWeight) : undefined,
      diameter: parseFloat(diameter),
      purchaseDate: purchaseDate || undefined,
      expirationDate: expirationDate || undefined,
      notes: notes || undefined,
    });
  };

  const isEditing = !!spool;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">{isEditing ? 'Edit Spool' : 'Add New Spool'}</h3>
        <form onSubmit={handleSubmit} className="modal-form">
          <div className="form-row">
            <div className="form-group">
              <label>Filament material *</label>
              <select
                value={filamentBase}
                onChange={(e) => setFilamentBase(e.target.value)}
                required
              >
                {[...FILAMENT_BASE_TYPES, 'Other'].map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Swatch style</label>
              <select
                value={colorStyle}
                onChange={(e) => setColorStyle(normalizeSpoolColorStyle(e.target.value))}
              >
                {SPOOL_COLOR_STYLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          {filamentBase === 'Other' && (
            <div className="form-group">
              <label>Custom material</label>
              <input
                type="text"
                value={filamentCustom}
                onChange={(e) => setFilamentCustom(e.target.value)}
                placeholder="e.g. PETG CF, PAHT-CF…"
                autoComplete="off"
              />
            </div>
          )}

          <div className="form-group">
            <label>Spool name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus={!isEditing}
              autoComplete="off"
            />
          </div>

          <div className="form-group">
            <label>Color *</label>
            <div className="color-palette">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  className={`color-swatch ${selectedColor === c.name ? 'selected' : ''}`}
                  onClick={() => setSelectedColor(c.name)}
                  title={c.name}
                >
                  <SpoolColorSwatch colorHex={c.hex} colorStyle={colorStyle} colorName={c.name} />
                </button>
              ))}
            </div>
            <span className="form-hint">Selected: {selectedColor}</span>
          </div>

          <div className="form-group">
            <label>Manufacturer</label>
            <input type="text" value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} placeholder="e.g., Bambu Lab, Prusament..." />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Initial Weight (g) *</label>
              <input type="number" value={initialWeight} onChange={(e) => setInitialWeight(e.target.value)} min="1" required />
            </div>
            <div className="form-group">
              <label>Remaining Weight (g) *</label>
              <input type="number" value={remainingWeight} onChange={(e) => setRemainingWeight(e.target.value)} min="0" required />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Spool Weight (g)</label>
              <input type="number" value={spoolWeight} onChange={(e) => setSpoolWeight(e.target.value)} min="0" placeholder="Empty spool weight" />
            </div>
            <div className="form-group">
              <label>Diameter (mm)</label>
              <input type="number" value={diameter} onChange={(e) => setDiameter(e.target.value)} min="1" step="0.01" />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Purchase Date</label>
              <input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Expiration Date</label>
              <input type="date" value={expirationDate} onChange={(e) => setExpirationDate(e.target.value)} />
            </div>
          </div>

          <div className="form-group">
            <label>Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Optional notes..." />
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
            <button type="submit" className="btn btn-primary">{isEditing ? 'Save Changes' : 'Add Spool'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
