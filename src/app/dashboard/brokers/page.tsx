"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Download, PlugZap, RefreshCw, Trash2, Wallet } from "lucide-react";

import { useDashboard } from "@/components/app/dashboard-context";
import { useFeedback } from "@/components/app/feedback";
import { BrokerStatusBadge, CopyRow, EmptyState, Field, PageSkeleton, Panel } from "@/components/app/widgets";
import { AsideTitle, FieldBox, IconTile, KV, Strip, Switcher, Workspace } from "@/components/app/workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, money, timeAgo } from "@/lib/client";
import type { PublicBroker } from "@/lib/trading/state";

export default function BrokersPage() {
  return (
    <Suspense>
      <BrokersPageInner />
    </Suspense>
  );
}

function BrokersPageInner() {
  const { state } = useDashboard();
  const params = useSearchParams();
  const [bridge, setBridge] = useState<{ key: string; label: string } | null>(null);
  const [kind, setKind] = useState<"deriv" | "mt5">("deriv");
  const connectRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (params.get("connect")) setTimeout(() => connectRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  }, [params]);

  if (!state) return <PageSkeleton />;
  const brokers = state.brokers;
  const attention = brokers.filter((b) => b.status !== "connected");
  const demoEq = brokers.filter((b) => b.is_demo).reduce((s, b) => s + b.equity, 0);
  const realEq = brokers.filter((b) => !b.is_demo).reduce((s, b) => s + b.equity, 0);
  const lastSync = brokers.map((b) => b.last_sync_at).filter(Boolean).sort().pop() ?? null;

  return (
    <Workspace
      asideFirstOnPhone={!brokers.length}
      strip={
        <Strip
          icon={PlugZap}
          title="Accounts"
          sub="Deriv & MetaTrader 5"
          stats={[
            { label: "Connected", value: String(brokers.length - attention.length) },
            { label: "Needs attention", value: String(attention.length), tone: attention.length ? "text-amber-300" : undefined },
            { label: "Demo equity", value: money(demoEq) },
            { label: "Real equity", value: money(realEq), tone: realEq ? "text-gold" : undefined },
            { label: "Last sync", value: lastSync ? timeAgo(lastSync) : "—" },
          ]}
        />
      }
      aside={
        <div ref={connectRef} className="flex scroll-mt-24 flex-col gap-3.5">
          <AsideTitle icon={PlugZap}>Connect broker</AsideTitle>
          <Switcher
            value={kind}
            onChange={setKind}
            options={[
              { value: "deriv", label: "Deriv" },
              { value: "mt5", label: "MetaTrader 5" },
            ]}
          />
          {kind === "deriv" ? <DerivConnect /> : <ExnessConnect onCreated={setBridge} />}
          <div className="h-px bg-white/[0.06]" />
          <KV rows={[["Can trade", "Yes", "text-profit"], ["Can withdraw", "Never"], ["Keys stored", "Encrypted"]]} />
        </div>
      }
    >
      {bridge && <BridgeInstructions bridgeKey={bridge.key} label={bridge.label} onDone={() => setBridge(null)} />}
      {brokers.length ? (
        brokers.map((b) => <BrokerRow key={b.id} broker={b} onReconnect={() => connectRef.current?.scrollIntoView({ behavior: "smooth" })} />)
      ) : (
        <EmptyState>
          No accounts yet. Start with a demo account: connect Deriv with an API token, or any MetaTrader 5 broker (like Exness) with the bridge EA.
        </EmptyState>
      )}
    </Workspace>
  );
}

