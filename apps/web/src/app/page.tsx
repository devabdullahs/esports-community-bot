import Link from "next/link";
import { ArrowRightIcon, SparklesIcon, TrophyIcon, UserRoundIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-12 px-6 py-12 sm:py-16">
      <section className="flex flex-col items-start gap-5">
        <Badge variant="secondary" className="gap-1.5">
          <SparklesIcon className="size-3.5 text-primary" />
          Esports World Cup 2026
        </Badge>
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Predict the EWC. Climb your community{" "}
          <span className="bg-gradient-to-r from-primary to-amber-400 bg-clip-text text-transparent">
            leaderboard
          </span>
          .
        </h1>
        <p className="max-w-xl text-base text-muted-foreground text-pretty">
          Track your weekly and season predictions, show off your stats, and sync an EWC
          showcase straight to your Discord profile.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button render={<Link href="/me" />} nativeButton={false} size="lg">
            <UserRoundIcon data-icon="inline-start" />
            Open my profile
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card className="group transition-colors hover:border-primary/40">
          <CardHeader>
            <div className="mb-1 flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/20">
              <UserRoundIcon className="size-4.5" />
            </div>
            <CardTitle>My profile</CardTitle>
            <CardDescription>Points, picks, weekly history, and Discord profile sync.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button render={<Link href="/me" />} nativeButton={false} variant="outline">
              Open profile
              <ArrowRightIcon data-icon="inline-end" className="transition-transform group-hover:translate-x-0.5" />
            </Button>
          </CardContent>
        </Card>

        <Card className="transition-colors hover:border-primary/40">
          <CardHeader>
            <div className="mb-1 flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/20">
              <TrophyIcon className="size-4.5" />
            </div>
            <CardTitle>Public leaderboard</CardTitle>
            <CardDescription>Open your server&apos;s ranking from the Discord bot link.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Leaderboard URLs use the format
              <span className="mx-1 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                /leaderboard/server_id/2026
              </span>
              .
            </p>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
