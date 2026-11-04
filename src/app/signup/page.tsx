"use client";

import Link from "next/link";
import { useState } from "react";

import { Field } from "@/components/app/widgets";
import { AuthShell } from "@/components/site/chrome";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/client";

export default function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accept, setAccept] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tooShort = password.length > 0 && password.length < 10;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ verify_sent: boolean }>("/api/auth/signup", "POST", {
        email,
        password,
        display_name: name.trim() || undefined,
        accept_terms: accept,
      });
      window.location.href = res.verify_sent ? "/dashboard?welcome=verify" : "/dashboard?welcome=1";
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <AuthShell
      mode="signup"
      title="Create your account"
      subtitle="Free while in beta. Start on a demo account — no card needed."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-profit hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name (optional)">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={60} />
        </Field>
        <Field label="Email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </Field>
        <Field label="Password" hint={tooShort ? <span className="text-gold">At least 10 characters.</span> : "At least 10 characters. A few random words work well."}>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required aria-invalid={tooShort} />
        </Field>
        <label className="flex items-start gap-2.5 text-sm text-muted-foreground">
          <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[#85BB65]" />
          <span>
            I agree to the{" "}
            <Link href="/legal/terms" target="_blank" className="text-foreground underline">
              Terms of Use
            </Link>{" "}
            and{" "}
            <Link href="/legal/privacy" target="_blank" className="text-foreground underline">
              Privacy Policy
            </Link>
            , and I understand the{" "}
            <Link href="/legal/risk" target="_blank" className="text-foreground underline">
              Risk Disclosure
            </Link>
            : automated trading can lose money, including all of it.
          </span>
        </label>
        {error && (
          <p role="alert" className="rounded-lg bg-loss/10 px-3 py-2 text-sm text-loss">
            {error}
          </p>
        )}
        <Button type="submit" className="h-12 w-full rounded-xl text-[15px] font-bold" disabled={busy || !email || password.length < 10 || !accept}>
          {busy ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </AuthShell>
  );
}
