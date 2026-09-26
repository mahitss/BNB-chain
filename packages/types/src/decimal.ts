/**
 * Scaled-decimal arithmetic on BigInt — the financial-math foundation for
 * spread/divergence calculations. Deliberately dependency-free.
 *
 * Representation: value = unscaled / 10^scale (e.g. "61.746364" →
 * 61746364n @ scale 6). All operations are exact except division, which
 * rounds half-away-from-zero to a documented number of decimal places.
 * NaN/Infinity cannot occur by construction.
 */

export interface ScaledDecimal {
  value: bigint;
  scale: number;
}

/**
 * Parses a plain decimal string ("123.45", "-0.5", "100"). Rejects
 * scientific notation, empty strings, and anything non-numeric.
 */
export function parseDecimal(input: string): ScaledDecimal | null {
  const trimmed = input.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return null;
  }
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [intPart, fracPart = ""] = unsigned.split(".");
  const value = BigInt((negative ? "-" : "") + intPart + fracPart);
  return { value, scale: fracPart.length };
}

export function rescale(value: bigint, fromScale: number, toScale: number): bigint {
  if (toScale < fromScale) {
    throw new Error("rescale() cannot reduce scale without rounding");
  }
  return value * 10n ** BigInt(toScale - fromScale);
}

/**
 * Integer division rounded half-away-from-zero (documented rounding rule):
 * roundDiv(5, 2) = 3, roundDiv(-5, 2) = -3, roundDiv(4, 2) = 2.
 */
export function roundDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    throw new Error("roundDiv() division by zero");
  }
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = n / d;
  const remainder = n % d;
  const rounded = remainder * 2n >= d ? q + 1n : q;
  return negative ? -rounded : rounded;
}

export function formatDecimal(unscaled: bigint, scale: number): string {
  const negative = unscaled < 0n;
  const digits = (negative ? -unscaled : unscaled).toString().padStart(scale + 1, "0");
  const intPart = digits.slice(0, digits.length - scale);
  const fracPart = digits.slice(digits.length - scale);
  return (negative ? "-" : "") + intPart + (scale > 0 ? "." + fracPart : "");
}
