export const SPOOL_COLOR_STYLES = [
  'solid',
  'translucent',
  'silk',
  'metallic',
  'wood',
  'carbon',
  'fiber',
  'multicolor',
  'matte',
  'glow',
] as const;

export type SpoolColorStyle = (typeof SPOOL_COLOR_STYLES)[number];

export function normalizeSpoolColorStyle(raw: string | null | undefined): SpoolColorStyle {
  const v = (raw || 'solid').trim().toLowerCase();
  return (SPOOL_COLOR_STYLES as readonly string[]).includes(v) ? (v as SpoolColorStyle) : 'solid';
}

/** Labels for settings / add-spool form (English UI). */
export const SPOOL_COLOR_STYLE_OPTIONS: { value: SpoolColorStyle; label: string }[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'matte', label: 'Matte' },
  { value: 'translucent', label: 'Translucent' },
  { value: 'silk', label: 'Silk / glossy' },
  { value: 'metallic', label: 'Metallic' },
  { value: 'wood', label: 'Wood-filled' },
  { value: 'carbon', label: 'Carbon fiber' },
  { value: 'fiber', label: 'Glass / fiber-filled' },
  { value: 'multicolor', label: 'Multicolor / gradient' },
  { value: 'glow', label: 'Glow-in-the-dark' },
];

export function getSpoolColorStyleLabel(style: string | null | undefined): string {
  const v = normalizeSpoolColorStyle(style);
  return SPOOL_COLOR_STYLE_OPTIONS.find((o) => o.value === v)?.label ?? v;
}
