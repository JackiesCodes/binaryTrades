import "server-only";

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";

import { APPLIED_CHECKS, MIGRATIONS } from "@/lib/trading/schema";

import type {
  AuthToken,
  Bot,
  BrokerAccount,
  EquityPoint,
  EventLog,
  MarketData,
  Mt5Command,
  Settings,
  Signal,
  Trade,
  User,
} from "@/lib/trading/types";

/**
 * Persistence layer. Two backends implement the same tiny collection API:
 *
 *  - Supabase (Postgres) when NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *    are set — use this for serverless hosting (Vercel etc.).
 *  - A JSON file (DATA_FILE, default .data/binarytrades.json) otherwise — fine for
 *    running on your own PC or a VPS, which is also where the bot runner lives.
 */

type Row = { id: string };

export interface Query<T> {
  eq?: Partial<T>;
  in?: { field: keyof T; values: unknown[] };
  order?: { field: keyof T; ascending?: boolean };
  limit?: number;
  since?: { field: keyof T; value: string };
}

export interface Collection<T extends Row> {
  all(query?: Query<T>): Promise<T[]>;
  get(id: string): Promise<T | null>;
  insert(row: T): Promise<T>;
  update(id: string, patch: Partial<T>): Promise<T | null>;
  remove(id: string): Promise<void>;
}

export interface Store {
  backend: "supabase" | "file";
  settings: Collection<Settings>;
  brokers: Collection<BrokerAccount>;
  bots: Collection<Bot>;
  trades: Collection<Trade>;
  signals: Collection<Signal>;
  commands: Collection<Mt5Command>;
  logs: Collection<EventLog>;
  equity: Collection<EquityPoint>;
  users: Collection<User>;
  auth_tokens: Collection<AuthToken>;
  market_data: Collection<MarketData>;
}

const TABLES = ["settings", "brokers", "bots", "trades", "signals", "commands", "logs", "equity", "users", "auth_tokens", "market_data"] as const;
type TableName = (typeof TABLES)[number];

// Logs, signals and equity points grow forever; the file backend keeps the newest N.
const FILE_RETENTION: Partial<Record<TableName, number>> = { logs: 2000, signals: 2000, equity: 5000 };

// ---------------------------------------------------------------------------
// File backend

type FileData = Record<TableName, Row[]>;

function matches<T>(row: T, query?: Query<T>): boolean {
  if (!query) return true;
  if (query.eq) {
    for (const [key, value] of Object.entries(query.eq)) {
      if (row[key as keyof T] !== value) return false;
    }
  }
  if (query.in && !query.in.values.includes(row[query.in.field])) return false;
  if (query.since && String(row[query.since.field]) < query.since.value) return false;
  return true;
}

function applyQuery<T>(rows: T[], query?: Query<T>): T[] {
  let result = rows.filter((row) => matches(row, query));
  if (query?.order) {
    const { field, ascending = true } = query.order;
    result = [...result].sort((a, b) => {
      const av = a[field];
      const bv = b[field];
      if (av === bv) return 0;
      return (av! < bv! ? -1 : 1) * (ascending ? 1 : -1);
    });
  }
  if (query?.limit !== undefined) result = result.slice(0, query.limit);
  return result;
}

class FileBackend {
  private data: FileData;
  private writeTimer: NodeJS.Timeout | null = null;
  private writeWarned = false;

