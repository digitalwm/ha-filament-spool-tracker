import { normalizeSpoolColorStyle, getSpoolColorStyleLabel } from '@ha-addon/types';
import './SpoolMetaBadges.css';

export interface SpoolMetaBadgesProps {
  filamentType: string;
  colorStyle?: string | null;
  className?: string;
}

/** Material + finish badges (same pattern as SpoolCard). */
export default function SpoolMetaBadges({ filamentType, colorStyle, className }: SpoolMetaBadgesProps) {
  return (
    <div className={`spool-meta-badges ${className ?? ''}`.trim()}>
      <span className="spool-type-badge">{filamentType}</span>
      {normalizeSpoolColorStyle(colorStyle) !== 'solid' && (
        <span className="spool-style-badge" title="Swatch style">
          {getSpoolColorStyleLabel(colorStyle)}
        </span>
      )}
    </div>
  );
}
