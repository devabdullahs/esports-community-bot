import Link from "next/link";
import { TrophyIcon, UserRoundIcon } from "lucide-react";
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
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-10">
      <section className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <TrophyIcon data-icon="inline-start" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Esports Community Bot</p>
            <h1 className="text-3xl font-semibold tracking-normal">EWC Predictions</h1>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>My profile</CardTitle>
            <CardDescription>Points, picks, weekly history, and Discord profile sync.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button render={<Link href="/me" />} nativeButton={false}>
              <UserRoundIcon data-icon="inline-start" />
              Open profile
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Public leaderboard</CardTitle>
            <CardDescription>Use the Discord bot link for your server leaderboard.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Public leaderboard URLs use the format
              <span className="mx-1 rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
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
