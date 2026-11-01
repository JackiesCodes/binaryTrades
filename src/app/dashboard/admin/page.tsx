"use client";

import { useCallback, useEffect, useState } from "react";

import { useDashboard } from "@/components/app/dashboard-context";
import { useFeedback } from "@/components/app/feedback";
import { EmptyState, Kpi, PageHeader, PageSkeleton, Panel } from "@/components/app/widgets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

export default function AdminPage() {
  const { state } = useDashboard();
  const { confirm, toast } = useFeedback();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
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
  const shown = q ? users.filter((u) => `${u.email ?? ""} ${u.display_name ?? ""}`.toLowerCase().includes(q)) : users;
  const week = Date.now() - 7 * 86400_000;

  return (
    <div className="space-y-5">
      <PageHeader title="Admin" description="Everyone with a binaryTrades account. You never see their broker keys or passwords." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Accounts" value={String(users.length)} sub={`${users.filter((u) => Date.parse(u.created_at) > week).length} new this week`} />
        <Kpi label="Active this week" value={String(users.filter((u) => u.last_login_at && Date.parse(u.last_login_at) > week).length)} />
        <Kpi label="Running bots" value={String(users.reduce((s, u) => s + u.running_bots, 0))} />
        <Kpi label="Real-money accounts" value={String(users.reduce((s, u) => s + u.real_accounts, 0))} />
      </div>
      <Panel title="Accounts" action={<Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search email or name" className="h-9 w-56" />}>
        {shown.length ? (
          <div className="scrollbar-thin overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="px-2 py-2 font-medium">Account</th>
                  <th className="px-2 py-2 font-medium">Joined</th>
                  <th className="px-2 py-2 font-medium">Last sign-in</th>
                  <th className="px-2 py-2 font-medium">Brokers</th>
                  <th className="px-2 py-2 font-medium">Bots</th>
                  <th className="px-2 py-2 font-medium">Open trades</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {shown.map((u) => (
                  <tr key={u.id} className="border-t border-white/5">
                    <td className="px-2 py-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{u.email ?? "(no email yet)"}</span>
                        {u.role === "admin" && <Badge variant="gold">Admin</Badge>}
                        {u.disabled && <Badge variant="loss">Disabled</Badge>}
                        {!u.email_verified && u.email && <Badge variant="warning">Unconfirmed</Badge>}
                      </div>
                      {u.display_name && <div className="text-xs text-muted-foreground">{u.display_name}</div>}
                    </td>
                    <td className="px-2 py-2.5 text-muted-foreground">{new Date(u.created_at).toLocaleDateString()}</td>
                    <td className="px-2 py-2.5 text-muted-foreground">{timeAgo(u.last_login_at)}</td>
                    <td className="px-2 py-2.5 font-mono">
                      {u.brokers}
                      {u.real_accounts > 0 && <span className="text-gold"> ({u.real_accounts} real)</span>}
                    </td>
                    <td className="px-2 py-2.5 font-mono">
                      {u.running_bots}/{u.bots}
                    </td>
                    <td className="px-2 py-2.5 font-mono">{u.open_trades}</td>
                    <td className="px-2 py-2.5 text-right">
                      {u.id !== me && (
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" disabled={busy === u.id} onClick={() => update(u, { role: u.role === "admin" ? "user" : "admin" })}>
                            {u.role === "admin" ? "Remove admin" : "Make admin"}
                          </Button>
                          <Button
                            size="sm"
                            variant={u.disabled ? "outline" : "ghost"}
                            className={u.disabled ? undefined : "text-loss"}
                            disabled={busy === u.id}
                            onClick={() => update(u, { disabled: !u.disabled })}
                          >
                            {u.disabled ? "Re-enable" : "Disable"}
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState>No accounts match.</EmptyState>
        )}
      </Panel>
    </div>
  );
}
