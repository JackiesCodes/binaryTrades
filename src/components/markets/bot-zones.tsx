"use client";

import { useEffect, useRef, useState } from "react";

import { bucketStart, formatPrice } from "@/lib/markets/bars";
import type { BotPreviewTrade } from "@/lib/markets/bot-view";
import type { Palette } from "@/lib/markets/theme";
import type { ChartCoords } from "@/components/markets/drawing-layer";

/**
 * A bot's trades as position zones over the price pane, like a trading-platform position tool: green
 * from entry to target, red from entry to stop, from the candle it opened to the one it closed. A
 * trade still open reaches the right edge, labelled with its stop and target. Purely visual: touches
 * and clicks go through to the chart.
 */
export function BotZones({
  coords,
  trades,
  timeframe,
  palette,
  decimals,
}: {
  coords: ChartCoords;
  trades: BotPreviewTrade[];
  timeframe: number;
  palette: Palette;
  decimals: number;
}) {
  const [, redraw] = useState(0);
  const signature = useRef("");
  const tradesRef = useRef(trades);
  tradesRef.current = trades;

  // Redraw when the chart moves (scroll, zoom, autoscale, resize, new candles).
  useEffect(() => {
    if (!trades.length) return;
    let raf = 0;
    const loop = () => {
      const pane = coords.pane();
      const t = tradesRef.current;
      let sig = pane ? `${pane.width}x${pane.height}|${t.length}` : "none";
      const first = t[0];
      const last = t[t.length - 1];
      for (const x of [first, last]) {
        if (!x) continue;
        sig += `|${Math.round(coords.timeToX(bucketStart(x.entry_epoch, timeframe)) ?? -1)},${Math.round(coords.priceToY(x.entry) ?? -1)},${Math.round(coords.priceToY(x.stop) ?? -1)}`;
      }
      if (sig !== signature.current) {
        signature.current = sig;
        redraw((n) => n + 1);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [coords, trades.length, timeframe]);

  const pane = coords.pane();
  if (!pane || !trades.length) return null;
  const halfBar = (() => {
    const t0 = bucketStart(trades[trades.length - 1]!.entry_epoch, timeframe);
    const a = coords.timeToX(t0 - timeframe);
    const b = coords.timeToX(t0);
    return a !== null && b !== null ? Math.max(1, Math.abs(b - a) / 2) : 3;
  })();

  const zones = trades.flatMap((t, i) => {
    const x1 = coords.timeToX(bucketStart(t.entry_epoch, timeframe));
    const open = t.reason === "end";
    const x2 = open ? pane.width : coords.timeToX(bucketStart(t.exit_epoch, timeframe));
    const yEntry = coords.priceToY(t.entry);
    const yStop = coords.priceToY(t.stop);
    const yTarget = t.target !== null ? coords.priceToY(t.target) : null;
    if (x1 === null || x2 === null || yEntry === null || yStop === null) return [];
    const left = Math.max(0, x1 - halfBar);
    const right = Math.min(pane.width, open ? pane.width : x2 + halfBar);
    if (right <= 0 || left >= pane.width || right - left < 1) return [];
    const w = right - left;
    return [
      <g key={i}>
        <rect x={left} y={Math.min(yEntry, yStop)} width={w} height={Math.max(1, Math.abs(yStop - yEntry))} fill={palette.down} opacity={open ? 0.2 : 0.13} />
        {yTarget !== null && (
          <rect x={left} y={Math.min(yEntry, yTarget)} width={w} height={Math.max(1, Math.abs(yTarget - yEntry))} fill={palette.up} opacity={open ? 0.2 : 0.13} />
        )}
        <line x1={left} x2={right} y1={yEntry} y2={yEntry} stroke={palette.text} strokeOpacity={0.55} strokeWidth={1} />
        {open && (
          <>
            <line x1={left} x2={right} y1={yStop} y2={yStop} stroke={palette.down} strokeWidth={1} strokeDasharray="4 3" />
            {yTarget !== null && <line x1={left} x2={right} y1={yTarget} y2={yTarget} stroke={palette.up} strokeWidth={1} strokeDasharray="4 3" />}
            {/* Labels against the price axis, on a backing so candles don't hide them. */}
            <ZoneLabel x={pane.width - 4} y={yStop + (yStop > yEntry ? 12 : -12)} color={palette.down} bg={palette.panel} text={`Bot stop ${formatPrice(t.stop, decimals)}`} />
            {yTarget !== null && t.target !== null && (
              <ZoneLabel x={pane.width - 4} y={yTarget + (yTarget > yEntry ? 12 : -12)} color={palette.up} bg={palette.panel} text={`Bot target ${formatPrice(t.target, decimals)}`} />
            )}
          </>
        )}
      </g>,
    ];
  });

  return (
    <svg className="pointer-events-none absolute left-0 top-0 z-[5]" width={pane.width} height={pane.height} aria-hidden>
      {zones}
    </svg>
  );
}

function ZoneLabel({ x, y, color, bg, text }: { x: number; y: number; color: string; bg: string; text: string }) {
  const w = text.length * 6.4 + 10; // 11px semibold, close enough without measuring
  return (
    <g>
      <rect x={x - w} y={y - 9} width={w} height={18} rx={4} fill={bg} opacity={0.85} />
      <text x={x - 5} y={y} fill={color} fontSize={11} fontWeight={600} textAnchor="end" dominantBaseline="central">
        {text}
      </text>
    </g>
  );
}