  constructor(private readonly path: string) {
    this.data = Object.fromEntries(TABLES.map((t) => [t, []])) as unknown as FileData;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<FileData>;
      for (const table of TABLES) this.data[table] = parsed[table] ?? [];
    } catch {
      // First run, or unreadable file: start empty.
    }
    this.migrateToMultiUser();
  }

  /** Same as migration 0005: data from the single-owner version belongs to the user "owner". */
  private migrateToMultiUser() {
    const owned = ["brokers", "bots", "trades", "signals", "logs", "equity"] as const;
    let legacy = false;
    for (const table of owned) {
      for (const row of this.data[table] as Array<Row & { user_id?: string | null }>) {
        if (row.user_id === undefined) {
          row.user_id = "owner";
          legacy = true;
        }
        if (table === "bots" && (row as { price_source?: string }).price_source === undefined) {
          (row as { price_source?: string }).price_source = "deriv";
        }
      }
    }
    for (const row of this.data.settings) if (row.id === "global") (row as { id: string }).id = "owner";
    const profile = (this.data as unknown as Record<string, Array<Record<string, unknown>>>).profile?.[0];
    if ((legacy || profile) && !this.data.users.some((u) => u.id === "owner")) {
      const now = new Date().toISOString();
      (this.data.users as unknown as User[]).push({
        id: "owner",
        email: typeof profile?.email === "string" ? profile.email.toLowerCase() : null,
        display_name: (profile?.display_name as string | null) ?? null,
        password_hash: (profile?.password_hash as string | null) ?? null,
        role: "admin",
        email_verified_at: null,
        session_version: Number(profile?.session_version ?? 1),
        disabled: false,
        accepted_terms_at: null,
        password_changed_at: (profile?.password_changed_at as string | null) ?? null,
        last_login_at: null,
        created_at: now,
        updated_at: now,
      });
    }
  }

  private scheduleWrite() {
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      for (const [table, keep] of Object.entries(FILE_RETENTION)) {
        const rows = this.data[table as TableName];
        if (rows.length > keep) this.data[table as TableName] = rows.slice(rows.length - keep);
      }
      try {
        mkdirSync(dirname(this.path), { recursive: true });
        writeFileSync(this.path, JSON.stringify(this.data));
      } catch (error) {
        if (!this.writeWarned) {
          this.writeWarned = true;
          console.warn(`[binaryTrades] could not write ${this.path}; data will not survive a restart`, error);
        }
      }
    }, 250);
  }

  collection<T extends Row>(table: TableName): Collection<T> {
    const rows = () => this.data[table] as unknown as T[];
    return {
      all: async (query) => applyQuery(rows(), query).map((r) => structuredClone(r)),
      get: async (id) => {
        const row = rows().find((r) => r.id === id);
        return row ? structuredClone(row) : null;
      },
      insert: async (row) => {
        rows().push(structuredClone(row));
        this.scheduleWrite();
        return row;
      },
      update: async (id, patch) => {
        const row = rows().find((r) => r.id === id);
        if (!row) return null;
        Object.assign(row, patch);
        this.scheduleWrite();
        return structuredClone(row);
      },
      remove: async (id) => {
        this.data[table] = this.data[table].filter((r) => r.id !== id);
        this.scheduleWrite();
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Supabase backend

const globalForSchema = globalThis as unknown as { __amoganaSchema?: Promise<void> };

/**
 * Creates the tables on first use when a direct Postgres URL is available
 * (the Vercel ↔ Supabase integration sets POSTGRES_URL_NON_POOLING), so no
 * manual migration is needed. Idempotent; runs at most once per server process.
 */
function ensureSchema(): Promise<void> {
  const url = process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL;
  if (!url) return Promise.resolve();
  globalForSchema.__amoganaSchema ??= (async () => {
    const sql = postgres(url, { ssl: "require", max: 1, prepare: false, onnotice: () => {} });
    try {
      // Apply, in order, every migration whose changes are not in place yet (all are idempotent).
      let applied = 0;
      for (const migration of MIGRATIONS) {
        const [row] = await sql.unsafe(APPLIED_CHECKS[migration.file]);
        if (row?.done) continue;
        await sql.unsafe(migration.sql);
        applied++;
        console.info(`[binaryTrades] applied ${migration.file}`);
      }
      if (applied) {
        // Make the Supabase REST API see the changes immediately, then give it a moment.
        await sql`notify pgrst, 'reload schema'`;
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    } finally {
      await sql.end({ timeout: 5 });
    }
  })().catch((error) => {
    globalForSchema.__amoganaSchema = undefined; // retry on the next request
    console.error("[binaryTrades] could not create database tables", error);
  });
  return globalForSchema.__amoganaSchema;
}

function supabaseCollection<T extends Row>(client: SupabaseClient, table: TableName): Collection<T> {
  const fail = (op: string, error: { message: string }): never => {
    throw new Error(`[store] ${table}.${op}: ${error.message}`);
  };
  const from = async () => {
    await ensureSchema();
    return client.from(table);
  };
  return {
    all: async (query) => {
      let q = (await from()).select("*");
      if (query?.eq) for (const [k, v] of Object.entries(query.eq)) q = q.eq(k, v as string);
      if (query?.in) q = q.in(String(query.in.field), query.in.values as string[]);
      if (query?.since) q = q.gte(String(query.since.field), query.since.value);
      if (query?.order) q = q.order(String(query.order.field), { ascending: query.order.ascending ?? true });
      if (query?.limit !== undefined) q = q.limit(query.limit);
      const { data, error } = await q;
      if (error) fail("all", error);
      return (data ?? []) as T[];
    },
    get: async (id) => {
      const { data, error } = await (await from()).select("*").eq("id", id).maybeSingle();
      if (error) fail("get", error);
      return (data as T | null) ?? null;
    },
    insert: async (row) => {
      const { data, error } = await (await from()).insert(row).select("*").single();
      if (error) fail("insert", error);
      return data as T;
    },
    update: async (id, patch) => {
      const { data, error } = await (await from()).update(patch).eq("id", id).select("*").maybeSingle();
      if (error) fail("update", error);
      return (data as T | null) ?? null;
    },
    remove: async (id) => {
      const { error } = await (await from()).delete().eq("id", id);
      if (error) fail("remove", error);
    },
  };
}

// ---------------------------------------------------------------------------

function buildStore(): Store {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (url && serviceKey && !url.includes("your-project")) {
    const client = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      // Next.js caches fetch() responses in its Data Cache unless told not to. Database reads must
      // always be live — a cached "list accounts" response made the dashboard show no accounts.
      global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
    });
    const c = <T extends Row>(t: TableName) => supabaseCollection<T>(client, t);
    return {
      backend: "supabase",
      settings: c("settings"),
      brokers: c("brokers"),
      bots: c("bots"),
      trades: c("trades"),
      signals: c("signals"),
      commands: c("commands"),
      logs: c("logs"),
      equity: c("equity"),
      users: c("users"),
      auth_tokens: c("auth_tokens"),
      market_data: c("market_data"),
    };
  }

  const file = new FileBackend(process.env.DATA_FILE ?? ".data/binarytrades.json");
  return {
    backend: "file",
    settings: file.collection("settings"),
    brokers: file.collection("brokers"),
    bots: file.collection("bots"),
    trades: file.collection("trades"),
    signals: file.collection("signals"),
    commands: file.collection("commands"),
    logs: file.collection("logs"),
    equity: file.collection("equity"),
    users: file.collection("users"),
    auth_tokens: file.collection("auth_tokens"),
    market_data: file.collection("market_data"),
  };
}

// Survive Next.js dev hot reloads without re-reading the file.
const globalForStore = globalThis as unknown as { __amoganaStore?: Store };

export function getStore(): Store {
  if (!globalForStore.__amoganaStore) globalForStore.__amoganaStore = buildStore();
  return globalForStore.__amoganaStore;
}

/** For tests: swap in a fresh store. */
export function resetStore(store?: Store) {
  globalForStore.__amoganaStore = store;
}

export function newId(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function dayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Per-user access

type Owned = Row & { user_id: string | null };

/** A collection limited to one user's rows: reads filter by user_id, writes stamp it. */
function scoped<T extends Owned>(base: Collection<T>, userId: string): Collection<T> {
  const owns = (row: T | null): row is T => Boolean(row && row.user_id === userId);
  return {
    all: (query) => base.all({ ...query, eq: { ...query?.eq, user_id: userId } as Partial<T> }),
    get: async (id) => {
      const row = await base.get(id);
      return owns(row) ? row : null;
    },
    insert: (row) => base.insert({ ...row, user_id: userId }),
    update: async (id, patch) => {
      if (!owns(await base.get(id))) return null;
      const rest: Partial<T> = { ...patch };
      delete rest.user_id;
      return base.update(id, rest);
    },
    remove: async (id) => {
      if (owns(await base.get(id))) await base.remove(id);
    },
  };
}

export interface UserStore {
  userId: string;
  brokers: Collection<BrokerAccount>;
  bots: Collection<Bot>;
  trades: Collection<Trade>;
  signals: Collection<Signal>;
  logs: Collection<EventLog>;
  equity: Collection<EquityPoint>;
}

/** Everything one user may read or change. Use this in every user-facing code path. */
export function forUser(userId: string, store = getStore()): UserStore {
  return {
    userId,
    brokers: scoped(store.brokers, userId),
    bots: scoped(store.bots, userId),
    trades: scoped(store.trades, userId),
    signals: scoped(store.signals, userId),
    logs: scoped(store.logs, userId),
    equity: scoped(store.equity, userId),
  };
}

export function defaultSettings(userId: string): Settings {
  return {
    id: userId,
    kill_switch: false,
    daily_loss_limit: 250,
    max_drawdown_percent: 15,
    max_open_trades: 8,
    max_trades_per_bot: 1,
    default_risk_percent: 1,
    books: {
      real: { peak_equity: 0, day_key: "", day_start_equity: 0 },
      demo: { peak_equity: 0, day_key: "", day_start_equity: 0 },
    },
    updated_at: new Date(0).toISOString(),
  };
}

/** A user's Risk Guard settings, created with defaults on first use. */
export async function getSettings(userId: string, store = getStore()): Promise<Settings> {
  const defaults = defaultSettings(userId);
  const existing = await store.settings.get(userId);
  if (existing) {
    const books = existing.books ?? defaults.books;
    return {
      ...defaults,
      ...existing,
      books: { real: books.real ?? defaults.books.real, demo: books.demo ?? defaults.books.demo },
    };
  }
  const fresh = { ...defaults, updated_at: nowIso() };
  try {
    await store.settings.insert(fresh);
  } catch {
    // Created concurrently by another request.
    return (await store.settings.get(userId)) ?? fresh;
  }
  return fresh;
}

export async function updateSettings(userId: string, patch: Partial<Settings>, store = getStore()): Promise<Settings> {
  await getSettings(userId, store);
  const rest: Partial<Settings> = { ...patch };
  delete rest.id;
  const updated = await store.settings.update(userId, { ...rest, updated_at: nowIso() });
  return updated!;
}

export async function log(
  level: EventLog["level"],
  message: string,
  extra: { user_id: string | null; bot_id?: string | null; context?: Record<string, unknown> },
  store = getStore(),
): Promise<void> {
  await store.logs.insert({
    id: newId(),
    user_id: extra.user_id,
    level,
    message,
    bot_id: extra.bot_id ?? null,
    context: extra.context ?? null,
    created_at: nowIso(),
  });
}
