import { Bot, CandlestickChart, Code2, FlaskConical, LayoutDashboard, LineChart, PlugZap, Plus, Radio, ScrollText, ShieldCheck, Wallet } from "lucide-react";

import { BrandMark } from "@/components/app/brand";

// A small, static picture of the dashboard for the landing page. Example data only.

const EQUITY = [100, 101.2, 100.6, 101.8, 102.6, 102.1, 103.4, 103, 104.1, 103.7, 104.9, 104.4, 105.6, 106.2, 105.8, 107.1, 106.7, 107.9, 108.4, 108.1];

function chartPath(w: number, h: number) {
  const lo = Math.min(...EQUITY);
  const hi = Math.max(...EQUITY);
  const pts = EQUITY.map((v, i) => [(i / (EQUITY.length - 1)) * w, h - 4 - ((v - lo) / (hi - lo)) * (h - 10)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  return { line, area: `${line} L${w} ${h} L0 ${h} Z`, end: pts[pts.length - 1]! };
}

const RAIL = [[LayoutDashboard, Bot, CandlestickChart], [FlaskConical, Code2], [PlugZap, ShieldCheck, ScrollText]];

export function DashboardPreview() {
  const { line, area, end } = chartPath(400, 120);
  return (
    <figure className="relative" aria-label="Example of the binaryTrades dashboard with demo data">
      <div className="overflow-hidden rounded-[22px] bg-[#0A100D] p-3 shadow-2xl ring-1 ring-white/10">
        {/* top bar */}
        <div className="flex items-center gap-2 px-1 pb-3">
          <BrandMark className="h-5 w-5" />
          <span className="hidden h-7 flex-1 rounded-lg bg-panel sm:block" />
          <span className="ml-auto flex h-7 items-center gap-1.5 rounded-lg bg-panel px-2 font-mono text-[11px] text-ivory">
            <Wallet className="h-3 w-3 text-muted-foreground" /> $10,810.40
          </span>
          <span className="flex h-7 items-center rounded-lg bg-panel px-2 text-[10px] text-ivory">
            <span className="mr-1 rounded bg-white/10 px-1 font-semibold">DEMO</span>
          </span>
          <span className="h-7 w-7 rounded-full bg-profit/15" />
        </div>
        <div className="flex gap-2.5">
          {/* rail */}
          <div className="hidden flex-col gap-2 sm:flex">
            {RAIL.map((group, gi) => (
              <div key={gi} className="flex flex-col gap-1 rounded-2xl bg-panel p-1">
                {group.map((Icon, i) => (
                  <span key={i} className={`flex h-7 w-7 items-center justify-center rounded-full ${gi === 0 && i === 0 ? "bg-profit text-ink" : "text-muted-foreground"}`}>
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                ))}
              </div>
            ))}
          </div>
          {/* main */}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex items-center gap-4 rounded-2xl bg-panel px-3 py-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-profit">
                <Wallet className="h-3.5 w-3.5" />
              </span>
              {[
                ["Equity", "$10,810", ""],
                ["Today", "+$42.10", "text-profit"],
                ["Drawdown", "1.2%", ""],
              ].map(([k, v, tone]) => (
                <div key={k} className="min-w-0">
                  <div className="text-[9px] text-muted-foreground">{k}</div>
                  <div className={`font-mono text-[11px] text-ivory ${tone}`}>{v}</div>
                </div>
              ))}
            </div>
            <div className="rounded-2xl bg-panel p-2.5">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[10px] font-semibold text-ivory">Equity</span>
                <span className="flex gap-1">
                  {["7D", "1M", "All"].map((r) => (
                    <span key={r} className={`rounded-full px-1.5 text-[8px] ${r === "1M" ? "bg-profit text-ink" : "border border-white/10 text-muted-foreground"}`}>
                      {r}
                    </span>
                  ))}
                </span>
              </div>
              <svg viewBox="0 0 400 120" className="h-24 w-full sm:h-28" preserveAspectRatio="none" aria-hidden>
                <defs>
                  <linearGradient id="lp-fill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0" stopColor="#85BB65" stopOpacity="0.3" />
                    <stop offset="1" stopColor="#85BB65" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {[30, 60, 90].map((y) => (
                  <line key={y} x1="0" x2="400" y1={y} y2={y} stroke="rgba(255,255,255,0.06)" strokeDasharray="2 4" />
                ))}
                <path d={area} fill="url(#lp-fill)" />
                <path d={line} fill="none" stroke="#85BB65" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                <circle cx={end[0]} cy={end[1]} r="3.5" fill="#85BB65" />
              </svg>
            </div>
            <div className="rounded-2xl bg-panel px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-[10px]">
                <span className="font-bold text-ivory">EMA 9/21 V75</span>
                <span className="rounded-full bg-sky-400/15 px-1.5 text-[8px] text-sky-300">Open</span>
                <span className="ml-auto font-mono text-profit">+$12.40</span>
              </div>
              <div className="mt-1.5 flex justify-between font-mono text-[9px] text-ivory">
                <span>9,180</span>
                <span>9,412</span>
                <span>9,433</span>
              </div>
              <div className="relative mt-1 h-1 rounded-full bg-white/[0.08]">
                <span className="absolute inset-y-0 left-1/2 w-[38%] rounded-full bg-profit" />
              </div>
              <div className="mt-1 flex justify-between text-[8px] text-muted-foreground">
                <span>Stop</span>
                <span>Target</span>
              </div>
            </div>
          </div>
          {/* side panel */}
          <div className="hidden w-[34%] shrink-0 flex-col gap-2 rounded-2xl bg-panel p-2.5 md:flex">
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-black/30 p-0.5 text-center text-[9px]">
              <span className="rounded-md bg-profit py-1 font-semibold text-ink">Running 2</span>
              <span className="py-1 text-muted-foreground">Paused 0</span>
            </div>
            {[
              [LineChart, "EMA 9/21 V75", "+$41.20"],
              [Radio, "TradingView Gold", "+$18.10"],
            ].map(([Icon, n, p]) => {
              const I = Icon as typeof LineChart;
              return (
                <div key={n as string} className="flex items-center gap-1.5 rounded-lg bg-black/25 px-2 py-1.5">
                  <I className="h-3 w-3 text-profit" />
                  <span className="truncate text-[9px] font-semibold text-ivory">{n as string}</span>
                  <span className="ml-auto font-mono text-[9px] text-profit">{p as string}</span>
                </div>
              );
            })}
            <span className="flex items-center justify-center gap-1 rounded-lg bg-profit py-1.5 text-[10px] font-bold text-ink">
              <Plus className="h-3 w-3" /> New bot
            </span>
            <div className="mt-1 text-[9px] font-semibold text-ivory">Risk Guard</div>
            {[
              ["Daily loss", "$0 / $250"],
              ["Drawdown", "1.2% / 15%"],
              ["Kill switch", "Off"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between text-[9px]">
                <span className="text-muted-foreground">{k}</span>
                <span className="font-mono text-ivory">{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <figcaption className="mt-2 text-center text-[11px] text-muted-foreground">Example dashboard with demo data · not a performance claim</figcaption>
    </figure>
  );
}
