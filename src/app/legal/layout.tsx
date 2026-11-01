import { SiteFooter, SiteHeader } from "@/components/site/chrome";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 sm:px-6">
        <article className="legal space-y-4 text-sm leading-relaxed text-muted-foreground [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:tracking-tight [&_h1]:text-ivory [&_h2]:pt-4 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-ivory [&_li]:ml-5 [&_li]:list-disc [&_strong]:text-foreground">
          {children}
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}
