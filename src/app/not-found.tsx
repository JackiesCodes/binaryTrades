import Link from "next/link";
import { Compass } from "lucide-react";

import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-[1240px] flex-1 px-3 py-6 sm:px-5">
        <section className="flex w-full flex-col items-center justify-center gap-4 rounded-[22px] bg-panel px-6 py-16 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.06] text-profit">
            <Compass className="h-6 w-6" />
          </span>
          <h1 className="text-2xl font-bold text-ivory">Page not found</h1>
          <p className="max-w-md text-sm text-muted-foreground">That address doesn&apos;t exist on binaryTrades. It may have been mistyped or moved.</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild className="h-11 rounded-xl px-5 font-bold">
              <Link href="/dashboard">Go to your dashboard</Link>
            </Button>
            <Button asChild variant="outline" className="h-11 rounded-xl px-5">
              <Link href="/">Home</Link>
            </Button>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
