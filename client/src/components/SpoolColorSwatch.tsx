import type { SpoolColorStyle } from '@ha-addon/types';
import { normalizeSpoolColorStyle } from '@ha-addon/types';
import './SpoolColorSwatch.css';

function resolveHex(colorHex: string | null | undefined, colorNameFallback?: string | null): string {
  const raw = (colorHex || '').trim();
  if (raw.startsWith('#') && raw.length >= 4) return raw;
  const n = (colorNameFallback || '').trim();
  if (n.startsWith('#') && n.length >= 4) return n;
  return '#6e7681';
}

export interface SpoolColorSwatchProps {
  colorHex: string | null | undefined;
  colorStyle?: string | null;
  /** Named color from spool (fallback if hex missing). */
  colorName?: string | null;
  className?: string;
  title?: string;
}

/**
 * Renders a spool color dot with optional finish (metallic, wood grain, multicolor ring, etc.).
 */
export default function SpoolColorSwatch({
  colorHex,
  colorStyle,
  colorName,
  className = '',
  title,
}: SpoolColorSwatchProps) {
  const hex = resolveHex(colorHex, colorName);
  const style: SpoolColorStyle = normalizeSpoolColorStyle(colorStyle);
  return (
    <span
      className={`spool-swatch spool-swatch--${style} ${className}`.trim()}
      style={{ ['--swatch-fill' as string]: hex }}
      title={title}
      aria-hidden
    />
  );
}
