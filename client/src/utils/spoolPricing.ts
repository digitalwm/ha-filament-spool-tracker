import type { Spool } from '@ha-addon/types';

export function hasSpoolPrice(spool: Pick<Spool, 'purchasePrice' | 'initialWeight'> | null | undefined): boolean {
  return spool?.purchasePrice != null && Number.isFinite(spool.purchasePrice) && spool.purchasePrice > 0 && spool.initialWeight > 0;
}

export function pricePerGram(spool: Pick<Spool, 'purchasePrice' | 'initialWeight'> | null | undefined): number | null {
  if (!hasSpoolPrice(spool)) return null;
  return spool!.purchasePrice! / spool!.initialWeight;
}

export function costForGrams(spool: Pick<Spool, 'purchasePrice' | 'initialWeight'> | null | undefined, grams: number | null | undefined): number | null {
  const unit = pricePerGram(spool);
  if (unit == null || grams == null || !Number.isFinite(grams)) return null;
  return Math.max(0, grams) * unit;
}

export function remainingValue(spool: Pick<Spool, 'purchasePrice' | 'initialWeight' | 'remainingWeight'>, remainingOverride?: number): number | null {
  return costForGrams(spool, remainingOverride ?? spool.remainingWeight);
}

export function usedValue(spool: Pick<Spool, 'purchasePrice' | 'initialWeight' | 'remainingWeight'>, remainingOverride?: number): number | null {
  const remaining = remainingOverride ?? spool.remainingWeight;
  return costForGrams(spool, Math.max(0, spool.initialWeight - remaining));
}

export function formatMoney(value: number | null | undefined, currency: string | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  const code = currency || 'EUR';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: code, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toFixed(2)} ${code}`;
  }
}

export function formatPricePerKg(spool: Pick<Spool, 'purchasePrice' | 'initialWeight' | 'priceCurrency'>): string | null {
  const unit = pricePerGram(spool);
  if (unit == null) return null;
  return formatMoney(unit * 1000, spool.priceCurrency);
}
