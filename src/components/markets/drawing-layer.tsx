"use client";

import { useEffect, useRef, useState } from "react";
import { Trash2, X } from "lucide-react";

import { formatPrice } from "@/lib/markets/bars";
import { DRAW_TOOLS, fibLevels, newDrawing, type DrawPoint, type DrawTool, type Drawing } from "@/lib/markets/drawings";
import type { Palette } from "@/lib/markets/theme";

/** Screen ↔ chart conversions for the price pane, provided by the chart. */
export interface ChartCoords {
  /** Size of the price pane (without the price and time axes). */
  pane(): { width: number; height: number } | null;
  timeToX(time: number): number | null;
  priceToY(price: number): number | null;
  /** Chart position (candle index, fractional) under x, and the time there. */
  xToLogical(x: number): number | null;
  logicalToTime(l: number): number;
  timeToLogical(time: number): number;
  yToPrice(y: number): number | null;
}

interface Drag {
  id: string;
  /** null = move the whole drawing; otherwise the point being dragged. */
  point: number | null;
  startLogical: number;
  startPrice: number;
  orig: Drawing;
  moved: boolean;
}

const HIT = 14;

/**
 * SVG layer over the price pane: draws, selects, moves and deletes trend lines, horizontal lines
 * and Fibonacci retracements. Drawings are stored in time / price, so they follow zoom and scroll.
 */
