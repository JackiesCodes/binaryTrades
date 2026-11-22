"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { reportClientError } from "@/lib/client-errors";

/** Shown instead of a blank "Application error" page when a dashboard page crashes. Reports it too. */
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportClientError(error, "render", error.digest);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-3 rounded-[18px] bg-panel px-6 py-10 text-center">
      <AlertTriangle className="h-9 w-9 text-gold" aria-hidden />
      <h1 className="text-lg font-semibold text-ivory">This page hit a problem</h1>
      <p className="text-sm text-muted-foreground">
        Something went wrong while showing this page. It has been reported so it can be fixed. Your bots, trades and settings are not affected.
      </p>
      <p className="max-w-full break-words rounded-lg bg-black/30 px-3 py-2 font-mono text-xs text-muted-foreground">
        {error.message || "Unknown error"}
        {error.digest ? ` · ${error.digest}` : ""}
      </p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        <Button onClick={reset}>
          <RefreshCw /> Try again
        </Button>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Reload the page
        </Button>
        <Button variant="ghost" asChild>
          <Link href="/dashboard">Back to Overview</Link>
        </Button>
      </div>
    </div>
  );
}
