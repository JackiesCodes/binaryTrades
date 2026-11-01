"use client";

import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { AuthShell } from "@/components/site/chrome";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client";

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <Verify />
    </Suspense>
  );
}

function Verify() {
  const token = useSearchParams().get("token") ?? "";
  const [status, setStatus] = useState<"working" | "done" | "failed">("working");
  const [error, setError] = useState("");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api("/api/auth/verify", "POST", { token }).then(
      () => setStatus("done"),
      (e: Error) => {
        setError(e.message);
        setStatus("failed");
      },
    );
  }, [token]);

  return (
    <AuthShell title={status === "done" ? "Email confirmed" : status === "failed" ? "That link didn't work" : "Confirming your email…"}>
      {status === "done" && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Thanks — your email is confirmed. You can now connect your broker accounts.</p>
          <Button asChild className="w-full">
            <Link href="/dashboard/brokers">Connect a broker</Link>
          </Button>
        </div>
      )}
      {status === "failed" && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{error} You can send a new link from the banner at the top of your dashboard.</p>
          <Button asChild variant="outline" className="w-full">
            <Link href="/dashboard">Go to dashboard</Link>
          </Button>
        </div>
      )}
      {status === "working" && <div className="h-10 animate-pulse rounded-lg bg-white/5" />}
    </AuthShell>
  );
}
