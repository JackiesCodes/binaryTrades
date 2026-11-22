"use client";

// Sends crashes and script errors from the browser to the server log ([client-error] lines), so a
// problem seen on someone's phone can be found and fixed. At most a few reports per page load.

const sent = new Set<string>();
const MAX_REPORTS = 5;

export function reportClientError(error: unknown, kind: "render" | "window" | "promise" | "global", extra?: string) {
  try {
    const e = error instanceof Error ? error : new Error(typeof error === "string" ? error : JSON.stringify(error));
    const message = `${e.name}: ${e.message}`.slice(0, 500);
    // Browser noise that isn't a bug in the site.
    if (/ResizeObserver loop|^Error: Script error\.?$|Load failed|Failed to fetch|NetworkError|AbortError/i.test(message)) return;
    const key = `${kind}:${message}`;
    if (sent.has(key) || sent.size >= MAX_REPORTS) return;
    sent.add(key);
    const body = JSON.stringify({
      kind,
      message,
      stack: (e.stack ?? "").split("\n").slice(0, 12).join("\n").slice(0, 2000),
      path: (window.location.pathname + window.location.search).slice(0, 200),
      ua: navigator.userAgent.slice(0, 200),
      extra: extra?.slice(0, 200),
    });
    void fetch("/api/client-error", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => undefined);
  } catch {
    // never let error reporting cause an error
  }
}
