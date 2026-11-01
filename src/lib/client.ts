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
    if (code === "SCRIPT_ERROR" && typeof details === "string") throw new ApiError(details);
    const extra = typeof details === "string" ? ` (${details})` : "";
    throw new ApiError((MESSAGES[code] ?? (data as { reason?: string }).reason ?? code) + extra);
  }
  return data as T;
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
