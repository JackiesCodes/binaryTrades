"use client";

import { useEffect, useState } from "react";
import { KeyRound, LogOut, MailCheck, MonitorSmartphone, Trash2, UserRound } from "lucide-react";

import { useDashboard } from "@/components/app/dashboard-context";
import { useFeedback } from "@/components/app/feedback";
import { Field, PageSkeleton, Panel } from "@/components/app/widgets";
import { AsideTitle, FieldBox, Strip, Workspace } from "@/components/app/workspace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, timeAgo } from "@/lib/client";

interface Profile {
  email: string | null;
  display_name: string | null;
  role: "user" | "admin";
  email_verified: boolean;
  password_changed_at: string | null;
  created_at: string;
  email_enabled: boolean;
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    api<Profile>("/api/me").then(setProfile, (e: Error) => setLoadError(e.message));
  }, []);

  if (loadError) return <p className="text-sm text-loss">{loadError}</p>;
  if (!profile) return <PageSkeleton />;

  const name = profile.display_name?.trim() || profile.email?.split("@")[0] || "Your account";
  return (
    <Workspace
      strip={
        <Strip
          icon={UserRound}
          title={name}
          sub={profile.email ?? "No email yet"}
          stats={[
            {
              label: "Member since",
              value: new Date(profile.created_at).toLocaleDateString(),
            },
            {
              label: "Role",
              value: profile.role === "admin" ? "Administrator" : "Trader",
              tone: profile.role === "admin" ? "text-gold" : undefined,
            },
            {
              label: "Email",
              value: !profile.email ? "Not added" : profile.email_verified ? "Confirmed" : "Unconfirmed",
              tone: profile.email_verified ? "text-profit" : "text-gold",
            },
            {
              label: "Password changed",
              value: profile.password_changed_at ? timeAgo(profile.password_changed_at) : "—",
            },
          ]}
        />
      }
      aside={
        <>
          <SessionsPanel />
          <div className="h-px bg-white/[0.06]" />
          <DeletePanel />
        </>
      }
    >
      <DetailsPanel profile={profile} onSaved={setProfile} />
      <PasswordPanel profile={profile} onSaved={setProfile} />
    </Workspace>
  );
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
      const emailChanged = email.trim().toLowerCase() !== (profile.email ?? "");
      const next = await api<Profile>("/api/me", "PATCH", {
        display_name: name.trim(),
        ...(email.trim() ? { email: email.trim() } : {}),
      });
      onSaved(next);
      await refresh();
      toast(emailChanged && !next.email_verified ? `Saved — we sent a confirmation link to ${next.email}` : "Details saved", "success");
    } catch (err) {
      toast((err as Error).message, "error");
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
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Display name">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="name" placeholder="Your name" />
          </Field>
          <Field
            label="Email"
            hint={
              profile.email ? (
                profile.email_verified ? (
                  <span className="inline-flex items-center gap-1 text-profit">
                    <MailCheck className="h-3.5 w-3.5" /> Confirmed. You sign in with this address.
                  </span>
                ) : (
                  <span className="text-gold">Not confirmed yet — check your inbox for the link.</span>
                )
              ) : (
                <span className="text-gold">Add your email: from then on you sign in with it and your password.</span>
              )
            }
          >
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={120}
              autoComplete="email"
              placeholder="you@example.com"
            />
          </Field>
        </div>
        <Button type="submit" disabled={busy || !dirty} className="h-11 rounded-xl px-5 font-bold">
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
      onSaved(
        await api<Profile>("/api/me/password", "POST", {
          current_password: current,
          new_password: next,
        }),
      );
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
      action={profile.password_changed_at ? <Badge variant="muted">Changed {timeAgo(profile.password_changed_at)}</Badge> : undefined}
    >
      <form onSubmit={save} className="space-y-3">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Current password">
            <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
          </Field>
          <Field
            label="New password"
            hint={
              tooShort ? <span className="text-amber-300">At least 10 characters.</span> : "At least 10 characters. A few random words work well."
            }
          >
            <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" aria-invalid={tooShort} />
          </Field>
          <Field label="Confirm new password" hint={mismatch ? <span className="text-loss">Passwords don&apos;t match.</span> : undefined}>
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" aria-invalid={mismatch} />
          </Field>
        </div>
        {error && (
          <p role="alert" className="rounded-lg bg-loss/10 px-3 py-2 text-sm text-loss">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy || !current || next.length < 10 || next !== confirm} className="h-11 rounded-xl px-5 font-bold">
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
      await api("/api/me/sessions", "DELETE");
      toast("Other devices signed out", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await api("/api/auth/logout", "POST").catch(() => undefined);
    window.location.href = "/";
  };

  return (
    <>
      <AsideTitle icon={MonitorSmartphone}>Signed-in devices</AsideTitle>
      <p className="text-sm text-muted-foreground">
        A sign-in lasts 14 days per device. If you signed in on a phone or computer that isn&apos;t yours, sign it out here. Bots keep trading either
        way.
      </p>
      <Button variant="outline" onClick={signOutOthers} disabled={busy} className="h-11 w-full rounded-xl">
        {busy ? "Signing out…" : "Sign out other devices"}
      </Button>
      <Button onClick={signOut} className="h-12 w-full rounded-xl text-[15px] font-bold">
        <LogOut /> Sign out here
      </Button>
    </>
  );
}

function DeletePanel() {
  const { confirm, toast } = useFeedback();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    const ok = await confirm({
      title: "Delete your account permanently?",
      description:
        "Your bots stop, positions binaryTrades opened are closed where the broker allows, and your broker connections, bots, scripts and history are deleted. This can't be undone. Your money stays in your broker accounts.",
      confirmLabel: "Delete my account",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api("/api/me", "DELETE", { password });
      window.location.href = "/";
    } catch (e) {
      toast((e as Error).message, "error");
      setBusy(false);
    }
  };

  return (
    <>
      <h2 className="flex items-center gap-2 text-[15px] font-bold text-loss">
        <Trash2 className="h-4 w-4" /> Delete account
      </h2>
      <p className="text-sm text-muted-foreground">
        Removes your account and everything in it from binaryTrades. Funds are held by your broker, not by us — they are not affected.
      </p>
      <FieldBox>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Your password"
          autoComplete="current-password"
        />
      </FieldBox>
      <Button variant="destructive" onClick={remove} disabled={busy || !password} className="h-11 w-full rounded-xl font-bold">
        {busy ? "Deleting…" : "Delete account"}
      </Button>
    </>
  );
}
