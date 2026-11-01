import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

import { APPLIED_CHECKS, MIGRATIONS } from "@/lib/trading/schema";

describe("database schema", () => {
  it.each(MIGRATIONS.map((m) => [m.file, m.sql]))("%s matches supabase/migrations", (file, sql) => {
    expect(sql).toBe(readFileSync(`supabase/migrations/${file}`, "utf8"));
  });

  it("applies cleanly, twice, and leaves no paper mode behind", async () => {
    const db = new PGlite();
    for (let run = 0; run < 2; run++) for (const m of MIGRATIONS) await db.exec(m.sql);
    const tables = await db.query<{ n: number }>("select count(*)::int as n from information_schema.tables where table_schema = 'public'");
    expect(tables.rows[0]!.n).toBe(12);
    const book = await db.query("select 1 from information_schema.columns where table_name = 'bots' and column_name = 'book'");
    expect(book.rows).toHaveLength(0);
    await expect(db.exec("insert into equity (id, user_id, book, equity) values ('x', 'owner', 'paper', 1)")).rejects.toThrow();
    await db.exec("insert into equity (id, user_id, book, equity) values ('y', 'owner', 'demo', 1)");
    await db.close();
  });

  it("reports each migration as done exactly when its changes are in place", async () => {
    const db = new PGlite();
    for (const m of MIGRATIONS) {
      expect((await db.query<{ done: boolean }>(APPLIED_CHECKS[m.file])).rows[0]!.done).toBe(false);
      await db.exec(m.sql);
      expect((await db.query<{ done: boolean }>(APPLIED_CHECKS[m.file])).rows[0]!.done).toBe(true);
    }
    await db.close();
  });

  it("re-labels existing live trades by their account and drops paper ones", async () => {
    const db = new PGlite();
    await db.exec(MIGRATIONS[0].sql);
    await db.exec(`
      insert into brokers (id, kind, label, status, is_demo) values ('d', 'deriv', 'Deriv demo', 'connected', true);
      insert into trades (id, broker_account_id, book, symbol, side, size, size_unit, status)
        values ('t1', 'd', 'live', 'R_75', 'buy', 1, 'stake', 'closed'),
               ('t2', null, 'paper', 'R_75', 'buy', 1, 'units', 'closed');
    `);
    await db.exec(MIGRATIONS[1].sql);
    const { rows } = await db.query<{ id: string; book: string }>("select id, book from trades order by id");
    expect(rows).toEqual([{ id: "t1", book: "demo" }]);
    await db.close();
  });

  it("moves the single owner's data and password into the owner account", async () => {
    const db = new PGlite();
    for (const m of MIGRATIONS.slice(0, 4)) await db.exec(m.sql);
    await db.exec(`
      insert into profile (id, display_name, password_hash, session_version) values ('owner', 'Me', 'scrypt$x', 3);
      insert into settings (id, books) values ('global', '{}'::jsonb);
      insert into brokers (id, kind, label, status, is_demo) values ('d', 'deriv', 'Deriv demo', 'connected', true);
      insert into logs (id, level, message) values ('l', 'info', 'hi');
    `);
    await db.exec(MIGRATIONS[4].sql);
    await db.exec(MIGRATIONS[4].sql); // idempotent
    const owner = await db.query<{ role: string; password_hash: string; session_version: number; display_name: string }>("select * from users where id = 'owner'");
    expect(owner.rows[0]).toMatchObject({ role: "admin", password_hash: "scrypt$x", session_version: 3, display_name: "Me" });
    expect((await db.query<{ user_id: string }>("select user_id from brokers")).rows[0]!.user_id).toBe("owner");
    expect((await db.query<{ user_id: string }>("select user_id from logs")).rows[0]!.user_id).toBe("owner");
    expect((await db.query<{ id: string }>("select id from settings")).rows[0]!.id).toBe("owner");
    await expect(db.exec("insert into bots (id, name, source, symbol, data_symbol, timeframe, status, risk_percent, magic, webhook_passphrase) values ('b', 'x', 'builtin', 'R_75', 'R_75', 60, 'paused', 1, 1, 'p')")).rejects.toThrow();
    await db.close();
  });
});
