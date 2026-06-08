import Link from "next/link";
import { TrophyIcon } from "lucide-react";
import { ModeToggle } from "@/components/mode-toggle";
import { Button } from "@/components/ui/button";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm shadow-primary/30">
            <TrophyIcon className="size-4" />
          </span>
          <span className="flex flex-col leading-none">
            <span className="text-sm font-semibold tracking-tight">EWC Predictions</span>
            <span className="text-[0.7rem] text-muted-foreground">Esports Community</span>
          </span>
        </Link>
        <nav className="ml-auto flex items-center gap-1">
          <Button render={<Link href="/me" />} nativeButton={false} variant="ghost" size="sm">
            My profile
          </Button>
          <ModeToggle />
        </nav>
      </div>
    </header>
  );
}
