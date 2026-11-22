"use client";

import { useEffect } from "react";

import { reportClientError } from "@/lib/client-errors";

/** Last resort when even the page frame fails: a plain page with a way back, and a report. */
export default function GlobalError({ error }: { error: Error & { digest?: string }; reset?: () => void }) {
  useEffect(() => {
    reportClientError(error, "global", error.digest);
  }, [error]);
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#0B120F", color: "#EDE8D8", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 18 }}>binaryTrades hit a problem</h1>
          <p style={{ fontSize: 14, color: "#9AA69F" }}>It has been reported so it can be fixed. Your bots and trades are not affected.</p>
          <p style={{ fontSize: 12, color: "#9AA69F", fontFamily: "monospace", wordBreak: "break-word" }}>{error.message}</p>
          <button onClick={() => window.location.reload()} style={{ marginTop: 12, padding: "10px 16px", borderRadius: 10, border: 0, background: "#85BB65", color: "#0B120F", fontWeight: 600 }}>
            Try again
          </button>{" "}
          <a href="/dashboard" style={{ color: "#C8A24A", marginLeft: 12 }}>
            Back to the dashboard
          </a>
        </div>
      </body>
    </html>
  );
}