function BrokerRow({ broker, onReconnect }: { broker: PublicBroker; onReconnect: () => void }) {
  const { refresh } = useDashboard();
  const { confirm, toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  const act = async (method: "POST" | "DELETE") => {
    if (
      method === "DELETE" &&
      !(await confirm({
        title: `Disconnect ${broker.label}?`,
        description: "Bots using this account pause until you choose another account for them.",
        confirmLabel: "Disconnect",
        danger: true,
      }))
    ) {
      return;
    }
    setBusy(true);
    try {
      await api(`/api/brokers/${broker.id}`, method);
      await refresh();
      toast(method === "DELETE" ? `${broker.label} disconnected` : "Account synced", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const needsKeys = broker.kind === "deriv" && broker.status === "error";
  return (
    <article className="grid gap-3 rounded-[18px] bg-panel p-4 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center md:gap-5">
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <IconTile icon={Wallet} tone={broker.is_demo ? "profit" : "gold"} />
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="truncate font-bold text-ivory">{broker.label}</span>
              <BrokerStatusBadge broker={broker} />
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {broker.kind === "mt5" ? "MetaTrader 5" : "Deriv API"}
              {broker.login ? ` · ${broker.login}${broker.server ? ` · ${broker.server}` : ""}` : ""} ·{" "}
              <span className={broker.is_demo ? undefined : "font-semibold text-gold"}>{broker.is_demo ? "DEMO" : "REAL"}</span>
            </div>
          </div>
        </div>
        {broker.error && <div className="mt-2 text-xs text-amber-300">{broker.error}</div>}
        <dl className="mt-3 grid grid-cols-3 gap-x-4 text-xs sm:w-fit sm:gap-x-8">
          {[
            ["Balance", money(broker.balance, broker.currency)],
            ["Equity", money(broker.equity, broker.currency)],
            ["Synced", broker.last_sync_at ? timeAgo(broker.last_sync_at) : "never"],
          ].map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="truncate font-mono text-sm tabular-nums text-ivory">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div>
        {needsKeys && (
          <Button size="sm" onClick={onReconnect}>
            <RefreshCw /> Reconnect
          </Button>
        )}
      </div>
      <div className="flex gap-1 text-muted-foreground md:flex-col">
        {broker.kind === "deriv" && (
          <button onClick={() => act("POST")} disabled={busy} className="rounded-lg p-1.5 hover:bg-white/[0.06] hover:text-ivory" aria-label="Sync now" title="Sync now">
            <RefreshCw className="h-4 w-4" />
          </button>
        )}
        <button onClick={() => act("DELETE")} disabled={busy} className="rounded-lg p-1.5 hover:bg-loss/10 hover:text-loss" aria-label="Disconnect" title="Disconnect">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </article>
  );
}

function ExnessConnect({ onCreated }: { onCreated: (b: { key: string; label: string }) => void }) {
  const { refresh } = useDashboard();
  const { toast } = useFeedback();
  const [label, setLabel] = useState("Exness MT5");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const res = await api<{ bridge_key: string; broker: PublicBroker }>("/api/brokers", "POST", { kind: "mt5", label });
      onCreated({ key: res.bridge_key, label: res.broker.label });
      await refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Exness trades through MetaTrader 5. You run the small <b className="text-foreground">binaryTrades Bridge</b> EA in your MT5 terminal; it
        executes the orders and reports positions back here. Works with any MT5 broker (Deriv MT5 too).
      </p>
      <FieldBox>
        <Field label="Account name">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={create} disabled={busy}>
            {busy ? "Creating…" : "Generate bridge key"}
          </Button>
          <Button variant="outline" asChild>
            <a href="/downloads/BinaryTradesBridge.mq5" download>
              <Download /> Download EA
            </a>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          The MT5 terminal must stay running for bots to trade. A Windows VPS keeps it online 24/7.
        </p>
      </FieldBox>
      <p className="rounded-lg bg-gold/[0.08] px-3 py-2 text-xs text-gold">
        Bridge EA v2: bots and scripts can trade on your MT5 broker&apos;s own prices. If you installed the EA before, download it again, replace the
        old file and recompile.
      </p>
    </div>
  );
}

function BridgeInstructions({ bridgeKey, label, onDone }: { bridgeKey: string; label: string; onDone: () => void }) {
  const url = typeof window === "undefined" ? "" : window.location.origin;
  return (
    <Panel title={`Finish connecting ${label}`} className="border-seal">
      <p className="mb-3 text-sm text-amber-300">Copy the bridge key now — it is shown only once.</p>
      <div className="space-y-3">
        <CopyRow label="Server URL" value={url} />
        <CopyRow label="Bridge key" value={bridgeKey} />
      </div>
      <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
        <li>
          In MT5: <b className="text-foreground">File → Open Data Folder → MQL5 → Experts</b>, copy <code>BinaryTradesBridge.mq5</code> there, then
          right-click it in the Navigator → <b className="text-foreground">Compile</b> (or open it in MetaEditor and press F7).
        </li>
        <li>
          <b className="text-foreground">Tools → Options → Expert Advisors</b>: tick <i>Allow algorithmic trading</i> and <i>Allow WebRequest for listed URL</i>, and
          add <code>{url}</code>.
        </li>
        <li>Drag <b className="text-foreground">BinaryTradesBridge</b> onto any one chart. Paste the Server URL and Bridge key into its inputs and press OK.</li>
        <li>Make sure the <b className="text-foreground">Algo Trading</b> button in the toolbar is green. This page shows “Connected” within a few seconds.</li>
      </ol>
      <Button variant="outline" className="mt-4" onClick={onDone}>
        I&apos;ve saved the key
      </Button>
    </Panel>
  );
}

function DerivConnect() {
  const { refresh } = useDashboard();
  const { toast } = useFeedback();
  const [token, setToken] = useState("");
  const [appId, setAppId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ brokers: PublicBroker[] }>("/api/brokers", "POST", { kind: "deriv", token, app_id: appId.trim() });
      setToken("");
      await refresh();
      const n = res.brokers.length;
      toast(n === 1 ? `${res.brokers[0]!.label} connected` : `${n} Deriv accounts connected`, "success");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Trades Deriv forex, gold, crypto and Volatility indices as <b className="text-foreground">Multiplier</b> contracts, with stop-loss
        and take-profit set on every trade.
      </p>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>
          Sign in at <b className="text-foreground">developers.deriv.com</b> with your Deriv login and register an app — copy its{" "}
          <b className="text-foreground">App ID</b>.
        </li>
        <li>
          Create a <b className="text-foreground">Personal Access Token</b> with the <b className="text-foreground">trade</b> scope only (never
          payment).
        </li>
        <li>Paste both below. Each Deriv Options account the token can reach (demo and real) is connected separately.</li>
      </ol>
      <FieldBox>
        <Input value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="App ID" autoComplete="off" aria-label="Deriv App ID" />
        <Input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Personal Access Token"
          autoComplete="off"
          aria-label="Deriv Personal Access Token"
        />
      </FieldBox>
      {error && <p className="text-sm text-loss">{error}</p>}
      <Button onClick={connect} disabled={busy || token.length < 8 || !appId.trim()} className="h-12 w-full text-[15px] font-bold">
        <PlugZap /> {busy ? "Checking…" : "Connect"}
      </Button>
    </div>
  );
}
