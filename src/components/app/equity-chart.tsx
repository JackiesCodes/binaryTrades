"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { money } from "@/lib/client";

export type ChartRange = "1D" | "7D" | "1M" | "All";
export const CHART_RANGES: ChartRange[] = ["1D", "7D", "1M", "All"];
const RANGE_MS: Record<ChartRange, number> = { "1D": 864e5, "7D": 7 * 864e5, "1M": 30 * 864e5, All: Infinity };

/** Keep the points inside the chosen range (always at least the last two). */
export function inRange<T extends { x: number }>(points: T[], range: ChartRange): T[] {
  if (range === "All" || points.length < 3) return points;
  const from = points[points.length - 1]!.x - RANGE_MS[range];
  const kept = points.filter((p) => p.x >= from);
  return kept.length >= 2 ? kept : points.slice(-2);
}

function niceStep(span: number, count: number) {
  const raw = span / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}

/** Equity over time with a price axis, dates and a hover readout. */
export function EquityChart({ points, height: tall = 280, currency = "USD" }: { points: Array<{ x: number; y: number }>; height?: number; currency?: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState<number | null>(null);
  const height = width < 520 ? Math.min(tall, 210) : tall;

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(240, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geo = useMemo(() => {
    if (points.length < 2) return null;
    const L = width < 420 ? 46 : 62;
    const R = 12;
    const T = 10;
    const B = 24;
    const ys = points.map((p) => p.y);
    let lo = Math.min(...ys);
    let hi = Math.max(...ys);
    if (hi - lo < 1e-9) {
      lo -= 1;
      hi += 1;
    }
    const step = niceStep(hi - lo, 4);
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    const x0 = points[0]!.x;
    const x1 = points[points.length - 1]!.x;
    const sx = (x: number) => L + ((x - x0) / (x1 - x0 || 1)) * (width - L - R);
    const sy = (y: number) => T + (1 - (y - lo) / (hi - lo)) * (height - T - B);
    const ticks: number[] = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
    const short = x1 - x0 < 2 * 864e5;
    const fmtDate = (ms: number) =>
      new Date(ms).toLocaleString(undefined, short ? { hour: "2-digit", minute: "2-digit" } : { month: "short", day: "numeric" });
    const n = width < 420 ? 3 : 5;
    const labels = Array.from({ length: n }, (_, i) => x0 + ((x1 - x0) * i) / (n - 1));
    return { L, R, T, B, sx, sy, ticks, fmtDate, labels, step };
  }, [points, width, height]);

  if (!geo) {
    return (
      <div ref={wrap} className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
        Not enough data yet — the curve fills in as the engine runs.
      </div>
    );
  }

  const { L, R, B, sx, sy, ticks, fmtDate, labels, step } = geo;
  const up = points[points.length - 1]!.y >= points[0]!.y;
  const stroke = up ? "#85BB65" : "#D9634F";
  const line = points.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(" ");
  const last = points[points.length - 1]!;
  const h = hover !== null ? points[hover] : null;
  const axis = (v: number) =>
    step >= 1000 ? `${(v / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}k` : v.toLocaleString(undefined, { maximumFractionDigits: step < 1 ? 2 : 0 });

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = 0;
    let dist = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(sx(p.x) - px);
      if (d < dist) {
        dist = d;
        best = i;
      }
    });
    setHover(best);
  };

  return (
    <div ref={wrap} className="relative w-full select-none">
      <svg
        width={width}
        height={height}
        className="block touch-pan-y"
        role="img"
        aria-label={`Equity from ${money(points[0]!.y, currency)} to ${money(last.y, currency)}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="eq-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={stroke} stopOpacity="0.26" />
            <stop offset="1" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={width - R} y1={sy(v)} y2={sy(v)} stroke="rgba(255,255,255,0.06)" strokeDasharray="2 4" />
            <text x={L - 10} y={sy(v) + 4} textAnchor="end" fontSize="11" fill="#8E9C93">
              {axis(v)}
            </text>
          </g>
        ))}
        {labels.map((x, i) => (
          <text key={i} x={sx(x)} y={height - 6} textAnchor={i === 0 ? "start" : i === labels.length - 1 ? "end" : "middle"} fontSize="11" fill="#8E9C93">
            {fmtDate(x)}
          </text>
        ))}
        <path d={`${line} L${sx(last.x)} ${height - B} L${sx(points[0]!.x)} ${height - B} Z`} fill="url(#eq-fill)" />
        <path d={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" />
        <circle cx={sx(last.x)} cy={sy(last.y)} r="4" fill={stroke} />
        {h && (
          <g>
            <line x1={sx(h.x)} x2={sx(h.x)} y1={10} y2={height - B} stroke="rgba(237,232,216,0.25)" strokeDasharray="3 3" />
            <circle cx={sx(h.x)} cy={sy(h.y)} r="4.5" fill="#0B120F" stroke={stroke} strokeWidth="2" />
          </g>
        )}
      </svg>
      {h && (
        <div
          className="pointer-events-none absolute top-1 rounded-lg bg-[#16211B] px-2.5 py-1.5 text-xs shadow-lg ring-1 ring-white/10"
          style={{ left: Math.min(Math.max(sx(h.x) - 60, L), width - 140) }}
        >
          <div className="text-muted-foreground">{new Date(h.x).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
          <div className="font-mono font-semibold tabular-nums text-ivory">{money(h.y, currency)}</div>
        </div>
      )}
    </div>
  );
}
