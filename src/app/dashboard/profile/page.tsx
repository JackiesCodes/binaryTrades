"use client";

import { useEffect, useState } from "react";
import { KeyRound, LogOut, MonitorSmartphone, UserRound } from "lucide-react";

import { useDashboard } from "@/components/app/dashboard-context";
import { useFeedback } from "@/components/app/feedback";
import { Field, PageHeader, PageSkeleton, Panel } from "@/components/app/widgets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, timeAgo } from "@/lib/client";

interface Profile {
  display_name: string | null;
  email: string | null;
  password_source: "custom" | "app_password";
  password_changed_at: string | null;
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    api<Profile>("/api/profile").then(setProfile, (e: Error) => setLoadError(e.message));
  }, []);

  if (loadError) return <p className="text-sm text-loss">{loadError}</p>;
  if (!profile) return <PageSkeleton />;

  return (
    <div className="space-y-5">
      <PageHeader title="Profile" description="Your name, sign-in password and signed-in devices." />
      <div className="grid gap-5 lg:grid-cols-2">
        <DetailsPanel profile={profile} onSaved={setProfile} />
        <PasswordPanel profile={profile} onSaved={setProfile} />
        <SessionsPanel />
      </div>
    </div>
  );
}

function initials(name: string | null) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") : "?";
}

function DetailsPanel({ profile, onSaved }: { profile: Profile; onSaved: (p: Profile) => void }) {
  const { refresh } = useDashboard();
  const { toast } = useFeedback();
  const [name, setName] = useState(profile.display_name ?? "");
  const [email, setEmail] = useState(profile.email ?? "");
  const [busy, setBusy] = useState(false);
  const dirty = name !== (profile.display_name ?? "") || email !== (profile.email ?? "");

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      onSaved(await api<Profile>("/api/profile", "PATCH", { display_name: name.trim(), email: email.trim() }));
      await refresh();
      toast("Profile saved", "success");
    } catch (err) {
      toast((err as Error).message === "INVALID_REQUEST" ? "Check the email address." : (err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <UserRound className="h-4 w-4" /> Your details
        </span>
      }
    >
      <form onSubmit={save} className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-profit/15 text-base font-semibold text-profit">
            {initials(name || null)}
          </div>
          <div className="min-w-0 text-sm text-muted-foreground">Shown in the sidebar. Only you can see this dashboard.</div>
        </div>
        <Field label="Display name">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="name" placeholder="Your name" />
        </Field>
        <Field label="Email" hint="For your reference only — binaryTrades sends no emails.">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={120} autoComplete="email" placeholder="you@example.com" />
        </Field>
        <Button type="submit" disabled={busy || !dirty}>
          {busy ? "Saving…" : "Save details"}
        </Button>
      </form>
    </Panel>
  );
}

function PasswordPanel({ profile, onSaved }: { profile: Profile; onSaved: (p: Profile) => void }) {
  const { toast } = useFeedback();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mismatch = confirm.length > 0 && next !== confirm;
  const tooShort = next.length > 0 && next.length < 10;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSaved(await api<Profile>("/api/profile/password", "POST", { current_password: current, new_password: next }));
      setCurrent("");
      setNext("");
      setConfirm("");
      toast("Password changed — other devices were signed out", "success");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <KeyRound className="h-4 w-4" /> Password
        </span>
      }
      action={
        profile.password_source === "custom" ? (
          <Badge variant="profit">Changed {timeAgo(profile.password_changed_at)}</Badge>
        ) : (
          <Badge variant="warning">Using setup password</Badge>
        )
      }
    >
      <form onSubmit={save} className="space-y-3">
        {profile.password_source === "app_password" && (
          <p className="text-xs text-muted-foreground">
            You&apos;re signing in with the password from setup (APP_PASSWORD). Set your own here; after that, only the new one works.
          </p>
        )}
        <Field label="Current password">
          <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </Field>
        <Field label="New password" hint={tooShort ? <span className="text-amber-300">At least 10 characters.</span> : "At least 10 characters. A few random words work well."}>
          <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" aria-invalid={tooShort} />
        </Field>
        <Field label="Confirm new password" hint={mismatch ? <span className="text-loss">Passwords don&apos;t match.</span> : undefined}>
          <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" aria-invalid={mismatch} />
        </Field>
        {error && (
          <p role="alert" className="rounded-lg bg-loss/10 px-3 py-2 text-sm text-loss">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy || !current || next.length < 10 || next !== confirm}>
          {busy ? "Changing…" : "Change password"}
        </Button>
        <p className="text-xs text-muted-foreground">Changing it signs out every other phone or computer. This one stays signed in.</p>
      </form>
    </Panel>
  );
}

function SessionsPanel() {
  const { confirm, toast } = useFeedback();
  const [busy, setBusy] = useState(false);

  const signOutOthers = async () => {
    const ok = await confirm({
      title: "Sign out all other devices?",
      description: "Every other browser signed in to binaryTrades must sign in again. Bots keep running.",
      confirmLabel: "Sign them out",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api("/api/profile/sessions", "DELETE");
      toast("Other devices signed out", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await api("/api/auth/logout", "POST").catch(() => undefined);
    window.location.href = "/login";
  };

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <MonitorSmartphone className="h-4 w-4" /> Signed-in devices
        </span>
      }
    >
      <p className="text-sm text-muted-foreground">
        A sign-in lasts 14 days per device. If you signed in on a phone or computer that isn&apos;t yours, sign it out here. Bots keep trading either
        way.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="outline" onClick={signOutOthers} disabled={busy}>
          {busy ? "Signing out…" : "Sign out other devices"}
        </Button>
        <Button variant="ghost" className="text-loss" onClick={signOut}>
          <LogOut /> Sign out here
        </Button>
      </div>
    </Panel>
  );
}
