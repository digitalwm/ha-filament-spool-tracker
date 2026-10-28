import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { getSpoolColorStyleLabel, normalizeSpoolColorStyle } from '@ha-addon/types';
import SpoolColorSwatch from './SpoolColorSwatch';
import './SpoolSelect.css';

/** Minimal spool shape for dropdown options (dashboard spoolsList is a subset of Spool). */
export interface SpoolOption {
  id: string;
  name: string;
  filamentType: string;
  colorStyle?: string | null;
  color?: string | null;
  colorHex?: string | null;
  /** Remaining filament (g); shown in dropdown and default trigger to disambiguate similar spools */
  remainingWeight?: number;
  /** Projected remaining filament during an active print, before final deduction is committed */
  liveRemainingWeight?: number;
}

interface SpoolSelectProps {
  value: string | null;
  onChange: (spoolId: string | null) => void;
  spools: SpoolOption[];
  placeholder?: string;
  size?: 'sm' | 'md';
  id?: string;
  'aria-label'?: string;
  /** When set, renders this instead of the default trigger (dot + label). Use to show card-style content. */
  renderTrigger?: (selected: SpoolOption | null) => React.ReactNode;
  className?: string;
  dropdownAction?: { label: string; onSelect: () => void; disabled?: boolean };
}

function formatRemaining(weight: number | undefined): string | null {
  if (weight == null || Number.isNaN(weight)) return null;
  return `${Math.round(weight)}g`;
}

/** `PLA/Light Blue` or `PETG/Wood-filled` (finish from colorStyle, fallback to color). Shared with dashboard active-spool line. */
export function formatSpoolMaterialStyleSegment(spool: SpoolOption): string {
  const material = spool.filamentType?.trim() || '?';
  const colorName = spool.color?.trim();
  const styleLabel = getSpoolColorStyleLabel(spool.colorStyle);
  const normalized = normalizeSpoolColorStyle(spool.colorStyle);
  const style =
    normalized === 'solid'
      ? colorName || styleLabel
      : styleLabel || colorName || '?';
  return `${material}/${style}`;
}

export default function SpoolSelect({
  value,
  onChange,
  spools,
  placeholder = 'None',
  size = 'md',
  id,
  'aria-label': ariaLabel,
  renderTrigger,
  className,
  dropdownAction,
}: SpoolSelectProps) {
  const [open, setOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLUListElement>(null);

  const selectedSpool: SpoolOption | null = value ? spools.find((s) => s.id === value) ?? null : null;
  const selectedRemainingLabel = formatRemaining(selectedSpool?.liveRemainingWeight ?? selectedSpool?.remainingWeight);

  useEffect(() => {
    if (!open) return;
    const updateDropdownPosition = () => {
      const trigger = containerRef.current?.querySelector('.spool-select-trigger');
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const viewportPadding = 12;
      const maxWidth = Math.min(520, window.innerWidth - viewportPadding * 2);
      const left = Math.max(viewportPadding, Math.min(rect.left, window.innerWidth - maxWidth - viewportPadding));
      const below = window.innerHeight - rect.bottom - viewportPadding;
      const above = rect.top - viewportPadding;
      const openUp = below < 180 && above > below;
      setDropdownStyle({
        position: 'fixed',
        left,
        top: openUp ? undefined : rect.bottom + 4,
        bottom: openUp ? window.innerHeight - rect.top + 4 : undefined,
        minWidth: Math.min(rect.width, maxWidth),
        maxWidth,
        maxHeight: Math.max(100, Math.min(240, openUp ? above : below)),
        zIndex: 10000,
      });
    };
    updateDropdownPosition();
    window.addEventListener('resize', updateDropdownPosition);
    window.addEventListener('scroll', updateDropdownPosition, true);
    return () => {
      window.removeEventListener('resize', updateDropdownPosition);
      window.removeEventListener('scroll', updateDropdownPosition, true);
    };
  }, [open]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!containerRef.current?.contains(target) && !dropdownRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('click', handleClickOutside);
    }
    return () => document.removeEventListener('click', handleClickOutside);
  }, [open]);

  const dropdown = open && createPortal(
    <ul
      ref={dropdownRef}
      className="spool-select-dropdown spool-select-dropdown-portal"
      style={dropdownStyle}
      role="listbox"
      aria-activedescendant={value ?? undefined}
    >
      <li
        role="option"
        aria-selected={!value}
        className="spool-select-option"
        onClick={() => {
          onChange(null);
          setOpen(false);
        }}
      >
        <span className="spool-select-option-none">{placeholder}</span>
      </li>
      {spools.map((spool) => {
        const remainingLabel = formatRemaining(spool.liveRemainingWeight ?? spool.remainingWeight);
        return (
          <li
            key={spool.id}
            role="option"
            aria-selected={value === spool.id}
            className="spool-select-option"
            onClick={() => {
              onChange(spool.id);
              setOpen(false);
            }}
          >
            <SpoolColorSwatch
              className="spool-select-dot"
              colorHex={spool.colorHex}
              colorStyle={spool.colorStyle}
              colorName={spool.color}
            />
            <span className="spool-select-option-label">
              {spool.name} ({formatSpoolMaterialStyleSegment(spool)})
            </span>
            {remainingLabel && <span className="spool-select-option-weight">{remainingLabel}</span>}
          </li>
        );
      })}
      {dropdownAction && (
        <li className="spool-select-action-row">
          <button
            type="button"
            className="spool-select-action"
            onClick={() => {
              dropdownAction.onSelect();
              setOpen(false);
            }}
            disabled={dropdownAction.disabled}
          >
            {dropdownAction.label}
          </button>
        </li>
      )}
    </ul>,
    document.body,
  );

  return (
    <>
    <div
      ref={containerRef}
      className={`spool-select spool-select-${size} ${open ? 'spool-select-open' : ''} ${className ?? ''}`.trim()}
    >
      <button
        type="button"
        id={id}
        className={`spool-select-trigger ${renderTrigger ? 'spool-select-trigger-custom' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        {renderTrigger ? (
          <>
            {renderTrigger(selectedSpool)}
            <span className="spool-select-chevron" aria-hidden />
          </>
        ) : (
          <>
            {selectedSpool ? (
              <>
                <SpoolColorSwatch
                  className="spool-select-dot"
                  colorHex={selectedSpool.colorHex}
                  colorStyle={selectedSpool.colorStyle}
                  colorName={selectedSpool.color}
                />
                <span className="spool-select-label">
                  {selectedSpool.name} ({formatSpoolMaterialStyleSegment(selectedSpool)})
                  {selectedRemainingLabel && (
                    <span className="spool-select-label-weight"> · {selectedRemainingLabel}</span>
                  )}
                </span>
              </>
            ) : (
              <span className="spool-select-placeholder">{placeholder}</span>
            )}
            <span className="spool-select-chevron" aria-hidden />
          </>
        )}
      </button>
    </div>
    {dropdown}
    </>
  );
}
