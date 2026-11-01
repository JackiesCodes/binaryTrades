import { NextResponse } from "next/server";

import { withAdmin } from "@/lib/auth/users";
import { getStore } from "@/lib/trading/store";

export const dynamic = "force-dynamic";

/** Admin: every account with its activity counts (no secrets). */
export const GET = withAdmin(async () => {
  const store = getStore();
  const [users, brokers, bots, trades] = await Promise.all([
    store.users.all({ order: { field: "created_at", ascending: false } }),
    store.brokers.all(),
    store.bots.all(),
    store.trades.all({ in: { field: "status", values: ["open", "pending"] } }),
  ]);
  const count = <T extends { user_id: string }>(rows: T[], id: string, f: (r: T) => boolean = () => true) =>
    rows.filter((r) => r.user_id === id && f(r)).length;
  return NextResponse.json(
    users.map((u) => ({
      id: u.id,
      email: u.email,
      display_name: u.display_name,
      role: u.role,
      disabled: u.disabled,
      email_verified: Boolean(u.email_verified_at),
      created_at: u.created_at,
      last_login_at: u.last_login_at,
      brokers: count(brokers, u.id),
      real_accounts: count(brokers, u.id, (b) => !b.is_demo),
      bots: count(bots, u.id),
      running_bots: count(bots, u.id, (b) => b.status === "running"),
      open_trades: count(trades, u.id),
    })),
  );
});
