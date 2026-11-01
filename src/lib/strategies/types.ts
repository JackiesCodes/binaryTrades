export interface Candle {
  epoch: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface ParamSpec {
  key: string;
  label: string;
  default: number;
  /** Values the optimiser tries. */
  grid: number[];
}

export interface StrategyDefinition {
  id: string;
  name: string;
  style: string;
  description: string;
  params: ParamSpec[];
  /**
   * Desired position after each bar closes: 1 long, -1 short, 0 flat.
   * Must only use data up to and including bar i (no look-ahead).
   */
  positions(candles: Candle[], params: Record<string, number>): Int8Array;
  /**
   * Optional stop / target prices for trades the strategy opens on bar i (scripts can set
   * them). Missing or invalid values fall back to the ATR stop and reward:risk target.
   */
  levels?(candles: Candle[], params: Record<string, number>): Map<number, { stop: number | null; target: number | null }>;
}
