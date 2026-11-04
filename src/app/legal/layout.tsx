import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { LEGAL_UPDATED } from "@/components/site/legal";
import { LegalShell } from "@/components/site/legal-shell";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <SiteHeader />
      <LegalShell updated={LEGAL_UPDATED} contact={process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? null}>
        {children}
      </LegalShell>
      <SiteFooter />
    </div>
  );
}
