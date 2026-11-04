"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

import { Field } from "@/components/app/widgets";
import { AuthShell } from "@/components/site/chrome";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/client";

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}

function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/reset", "POST", { token, password });
      window.location.href = "/dashboard";
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="Other devices will be signed out."
      footer={
        <Link href="/forgot-password" className="hover:text-foreground">
          Need a new link?
        </Link>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="New password" hint="At least 10 characters.">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" autoFocus required />
        </Field>
        <Field label="Confirm new password" hint={confirm && confirm !== password ? <span className="text-loss">Passwords don&apos;t match.</span> : undefined}>
          <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
        </Field>
        {error && (
          <p role="alert" className="rounded-lg bg-loss/10 px-3 py-2 text-sm text-loss">
            {error}
          </p>
        )}
        <Button type="submit" className="h-12 w-full rounded-xl text-[15px] font-bold" disabled={busy || !token || password.length < 10 || password !== confirm}>
          {busy ? "Saving…" : "Save new password"}
        </Button>
      </form>
    </AuthShell>
  );
}