export function DrawingLayer({
  coords,
  drawings,
  onChange,
  tool,
  onToolDone,
  palette,
  decimals,
}: {
  coords: ChartCoords;
  drawings: Drawing[];
  onChange: (next: Drawing[]) => void;
  tool: DrawTool | null;
  onToolDone: () => void;
  palette: Palette;
  decimals: number;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState<{ points: DrawPoint[]; clicked: boolean } | null>(null);
  const [draft, setDraft] = useState<Drawing | null>(null); // the drawing being dragged
  const drag = useRef<Drag | null>(null);
  const [, redraw] = useState(0);
  const signature = useRef("");

  // Redraw whenever the chart moves (scroll, zoom, autoscale, resize, new candles).
  const shown = draft ? drawings.map((d) => (d.id === draft.id ? draft : d)) : drawings;
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const pane = coords.pane();
      const pts = [...shownRef.current.flatMap((d) => d.points), ...(pendingRef.current?.points ?? [])];
      let sig = pane ? `${pane.width}x${pane.height}` : "none";
      for (const p of pts) sig += `|${Math.round((coords.timeToX(p.time) ?? -1) * 2)},${Math.round((coords.priceToY(p.price) ?? -1) * 2)}`;
      if (sig !== signature.current) {
        signature.current = sig;
        redraw((n) => n + 1);
      }
      raf = requestAnimationFrame(loop);
    };
    if (drawings.length || pending || tool) raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [coords, drawings.length, pending, tool]);

  // Selection goes when its drawing does (another market, deleted).
  useEffect(() => {
    if (selected && !drawings.some((d) => d.id === selected)) setSelected(null);
  }, [drawings, selected]);

  // A new tool cancels a half-made drawing and clears the selection.
  useEffect(() => {
    setPending(null);
    if (tool) setSelected(null);
  }, [tool]);

  const remove = (id: string) => {
    onChange(drawings.filter((d) => d.id !== id));
    setSelected(null);
  };

  // Keyboard: Esc cancels drawing / clears selection; Delete removes the selected drawing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (e.key === "Escape") {
        if (tool || pending) {
          setPending(null);
          onToolDone();
          e.preventDefault();
        } else if (selected) setSelected(null);
      } else if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        remove(selected);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, pending, selected, drawings]);

  // Tapping empty chart clears the selection.
  useEffect(() => {
    const host = svg.current?.parentElement;
    if (!host || !selected) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element).closest?.("[data-drawing]") && !(e.target as Element).closest?.("[data-drawing-ui]")) setSelected(null);
    };
    host.addEventListener("pointerdown", onDown);
    return () => host.removeEventListener("pointerdown", onDown);
  }, [selected]);

  const local = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const toPoint = (x: number, y: number): DrawPoint | null => {
    const l = coords.xToLogical(x);
    const price = coords.yToPrice(y);
    if (l === null || price === null) return null;
    return { time: coords.logicalToTime(l), price };
  };
  const finish = (points: DrawPoint[]) => {
    const d = newDrawing(tool!, points);
    onChange([...drawings, d]);
    setSelected(d.id);
    setPending(null);
    onToolDone();
  };

  // --- placing a new drawing --------------------------------------------------
  const onPlaceDown = (e: React.PointerEvent) => {
    if (!tool) return;
    e.preventDefault();
    const { x, y } = local(e);
    const p = toPoint(x, y);
    if (!p) return;
    svg.current?.setPointerCapture(e.pointerId);
    if (tool === "hline") return finish([p]);
    if (!pending) setPending({ points: [p, p], clicked: false });
  };
  const onPlaceMove = (e: React.PointerEvent) => {
    if (!tool || !pending) return;
    const { x, y } = local(e);
    const p = toPoint(x, y);
    if (p) setPending({ ...pending, points: [pending.points[0]!, p] });
  };
  const onPlaceUp = (e: React.PointerEvent) => {
    if (!tool || !pending) return;
    const { x, y } = local(e);
    const p = toPoint(x, y) ?? pending.points[1]!;
    const a = pending.points[0]!;
    const ax = coords.timeToX(a.time) ?? x;
    const ay = coords.priceToY(a.price) ?? y;
    const dragged = Math.hypot(x - ax, y - ay) > 6;
    if (dragged || pending.clicked) finish([a, p]);
    else setPending({ points: [a, p], clicked: true }); // first click: wait for the second
  };

  // --- moving existing drawings -----------------------------------------------
  const startDrag = (e: React.PointerEvent, d: Drawing, point: number | null) => {
    if (tool) return;
    e.stopPropagation();
    e.preventDefault();
    const { x, y } = local(e);
    const l = coords.xToLogical(x);
    const price = coords.yToPrice(y);
    setSelected(d.id);
    if (l === null || price === null) return;
    drag.current = { id: d.id, point, startLogical: l, startPrice: price, orig: d, moved: false };
    svg.current?.setPointerCapture(e.pointerId);
  };
  const onDragMove = (e: React.PointerEvent) => {
    const g = drag.current;
    if (!g) return;
    const { x, y } = local(e);
    const l = coords.xToLogical(x);
    const price = coords.yToPrice(y);
    if (l === null || price === null) return;
    const dl = l - g.startLogical;
    const dp = price - g.startPrice;
    if (!g.moved && Math.abs(dl) < 0.05 && Math.abs(dp) < 1e-12) return;
    g.moved = true;
    const shift = (p: DrawPoint, i: number) => {
      if (g.point !== null && g.point !== i) return p;
      const t = g.orig.type === "hline" ? p.time : coords.logicalToTime(coords.timeToLogical(p.time) + dl);
      return { time: t, price: p.price + dp };
    };
    setDraft({ ...g.orig, points: g.orig.points.map(shift) });
  };
  const onDragEnd = () => {
    const g = drag.current;
    drag.current = null;
    if (g?.moved && draft) onChange(drawings.map((d) => (d.id === draft.id ? draft : d)));
    setDraft(null);
  };

  // --- render ---------------------------------------------------------------------
  const pane = coords.pane();
  if (!pane) return null;
  const xy = (p: DrawPoint) => ({ x: coords.timeToX(p.time), y: coords.priceToY(p.price) });
  const color = palette.accent;
  const label = (d: Drawing) => DRAW_TOOLS.find((t) => t.id === d.type)!.label;

  const renderDrawing = (d: Drawing, preview = false) => {
    const sel = !preview && d.id === selected;
    const width = sel ? 2.5 : 1.5;
    const hit = (props: React.SVGProps<SVGLineElement>) =>
      preview ? null : (
        <line
          {...props}
          stroke="transparent"
          strokeWidth={HIT}
          style={{ pointerEvents: tool ? "none" : "stroke", cursor: "move" }}
          onPointerDown={(e) => startDrag(e, d, null)}
        />
      );
    const handle = (i: number, x: number, y: number) =>
      sel ? (
        <g key={`h${i}`} style={{ cursor: "grab", pointerEvents: "all" }} onPointerDown={(e) => startDrag(e, d, i)}>
          <circle cx={x} cy={y} r={12} fill="transparent" />
          <circle cx={x} cy={y} r={5} fill={palette.panel} stroke={color} strokeWidth={2} />
        </g>
      ) : null;

    if (d.type === "hline") {
      const y = coords.priceToY(d.points[0]!.price);
      if (y === null) return null;
      return (
        <g key={d.id} data-drawing={d.id}>
          {hit({ x1: 0, y1: y, x2: pane.width, y2: y })}
          <line x1={0} y1={y} x2={pane.width} y2={y} stroke={color} strokeWidth={width} />
          <text x={pane.width - 6} y={y - 5} textAnchor="end" fontSize={11} fill={color} style={{ fontFamily: "var(--font-mono, monospace)" }}>
            {formatPrice(d.points[0]!.price, decimals)}
          </text>
          {handle(0, pane.width / 2, y)}
        </g>
      );
    }

    const a = xy(d.points[0]!);
    const b = xy(d.points[1]!);
    if (a.x === null || a.y === null || b.x === null || b.y === null) return null;

    if (d.type === "trend") {
      return (
        <g key={d.id} data-drawing={d.id}>
          {hit({ x1: a.x, y1: a.y, x2: b.x, y2: b.y })}
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={width} strokeLinecap="round" />
          {handle(0, a.x, a.y)}
          {handle(1, b.x, b.y)}
        </g>
      );
    }

    // Fibonacci retracement
    const left = Math.min(a.x, b.x);
    const right = Math.max(a.x, b.x);
    const levels = fibLevels(d.points[0]!, d.points[1]!).map((l) => ({ ...l, y: coords.priceToY(l.price) }));
    const y382 = levels.find((l) => l.ratio === 0.382)?.y;
    const y618 = levels.find((l) => l.ratio === 0.618)?.y;
    return (
      <g key={d.id} data-drawing={d.id}>
        {y382 != null && y618 != null && (
          <rect x={left} y={Math.min(y382, y618)} width={right - left} height={Math.abs(y618 - y382)} fill={color} opacity={0.08} />
        )}
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={1} strokeDasharray="4 4" opacity={0.7} />
        {hit({ x1: a.x, y1: a.y, x2: b.x, y2: b.y })}
        {levels.map((l) =>
          l.y === null ? null : (
            <g key={l.ratio}>
              {hit({ x1: left, y1: l.y, x2: right, y2: l.y })}
              <line
                x1={left}
                y1={l.y}
                x2={right}
                y2={l.y}
                stroke={color}
                strokeWidth={l.ratio === 0 || l.ratio === 1 ? width : 1}
                opacity={l.ratio === 0.5 ? 0.6 : 0.9}
              />
              <text x={left + 4} y={l.y - 3} fontSize={10} fill={color} style={{ fontFamily: "var(--font-mono, monospace)" }}>
                {l.ratio} ({formatPrice(l.price, decimals)})
              </text>
            </g>
          ),
        )}
        {handle(0, a.x, a.y)}
        {handle(1, b.x, b.y)}
      </g>
    );
  };

  const selectedDrawing = drawings.find((d) => d.id === selected);
  const placing = Boolean(tool);
  const preview = pending && tool && tool !== "hline" ? { id: "preview", type: tool, points: pending.points } : null;

  return (
    <>
      <svg
        ref={svg}
        className="absolute left-0 top-0 z-[5]"
        width={pane.width}
        height={pane.height}
        style={{
          pointerEvents: placing || drag.current ? "all" : "none",
          cursor: placing ? "crosshair" : undefined,
          touchAction: placing ? "none" : undefined,
        }}
        onPointerDown={onPlaceDown}
        onPointerMove={(e) => (drag.current ? onDragMove(e) : onPlaceMove(e))}
        onPointerUp={(e) => (drag.current ? onDragEnd() : onPlaceUp(e))}
        onPointerCancel={() => (drag.current ? onDragEnd() : setPending(null))}
        aria-hidden
      >
        {shown.map((d) => renderDrawing(d))}
        {preview && <g opacity={0.8}>{renderDrawing(preview, true)}</g>}
      </svg>
      {placing && (
        <div
          data-drawing-ui
          className="pointer-events-none absolute bottom-3 left-1/2 z-20 max-w-[calc(100%-1rem)] -translate-x-1/2 rounded-full border border-[var(--mk-border)] bg-[var(--mk-panel)] px-3 py-1 text-xs text-[var(--mk-text)] shadow-glass"
          role="status"
        >
          {DRAW_TOOLS.find((t) => t.id === tool)!.label}:{" "}
          {tool === "hline" ? "tap the price" : pending ? "tap the second point" : "tap or drag from the first point"} · Esc to cancel
        </div>
      )}
      {selectedDrawing && !placing && (
        <div
          data-drawing-ui
          className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border border-[var(--mk-border)] bg-[var(--mk-panel)] py-1 pl-3 pr-1 text-xs text-[var(--mk-text)] shadow-glass"
        >
          <span>{label(selectedDrawing)}</span>
          <button
            type="button"
            onClick={() => remove(selectedDrawing.id)}
            className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-[var(--mk-down)] hover:bg-[var(--mk-raised)]"
            aria-label={`Delete ${label(selectedDrawing)}`}
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[var(--mk-muted)] hover:bg-[var(--mk-raised)]"
            aria-label="Deselect"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </>
  );
}
