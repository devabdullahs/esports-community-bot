"use client";

import { CheckIcon, LogInIcon, TrophyIcon, VoteIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ProfileAvatar } from "@/components/profiles/profile-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber, localizedPath, type Locale } from "@/lib/i18n";
import type { MvpVoteView } from "@/lib/mvp";

type Labels = {
  vote: string;
  changeVote: string;
  selected: string;
  votes: string;
  hidden: string;
  signIn: string;
  signInHint: string;
  verificationHint: string;
  emptyTitle: string;
  emptyDescription: string;
  failed: string;
};

export function MvpVote({
  initialVote,
  locale,
  canVote,
  signedIn,
  labels,
}: {
  initialVote: MvpVoteView;
  locale: Locale;
  canVote: boolean;
  signedIn: boolean;
  labels: Labels;
}) {
  const [vote, setVote] = useState(initialVote);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function submit(nomineeId: number) {
    if (!canVote || vote.closed || pendingId !== null) return;
    setPendingId(nomineeId);
    setError("");
    try {
      const response = await fetch("/api/mvp/vote", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: vote.id, nomineeId }),
      });
      const body = (await response.json().catch(() => null)) as { vote?: MvpVoteView; error?: string } | null;
      if (!response.ok || !body?.vote) throw new Error(body?.error || labels.failed);
      setVote(body.vote);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : labels.failed);
    } finally {
      setPendingId(null);
    }
  }

  if (!vote.nominees.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{labels.emptyTitle}</CardTitle>
          <CardDescription>{labels.emptyDescription}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {!canVote && !vote.closed ? (
        <Card className="border-primary/25 bg-primary/5">
          <CardHeader className="flex-row items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <LogInIcon className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <CardTitle className="text-base">{signedIn ? labels.verificationHint : labels.signInHint}</CardTitle>
            </div>
            {!signedIn ? (
              <Button
                render={<Link href={localizedPath(`/login?callbackURL=${encodeURIComponent(localizedPath("/mvp", locale))}`, locale)} />}
                nativeButton={false}
                size="sm"
              >
                <LogInIcon data-icon="inline-start" />
                {labels.signIn}
              </Button>
            ) : null}
          </CardHeader>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {vote.nominees.map((nominee, index) => {
          const selected = vote.selectedNomineeId === nominee.id;
          const leader = vote.closed && index === 0 && Number(nominee.voteCount || 0) > 0;
          return (
            <Card key={nominee.id} className={selected || leader ? "border-primary/60 bg-primary/5" : undefined}>
              <CardHeader className="items-center text-center">
                <ProfileAvatar src={nominee.imageUrl} name={nominee.displayName} className="size-20" focus="top" />
                <div className="flex min-w-0 flex-col items-center gap-1">
                  <CardTitle className="max-w-full truncate text-lg" dir="auto">{nominee.displayName}</CardTitle>
                  <CardDescription className="max-w-full truncate" dir="auto">
                    {[nominee.teamName, nominee.game].filter(Boolean).join(" · ")}
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="flex min-h-8 items-center justify-center">
                {leader ? <Badge><TrophyIcon data-icon="inline-start" />MVP</Badge> : null}
                {selected && !leader ? <Badge variant="secondary"><CheckIcon data-icon="inline-start" />{labels.selected}</Badge> : null}
                {vote.revealCounts ? (
                  <span className="text-sm font-medium text-muted-foreground">
                    {formatNumber(Number(nominee.voteCount || 0), locale)} {labels.votes}
                  </span>
                ) : null}
              </CardContent>
              {!vote.closed && canVote ? (
                <CardFooter>
                  <Button
                    variant={selected ? "outline" : "default"}
                    className="w-full"
                    disabled={pendingId !== null}
                    onClick={() => submit(nominee.id)}
                  >
                    {selected ? <CheckIcon data-icon="inline-start" /> : <VoteIcon data-icon="inline-start" />}
                    {selected ? labels.selected : vote.selectedNomineeId ? labels.changeVote : labels.vote}
                  </Button>
                </CardFooter>
              ) : null}
            </Card>
          );
        })}
      </div>
      {!vote.revealCounts ? <p className="text-center text-sm text-muted-foreground">{labels.hidden}</p> : null}
      {error ? <p role="alert" className="text-center text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

