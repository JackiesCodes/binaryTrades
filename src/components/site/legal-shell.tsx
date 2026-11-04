"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { FileText, Lock, ShieldAlert } from "lucide-react";

import { cn } from "@/lib/utils";

const DOCS = [
  { href: "/legal/terms", label: "Terms of Use", short: "Terms", icon: FileText },
  { href: "/legal/privacy", label: "Privacy Policy", short: "Privacy", icon: Lock },
  { href: "/legal/risk", label: "Risk Disclosure", short: "Risk", icon: ShieldAlert },
];

const KEY_POINTS = [
  "binaryTrades is software, not a broker. Your money stays with your broker.",
  "Automated trading can lose money, including all of it. Nothing here is advice.",
  "Broker access is trade-only and encrypted; we never ask for withdrawal access.",
  "You can delete your account and data at any time.",
];

function slug(text: string) {
  return text
    .toLowerCase()
    .replace(/&[a-z]+;/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Header strip, the document in a panel, and a side panel with its sections. */
export function LegalShell({ updated, contact, children }: { updated: string; contact: string | null; children: React.ReactNode }) {
  const pathname = usePathname();
  const article = useRef<HTMLElement>(null);
  const [toc, setToc] = useState<Array<{ id: string; text: string }>>([]);
  const [active, setActive] = useState<string | null>(null);
  const doc = DOCS.find((d) => pathname.startsWith(d.href)) ?? DOCS[0]!;

  // Build "On this page" from the document's headings, and follow the one being read.
  useEffect(() => {
    const el = article.current;
    if (!el) return;
    const heads = [...el.querySelectorAll("h2")];
    heads.forEach((h) => {
      if (!h.id) h.id = slug(h.textContent ?? "");
      h.classList.add("scroll-mt-24");
    });
    setToc(heads.map((h) => ({ id: h.id, text: h.textContent ?? "" })));
    setActive(heads[0]?.id ?? null);
    const io = new IntersectionObserver(
      (entries) => {
        const seen = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (seen) setActive(seen.target.id);
      },
      { rootMargin: "-80px 0px -65% 0px" },
    );
    heads.forEach((h) => io.observe(h));
    return () => io.disconnect();
  }, [pathname]);

  return (
    <main className="mx-auto w-full max-w-[1240px] flex-1 px-3 pb-6 sm:px-5">
      <section className="flex flex-col gap-3 rounded-[18px] bg-panel p-4 md:flex-row md:items-center md:gap-6 md:px-5">
        <div className="flex min-w-0 items-center gap-3 md:border-r md:border-white/[0.06] md:pr-6">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-white/[0.06] text-profit">
            <doc.icon className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0">
            <div className="font-bold text-ivory">Legal</div>
            <div className="text-xs text-muted-foreground">Last updated {updated}</div>
          </div>
        </div>
        <nav aria-label="Legal documents" className="grid flex-1 grid-cols-3 gap-1 rounded-xl bg-black/30 p-1 text-[13px] md:max-w-md">
          {DOCS.map((d) => {
            const on = d === doc;
            return (
              <Link
                key={d.href}
                href={d.href}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "truncate rounded-[9px] px-2 py-2 text-center font-medium",
                  on ? "bg-profit font-semibold text-ink" : "text-muted-foreground hover:text-ivory",
                )}
              >
                <span className="sm:hidden">{d.short}</span>
                <span className="hidden sm:inline">{d.label}</span>
              </Link>
            );
          })}
        </nav>
      </section>

      <div className="mt-3.5 grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <article
          ref={article}
          className="legal min-w-0 space-y-4 rounded-[18px] bg-panel p-5 text-sm leading-relaxed text-muted-foreground sm:p-8 [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:tracking-tight [&_h1]:text-ivory [&_h2]:border-t [&_h2]:border-white/[0.06] [&_h2]:pt-6 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-ivory [&_li]:ml-5 [&_li]:list-disc [&_strong]:text-foreground [&_a]:text-profit"
        >
          {children}
        </article>

        <aside className="scrollbar-thin flex flex-col gap-3.5 rounded-[18px] bg-panel p-4 lg:sticky lg:top-[80px] lg:max-h-[calc(100dvh-96px)] lg:overflow-y-auto [&>*]:shrink-0">
          {toc.length > 0 && (
            <nav aria-label="On this page" className="hidden lg:block">
              <h2 className="mb-2 text-[15px] font-bold text-ivory">On this page</h2>
              <ol className="grid gap-0.5 rounded-[14px] bg-black/25 p-1.5 text-[13px]">
                {toc.map((t) => (
                  <li key={t.id}>
                    <a
                      href={`#${t.id}`}
                      className={cn(
                        "block truncate rounded-lg px-2.5 py-1.5",
                        active === t.id ? "bg-white/[0.08] font-medium text-ivory" : "text-muted-foreground hover:text-ivory",
                      )}
                    >
                      {t.text}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          )}
          <section>
            <h2 className="mb-2 text-[15px] font-bold text-ivory">In short</h2>
            <ul className="grid gap-2 text-[13px] leading-relaxed text-muted-foreground">
              {KEY_POINTS.map((k) => (
                <li key={k} className="flex gap-2">
                  <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-profit" aria-hidden />
                  {k}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-muted-foreground">A summary only; the document is what applies.</p>
          </section>
          <div className="h-px bg-white/[0.06]" />
          <section className="text-[13px] text-muted-foreground">
            <h2 className="mb-1 text-[15px] font-bold text-ivory">Questions?</h2>
            {contact ? (
              <>
                Email <span className="select-all text-profit">{contact}</span>
              </>
            ) : (
              "Use the support address shown in the site footer."
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}
