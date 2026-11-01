"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

import { Field } from "@/components/app/widgets";
import { AuthShell } from "@/components/site/chrome";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/client";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // The original single-owner install signed in with a password only, until an email is added.
  const [passwordOnly, setPasswordOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ needs_email: boolean }>("/api/auth/login", "POST", { email: passwordOnly ? "" : email, password });
      const next = params.get("next");
      window.location.href = res.needs_email
        ? "/dashboard/account"
        : next?.startsWith("/") && !next.startsWith("//")
          ? next
          : "/dashboard";
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Sign in"
      subtitle="Welcome back."
      footer={
        <>
          New to binaryTrades?{" "}
          <Link href="/signup" className="font-medium text-profit hover:underline">
            Create a free account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {!passwordOnly && (
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus required />
          </Field>
        )}
        <Field
          label="Password"
          hint={
            <Link href="/forgot-password" className="hover:text-foreground">
              Forgot your password?
            </Link>
          }
        >
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required aria-invalid={Boolean(error)} />
        </Field>
        {error && (
          <p role="alert" className="rounded-lg bg-loss/10 px-3 py-2 text-sm text-loss">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={busy || !password || (!passwordOnly && !email)}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
        <button type="button" onClick={() => setPasswordOnly((v) => !v)} className="w-full text-center text-xs text-muted-foreground hover:text-foreground">
          {passwordOnly ? "Sign in with email instead" : "Original account owner without an email yet? Sign in with your password only"}
        </button>
      </form>
    </AuthShell>
  );
}
