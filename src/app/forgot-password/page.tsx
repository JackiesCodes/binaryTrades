"use client";

import Link from "next/link";
import { useState } from "react";

import { Field } from "@/components/app/widgets";
import { AuthShell } from "@/components/site/chrome";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/forgot", "POST", { email });
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Reset your password"
      subtitle={sent ? undefined : "Enter your account's email and we'll send you a link to choose a new password."}
      footer={
        <Link href="/login" className="hover:text-foreground">
          ← Back to sign in
        </Link>
      }
    >
      {sent ? (
        <p className="text-sm text-muted-foreground">
          If <b className="text-foreground">{email}</b> has an account, a reset link is on its way. It works for 1 hour. Check your spam folder if you
          don&apos;t see it.
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus required />
          </Field>
          {error && (
            <p role="alert" className="rounded-lg bg-loss/10 px-3 py-2 text-sm text-loss">
              {error}
            </p>
          )}
          <Button type="submit" className="h-12 w-full rounded-xl text-[15px] font-bold" disabled={busy || !email}>
            {busy ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
