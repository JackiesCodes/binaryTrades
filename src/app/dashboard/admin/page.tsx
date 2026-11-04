"use client";

import { useCallback, useEffect, useState } from "react";
import { Search, Users } from "lucide-react";

import { useDashboard } from "@/components/app/dashboard-context";
import { useFeedback } from "@/components/app/feedback";
import { EmptyState, PageSkeleton } from "@/components/app/widgets";
import { AsideTitle, FieldBox, KV, Strip, Workspace } from "@/components/app/workspace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, timeAgo } from "@/lib/client";

interface AdminUser {
  id: string;
  email: string | null;
  display_name: string | null;
  role: "user" | "admin";
  disabled: boolean;
  email_verified: boolean;
  created_at: string;
  last_login_at: string | null;
  brokers: number;
  real_accounts: number;
  bots: number;
  running_bots: number;
  open_trades: number;
}

type Filter = "all" | "admins" | "disabled" | "unconfirmed";
const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "admins", label: "Admins" },
  { value: "disabled", label: "Disabled" },
  { value: "unconfirmed", label: "Unconfirmed" },
];

export default function AdminPage() {
  const { state } = useDashboard();
  const { confirm, toast } = useFeedback();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const me = state?.meta.user.id;

  const load = useCallback(() => {
    api<AdminUser[]>("/api/admin/users").then(setUsers, (e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const update = async (u: AdminUser, patch: { disabled?: boolean; role?: "user" | "admin" }) => {
    const label = u.email ?? u.display_name ?? "this account";
    const ok = await confirm(
      patch.disabled === true
        ? {
            title: `Disable ${label}?`,
            description: "They are signed out, can't sign in, and their bots stop with the kill switch (open positions close).",
            confirmLabel: "Disable account",
            danger: true,
          }
        : patch.disabled === false
          ? { title: `Re-enable ${label}?`, description: "They can sign in again. Their bots stay paused until they start them.", confirmLabel: "Re-enable" }
          : {
              title: patch.role === "admin" ? `Make ${label} an administrator?` : `Remove admin rights from ${label}?`,
              description: patch.role === "admin" ? "Administrators can see every account here and disable accounts." : "They keep their account and data.",
              confirmLabel: "Confirm",
            },
    );
    if (!ok) return;
    setBusy(u.id);
    try {
      await api(`/api/admin/users/${u.id}`, "PATCH", patch);
      toast("Account updated", "success");
      load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  if (error) return <EmptyState>{error}</EmptyState>;
  if (!users) return <PageSkeleton />;

  const q = query.trim().toLowerCase();
  const week = Date.now() - 7 * 86400_000;
  const matches = (u: AdminUser) =>
    filter === "all" ||
    (filter === "admins" && u.role === "admin") ||
    (filter === "disabled" && u.disabled) ||
    (filter === "unconfirmed" && Boolean(u.email) && !u.email_verified);
  const shown = users.filter((u) => matches(u) && (!q || `${u.email ?? ""} ${u.display_name ?? ""}`.toLowerCase().includes(q)));
  const count = (f: Filter) => users.filter((u) => f === "all" || (f === "admins" ? u.role === "admin" : f === "disabled" ? u.disabled : Boolean(u.email) && !u.email_verified)).length;

  return (
    <Workspace
      strip={
        <Strip
          icon={Users}
          title="Admin"
          sub="Everyone with a binaryTrades account"
          stats={[
            { label: "Accounts", value: `${users.length} · ${users.filter((u) => Date.parse(u.created_at) > week).length} new` },
            { label: "Active this week", value: String(users.filter((u) => u.last_login_at && Date.parse(u.last_login_at) > week).length) },
            { label: "Running bots", value: String(users.reduce((s, u) => s + u.running_bots, 0)) },
            { label: "Open trades", value: String(users.reduce((s, u) => s + u.open_trades, 0)) },
            {
              label: "Real-money accounts",
              value: String(users.reduce((s, u) => s + u.real_accounts, 0)),
              tone: users.some((u) => u.real_accounts > 0) ? "text-gold" : undefined,
            },
          ]}
        />
      }
      aside={
        <>
          <AsideTitle>Find an account</AsideTitle>
          <FieldBox>
            <label className="flex h-11 items-center gap-2 rounded-xl border border-white/10 bg-black/25 px-3 text-muted-foreground focus-within:border-profit/50">
              <Search className="h-4 w-4 shrink-0" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search email or name"
                aria-label="Search email or name"
                className="min-w-0 flex-1 bg-transparent text-base text-ivory placeholder:text-muted-foreground focus:outline-none sm:text-sm"
              />
            </label>
          </FieldBox>
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-black/30 p-1 text-[13px]">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={
                  filter === f.value
                    ? "truncate rounded-[9px] bg-profit px-2 py-2 font-semibold text-ink"
                    : "truncate rounded-[9px] px-2 py-2 font-medium text-muted-foreground hover:text-ivory"
                }
              >
                {f.label} {count(f.value)}
              </button>
            ))}
          </div>
          <div className="h-px bg-white/[0.06]" />
          <AsideTitle>Platform</AsideTitle>
          <KV
            rows={[
              ["Broker accounts", String(users.reduce((s, u) => s + u.brokers, 0))],
              ["Bots", String(users.reduce((s, u) => s + u.bots, 0))],
              ["Admins", String(count("admins"))],
              ["Disabled", String(count("disabled")), count("disabled") ? "text-loss" : undefined],
              ["Unconfirmed emails", String(count("unconfirmed")), count("unconfirmed") ? "text-gold" : undefined],
            ]}
          />
          <p className="rounded-[14px] bg-black/25 p-3 text-xs text-muted-foreground">
            You never see anyone&apos;s broker keys or passwords. Disabling an account signs it out and stops its bots with the kill switch.
          </p>
        </>
      }
    >
      {shown.length ? (
        shown.map((u) => (
          <article key={u.id} className="grid gap-3 rounded-[18px] bg-panel p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-5">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <span
                  className={
                    u.disabled
                      ? "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-loss/15 text-sm font-semibold text-loss"
                      : "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-profit/15 text-sm font-semibold text-profit"
                  }
                >
                  {initials(u.display_name || u.email)}
                </span>
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="truncate font-bold text-ivory">{u.email ?? "(no email yet)"}</span>
                    {u.id === me && <Badge variant="muted">You</Badge>}
                    {u.role === "admin" && <Badge variant="gold">Admin</Badge>}
                    {u.disabled && <Badge variant="loss">Disabled</Badge>}
                    {!u.email_verified && u.email && <Badge variant="warning">Unconfirmed</Badge>}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{u.display_name || "No name"}</div>
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-x-4 gap-y-2 text-xs sm:grid-cols-5 sm:gap-x-7">
                {[
                  ["Joined", new Date(u.created_at).toLocaleDateString(), ""],
                  ["Last sign-in", timeAgo(u.last_login_at), ""],
                  ["Brokers", u.real_accounts ? `${u.brokers} · ${u.real_accounts} real` : String(u.brokers), u.real_accounts ? "text-gold" : ""],
                  ["Bots running", `${u.running_bots} / ${u.bots}`, ""],
                  ["Open trades", String(u.open_trades), ""],
                ].map(([k, v, tone]) => (
                  <div key={k} className="min-w-0">
                    <dt className="truncate text-muted-foreground">{k}</dt>
                    <dd className={`truncate font-mono text-sm tabular-nums text-ivory ${tone}`}>{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
            {u.id !== me && (
              <div className="flex gap-2 md:flex-col">
                <Button size="sm" variant="outline" disabled={busy === u.id} onClick={() => update(u, { role: u.role === "admin" ? "user" : "admin" })}>
                  {u.role === "admin" ? "Remove admin" : "Make admin"}
                </Button>
                <Button
                  size="sm"
                  variant={u.disabled ? "default" : "outline"}
                  className={u.disabled ? undefined : "border-loss/45 text-loss hover:bg-loss/10 hover:text-loss"}
                  disabled={busy === u.id}
                  onClick={() => update(u, { disabled: !u.disabled })}
                >
                  {u.disabled ? "Re-enable" : "Disable"}
                </Button>
              </div>
            )}
          </article>
        ))
      ) : (
        <EmptyState>No accounts match.</EmptyState>
      )}
    </Workspace>
  );
}

function initials(name: string | null) {
  const parts = (name ?? "").split(/[\s@._-]+/).filter(Boolean);
  return parts.length ? parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") : "?";
}
