// Field names are snake_case so rows map 1:1 onto the Supabase tables in
// supabase/migrations/0001_amogana_autotrade.sql.

/** Whether money is real or demo — always taken from the broker account (see bookOf). */
export type Book = "real" | "demo";
export type Side = "buy" | "sell";
export type BrokerKind = "deriv" | "mt5";

export interface BrokerAccount {
  id: string;
  /** Owner of this row. */
  user_id: string;
  kind: BrokerKind;
  label: string;
  status: "connected" | "waiting" | "error";
  login: string | null;
  server: string | null;
  currency: string;
  balance: number;
  equity: number;
  is_demo: boolean;
  /** AES-GCM encrypted Deriv Personal Access Token (Deriv accounts only). */
  encrypted_token: string | null;
  /** App ID of the user's registered Deriv app, sent as Deriv-App-ID (Deriv accounts only). */
  app_id: string | null;
  /** SHA-256 of the MT5 bridge key (MT5 accounts only). The key itself is shown once. */
  bridge_key_hash: string | null;
  last_sync_at: string | null;
  error: string | null;
  created_at: string;
}

export type BotSource = "builtin" | "tradingview";
export type BotStatus = "running" | "paused";

export interface StrategyConfig {
  /** A built-in strategy id, or "script" for a script bot. */
  id: string;
  params: Record<string, number>;
  /** JavaScript source of a script bot (id "script"). */
  code?: string;
}

export interface Bot {
  id: string;
  /** Owner of this row. */
  user_id: string;
  name: string;
  source: BotSource;
  /** Required to trade; null only after its account was disconnected. */
  broker_account_id: string | null;
  /** Symbol as the broker names it, e.g. "EURUSDm" on Exness or "frxEURUSD" / "R_75" on Deriv. */
  symbol: string;
  /** Deriv symbol the strategy reads candles from, e.g. "frxEURUSD". */
  data_symbol: string;
  /** Where the strategy reads candles: Deriv market data (data_symbol), or the bot's own MT5 broker (symbol). */
  price_source: "deriv" | "broker";
  timeframe: number; // seconds per candle
  strategy: StrategyConfig | null;
  status: BotStatus;
  paused_reason: string | null;
  risk_percent: number;
  /** Deriv multiplier contracts only. */
  deriv_multiplier: number;
  /** MT5 magic number stamped on every order this bot sends. */
  magic: number;
  /** Shared secret a TradingView alert must include. */
  webhook_passphrase: string;
  last_bar_epoch: number | null;
  last_signal_at: string | null;
  created_at: string;
}

export type TradeStatus = "pending" | "open" | "closed" | "rejected";

export interface Trade {
  id: string;
  /** Owner of this row. */
  user_id: string;
  bot_id: string | null;
  broker_account_id: string | null;
  book: Book;
  symbol: string;
  data_symbol: string | null;
  side: Side;
  /** Lots on MT5, stake on Deriv. */
  size: number;
  size_unit: "lots" | "stake";
  entry_price: number | null;
  current_price: number | null;
  sl: number | null;
  tp: number | null;
  risk_amount: number;
  pnl: number;
  status: TradeStatus;
  broker_ref: string | null;
  magic: number | null;
  /** True for positions opened outside binaryTrades (e.g. your own EA) and seen through the MT5 bridge. */
  external: boolean;
  close_reason: string | null;
  exit_price: number | null;
  opened_at: string;
  closed_at: string | null;
}

export type SignalAction = "buy" | "sell" | "close";

export interface Signal {
  id: string;
  /** Owner of this row. */
  user_id: string;
  bot_id: string | null;
  source: BotSource | "manual";
  action: SignalAction;
  symbol: string | null;
  price: number | null;
  sl: number | null;
  tp: number | null;
  external_id: string | null;
  /** "ignored": a script's onAlert chose not to trade. */
  status: "accepted" | "rejected" | "duplicate" | "ignored";
  reason: string | null;
  received_at: string;
}

export type Mt5CommandType = "open" | "close" | "close_all" | "candles";

export interface Mt5Command {
  id: string;
  account_id: string;
  trade_id: string | null;
  type: Mt5CommandType;
  payload: Record<string, unknown>;
  status: "queued" | "sent" | "done" | "failed";
  result: Record<string, unknown> | null;
  created_at: string;
  sent_at: string | null;
}

export interface EventLog {
  id: string;
  /** Owner of this log line; null for platform-wide messages. */
  user_id: string | null;
  level: "info" | "warn" | "error" | "trade";
  message: string;
  bot_id: string | null;
  context: Record<string, unknown> | null;
  created_at: string;
}

export interface EquityPoint {
  id: string;
  /** Owner of this row. */
  user_id: string;
  book: Book;
  equity: number;
  created_at: string;
}

export interface BookState {
  peak_equity: number;
  day_key: string;
  day_start_equity: number;
}

/** Risk Guard settings, one row per user (id = the user's id). */
export interface Settings {
  id: string;
  kill_switch: boolean;
  /** Max loss per day, in account currency, before every bot in that book pauses. */
  daily_loss_limit: number;
  /** Max drop from the equity peak, in percent, before the kill switch engages. */
  max_drawdown_percent: number;
  max_open_trades: number;
  max_trades_per_bot: number;
  default_risk_percent: number;
  books: Record<Book, BookState>;
  updated_at: string;
}

export type UserRole = "user" | "admin";

/** A person with a binaryTrades account. Server-only: never send password_hash to a browser. */
export interface User {
  id: string;
  /** Lower-case. Null only for the original owner until they add one. */
  email: string | null;
  display_name: string | null;
  password_hash: string | null;
  role: UserRole;
  email_verified_at: string | null;
  /** Bumped to end every existing session (password change, sign out everywhere, disabled). */
  session_version: number;
  disabled: boolean;
  accepted_terms_at: string | null;
  password_changed_at: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuthToken {
  /** SHA-256 of the token sent by email. */
  id: string;
  user_id: string;
  kind: "verify_email" | "reset_password";
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

/** Closed candles from an MT5 account, sent by the bridge EA. */
export interface MarketData {
  /** `${account_id}:${symbol}:${timeframe}` */
  id: string;
  user_id: string;
  account_id: string;
  symbol: string;
  timeframe: number;
  /** [epoch, open, high, low, close], oldest first, epochs in broker server time. */
  bars: Array<[number, number, number, number, number]>;
  /** Broker server time minus UTC, in seconds. */
  server_offset: number;
  error: string | null;
  requested_at: string | null;
  updated_at: string;
}
