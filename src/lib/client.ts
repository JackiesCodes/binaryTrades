// Browser-side helpers shared by the dashboard pages.

const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: "Your session expired — please sign in again.",
  WRONG_EMAIL_OR_PASSWORD: "That email and password don't match an account.",
  TOO_MANY_ATTEMPTS: "Too many attempts. Wait a few minutes and try again.",
  EMAIL_TAKEN: "There's already an account with that email. Sign in instead, or reset your password.",
  INVALID_EMAIL: "Enter a valid email address.",
  ACCEPT_TERMS: "Please accept the Terms and the Risk Disclosure to continue.",
  SIGNUPS_CLOSED: "New sign-ups are paused right now. Please check back soon.",
  INVALID_LINK: "This link is invalid or has expired. Request a new one.",
  RESET_UNAVAILABLE: "Password reset by email isn't available yet. Contact support to regain access.",
  EMAIL_UNAVAILABLE: "Email sending isn't set up yet.",
  EMAIL_FAILED: "We couldn't send the email. Try again in a minute.",
  EMAIL_NOT_VERIFIED: "Confirm your email address first — check your inbox for the link.",
  ADD_EMAIL_FIRST: "Add your email address on the Account page first.",
  LAST_ADMIN: "You're the only administrator. Make someone else an admin before deleting this account.",
  ADMIN_ONLY: "Only administrators can do that.",
  CANNOT_CHANGE_YOURSELF: "You can't change your own access here.",
  UNKNOWN_BROKER: "That broker account no longer exists.",
  UNKNOWN_STRATEGY: "Pick a strategy for this bot.",
  KILL_SWITCH_ON: "Release the kill switch before starting bots.",
  CLOSE_TRADES_BEFORE_SWITCHING_ACCOUNT: "Close this bot's open positions before moving it to another account.",
  BOT_NEEDS_BROKER: "Choose a broker account for this bot first.",
  CHALLENGE_DEMO_ONLY: "Challenges only run on demo accounts.",
  CHALLENGE_RUNNING: "This bot already has a challenge running.",
  NO_CHALLENGE_RUNNING: "This bot has no challenge running.",
  STOP_CHALLENGE_FIRST: "Stop the challenge before switching this bot's account.",
  BROKER_NOT_CONNECTED: "That broker account isn't connected right now.",
  NO_EQUITY: "That account has no balance to trade with.",
  CLOSE_TRADES_FIRST: "Close the open trades on this account first.",
  DERIV_TOKEN_REJECTED: "Deriv did not accept that token and App ID.",
  DERIV_NO_OPTIONS_ACCOUNTS: "That token has no active Deriv Options account. Open one in Deriv (demo or real), then connect again.",
  DERIV_ALREADY_CONNECTED: "Every Deriv account this token can reach is already connected.",
  MARKET_DATA_UNAVAILABLE: "Could not download market data from Deriv.",
  NOT_ENOUGH_HISTORY: "Not enough price history for that market/timeframe.",
  CLOSE_FAILED: "The broker refused to close the trade.",
  WRONG_PASSWORD: "Wrong password.",
  WRONG_CURRENT_PASSWORD: "Your current password is not correct.",
  PASSWORD_TOO_SHORT: "Use at least 10 characters for the new password.",
  PASSWORD_UNCHANGED: "The new password must be different from the current one.",
  SCRIPT_REQUIRED: "Write or paste a script first.",
  NOT_A_SCRIPT_BOT: "Only script bots have a script to edit.",
  BOT_NOT_FOUND: "That bot no longer exists.",
};

export class ApiError extends Error {}

/** Names and allowed values for fields the API can reject, so "Invalid request" says what to fix. */
const FIELD_HINTS: Record<string, string> = {
  risk_percent: "Risk per trade (%): between 0.1 and 5. For a dollar amount, use Fixed $",
  risk_amount: "Fixed risk per trade: an amount above 0",
  deriv_multiplier: "Deriv multiplier: a whole number of at least 1",
  timeframe: "Timeframe",
  data_symbol: "Market",
  symbol: "Symbol",
  name: "Bot name: 1–60 characters",
  params: "Script settings: numbers only",
  strategy_params: "Strategy settings: numbers only",
  script: "Script: up to 50,000 characters",
  code: "Script: up to 50,000 characters",
  broker_account_id: "Broker account",
  cost_percent: "Cost per trade (%): between 0 and 1",
  hours: "Time limit: 1–72 hours",
  target_multiple: "Target: between ×1.1 and ×10",
};

export function invalidFieldsMessage(fields: Record<string, string[]>): string {
  const names = Object.keys(fields);
  if (!names.length) return "Some values weren't accepted. Check the form and try again.";
  return `Please check: ${names.map((f) => FIELD_HINTS[f] ?? `${f} (${fields[f]?.[0] ?? "invalid"})`).join("; ")}.`;
}

export async function api<T = unknown>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && (data as { error?: string }).error === "UNAUTHENTICATED") {
    // Clear a cookie that is signed but no longer valid (password changed elsewhere), then sign in again.
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
  }
  if (!res.ok) {
    const code = (data as { error?: string }).error ?? `HTTP_${res.status}`;
    const details = (data as { details?: unknown }).details;
    if ((code === "SCRIPT_ERROR" || code === "BAD_MULTIPLIER") && typeof details === "string") throw new ApiError(details);
    if (code === "INVALID_REQUEST" && details && typeof details === "object") throw new ApiError(invalidFieldsMessage(details as Record<string, string[]>));
    const extra = typeof details === "string" ? ` (${details})` : "";
    throw new ApiError((MESSAGES[code] ?? (data as { reason?: string }).reason ?? code) + extra);
  }
  return data as T;
}

/**
 * A broker account's name for dropdowns: its label, plus the platform and Demo/Real only when the
 * label doesn't already say so (e.g. "Deriv Demo DOT92728223", not "… · Deriv · Demo"). Demo/Real
 * always comes from the account itself, never from its name.
 */
export function brokerOptionLabel(b: { label: string; kind: string; is_demo: boolean }, withKind = false): string {
  const name = b.label.toLowerCase();
  const parts = [b.label];
  const kind = b.kind === "mt5" ? "MT5" : "Deriv";
  if (withKind && !name.includes(kind.toLowerCase())) parts.push(kind);
  const book = b.is_demo ? "Demo" : "Real";
  if (!name.includes(book.toLowerCase())) parts.push(book);
  return parts.join(" · ");
}

export function money(value: number | null | undefined, currency = "USD", signed = false): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const symbol = currency === "USD" ? "$" : `${currency} `;
  const abs = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(value));
  const sign = value < 0 ? "-" : signed && value > 0 ? "+" : "";
  return `${sign}${symbol}${abs}`;
}

export function pct(value: number | null | undefined, digits = 1, signed = false): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${signed && value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

export function price(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const digits = value >= 1000 ? 2 : value >= 10 ? 3 : 5;
  return value.toFixed(digits);
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function pnlClass(value: number | null | undefined): string {
  if (!value) return "text-muted-foreground";
  return value > 0 ? "text-profit" : "text-loss";
}
