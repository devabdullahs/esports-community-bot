"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CopyIcon, DoorOpenIcon, PlusIcon, TrophyIcon, UsersRoundIcon } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatNumber, type Locale } from "@/lib/i18n";

type League = {
  id: string;
  name: string;
  memberCount: number;
  isOwner: boolean;
  inviteCode: string | null;
  createdAt: string;
};

type LeagueDetail = {
  league: League;
  leaderboard: Array<{ rank: number; score: number; displayName: string }>;
};

const COPY = {
  en: {
    title: "Mini-leagues",
    description: "Private standings that use the official prediction score.",
    create: "Create league",
    join: "Join league",
    createTitle: "Create a mini-league",
    createDescription: "Invite members to compare official prediction scores privately.",
    joinTitle: "Join a mini-league",
    joinDescription: "Paste an invite code shared by a league owner.",
    name: "League name",
    invite: "Invite code",
    createAction: "Create",
    joinAction: "Join",
    cancel: "Cancel",
    manage: "View standings",
    owner: "Owner",
    members: (count: number) => `${formatNumber(count, "en")} members`,
    official: "Official scoring",
    standings: "Standings",
    noScores: "Scores will appear after a member completes a scored prediction round.",
    rank: "Rank",
    member: "Member",
    points: "Points",
    leave: "Leave league",
    archive: "Archive league",
    archiveTitle: "Archive this mini-league?",
    archiveDescription: "Members will no longer be able to view or join this league.",
    archiveAction: "Archive",
    copied: "Copied",
    copyInvite: "Copy invite code",
    empty: "Create a private league or join one with an invite code.",
    unavailable: "Mini-leagues are temporarily unavailable.",
  },
  ar: {
    title: "الدوريات المصغرة",
    description: "ترتيب خاص يستخدم نقاط التوقعات الرسمية.",
    create: "إنشاء دوري",
    join: "انضم إلى دوري",
    createTitle: "إنشاء دوري مصغر",
    createDescription: "ادعُ الأعضاء لمقارنة نقاط التوقعات الرسمية بشكل خاص.",
    joinTitle: "انضم إلى دوري مصغر",
    joinDescription: "ألصق رمز دعوة شاركه مالك الدوري.",
    name: "اسم الدوري",
    invite: "رمز الدعوة",
    createAction: "إنشاء",
    joinAction: "انضمام",
    cancel: "إلغاء",
    manage: "عرض الترتيب",
    owner: "المالك",
    members: (count: number) => `${formatNumber(count, "ar")} أعضاء`,
    official: "نقاط رسمية",
    standings: "الترتيب",
    noScores: "ستظهر النقاط بعد إكمال عضو لجولة توقعات محسوبة.",
    rank: "الترتيب",
    member: "العضو",
    points: "النقاط",
    leave: "مغادرة الدوري",
    archive: "أرشفة الدوري",
    archiveTitle: "أرشفة هذا الدوري المصغر؟",
    archiveDescription: "لن يعود الأعضاء قادرين على عرض هذا الدوري أو الانضمام إليه.",
    archiveAction: "أرشفة",
    copied: "تم النسخ",
    copyInvite: "نسخ رمز الدعوة",
    empty: "أنشئ دوريًا خاصًا أو انضم إلى دوري برمز دعوة.",
    unavailable: "الدوريات المصغرة غير متاحة مؤقتًا.",
  },
} as const;

async function requestJson(path: string, init?: RequestInit) {
  const response = await fetch(path, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

export function PredictionMiniLeagues({ locale, compact = false }: { locale: Locale; compact?: boolean }) {
  const text = COPY[locale];
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [manageId, setManageId] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [name, setName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [copied, setCopied] = useState(false);

  const leagues = useQuery<{ leagues: League[] } | null>({
    queryKey: ["prediction-leagues"],
    queryFn: async () => {
      const response = await fetch("/api/me/prediction-leagues");
      if (response.status === 401 || response.status === 403 || response.status === 409) return null;
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || response.statusText);
      return data;
    },
    retry: false,
  });
  const detail = useQuery<LeagueDetail>({
    queryKey: ["prediction-league", manageId],
    queryFn: () => requestJson(`/api/me/prediction-leagues/${manageId}`),
    enabled: Boolean(manageId),
    retry: false,
  });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["prediction-leagues"] });
    if (manageId) queryClient.invalidateQueries({ queryKey: ["prediction-league", manageId] });
  };
  const create = useMutation({
    mutationFn: () => requestJson("/api/me/prediction-leagues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),
    onSuccess: () => {
      setName("");
      setCreateOpen(false);
      refresh();
    },
  });
  const join = useMutation({
    mutationFn: () => requestJson("/api/me/prediction-leagues/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviteCode }),
    }),
    onSuccess: () => {
      setInviteCode("");
      setJoinOpen(false);
      refresh();
    },
  });
  const leave = useMutation({
    mutationFn: (leagueId: string) => requestJson(`/api/me/prediction-leagues/${leagueId}/leave`, { method: "POST" }),
    onSuccess: () => {
      setManageId(null);
      refresh();
    },
  });
  const archive = useMutation({
    mutationFn: (leagueId: string) => requestJson(`/api/me/prediction-leagues/${leagueId}`, { method: "DELETE" }),
    onSuccess: () => {
      setArchiveOpen(false);
      setManageId(null);
      refresh();
    },
  });

  async function copyInvite(code: string) {
    await navigator.clipboard?.writeText(code).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }

  if (!leagues.data && !leagues.error) return null;
  if (leagues.error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{text.unavailable}</AlertTitle>
        <AlertDescription>{leagues.error.message}</AlertDescription>
      </Alert>
    );
  }

  const items = leagues.data?.leagues ?? [];
  const selected = detail.data?.league;
  return (
    <Card size={compact ? "sm" : "default"}>
      <CardHeader>
        <CardTitle>{text.title}</CardTitle>
        <CardDescription>{text.description}</CardDescription>
        <CardAction className="flex flex-wrap gap-2">
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger render={<Button size="sm" />}>
              <PlusIcon data-icon="inline-start" />
              {text.create}
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{text.createTitle}</DialogTitle>
                <DialogDescription>{text.createDescription}</DialogDescription>
              </DialogHeader>
              <Field>
                <FieldLabel htmlFor="prediction-league-name">{text.name}</FieldLabel>
                <Input id="prediction-league-name" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} autoComplete="off" />
              </Field>
              {create.error ? <p role="alert" className="text-sm text-destructive">{create.error.message}</p> : null}
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>{text.cancel}</Button>
                <Button onClick={() => create.mutate()} disabled={create.isPending || !name.trim()}>{text.createAction}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={joinOpen} onOpenChange={setJoinOpen}>
            <DialogTrigger render={<Button size="sm" variant="outline" />}>
              <UsersRoundIcon data-icon="inline-start" />
              {text.join}
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{text.joinTitle}</DialogTitle>
                <DialogDescription>{text.joinDescription}</DialogDescription>
              </DialogHeader>
              <Field>
                <FieldLabel htmlFor="prediction-league-invite">{text.invite}</FieldLabel>
                <Input id="prediction-league-invite" value={inviteCode} maxLength={64} onChange={(event) => setInviteCode(event.target.value)} autoComplete="off" dir="ltr" />
              </Field>
              {join.error ? <p role="alert" className="text-sm text-destructive">{join.error.message}</p> : null}
              <DialogFooter>
                <Button variant="outline" onClick={() => setJoinOpen(false)}>{text.cancel}</Button>
                <Button onClick={() => join.mutate()} disabled={join.isPending || !inviteCode.trim()}>{text.joinAction}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardAction>
      </CardHeader>
      <CardContent>
        {items.length ? (
          <div className="flex flex-col divide-y">
            {items.map((league) => (
              <div key={league.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate font-medium">{league.name}</p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    <Badge variant="secondary">{text.members(league.memberCount)}</Badge>
                    <Badge variant="outline">{text.official}</Badge>
                    {league.isOwner ? <Badge variant="outline">{text.owner}</Badge> : null}
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={() => setManageId(league.id)}>
                  <TrophyIcon data-icon="inline-start" />
                  {text.manage}
                </Button>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-muted-foreground">{text.empty}</p>}
      </CardContent>

      <Dialog open={Boolean(manageId)} onOpenChange={(open) => !open && setManageId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selected?.name || text.standings}</DialogTitle>
            <DialogDescription>{text.official}</DialogDescription>
          </DialogHeader>
          {detail.isLoading ? <p className="text-sm text-muted-foreground">...</p> : null}
          {detail.error ? <p role="alert" className="text-sm text-destructive">{detail.error.message}</p> : null}
          {selected ? (
            <div className="flex flex-col gap-5">
              {selected.isOwner && selected.inviteCode ? (
                <Field>
                  <FieldLabel htmlFor="prediction-league-owner-invite">{text.invite}</FieldLabel>
                  <div className="flex gap-2">
                    <Input id="prediction-league-owner-invite" value={selected.inviteCode} readOnly dir="ltr" />
                    <Button size="icon" variant="outline" onClick={() => copyInvite(selected.inviteCode!)} aria-label={text.copyInvite} title={text.copyInvite}>
                      <CopyIcon />
                    </Button>
                  </div>
                  <FieldDescription>{copied ? text.copied : text.members(selected.memberCount)}</FieldDescription>
                </Field>
              ) : null}
              {detail.data?.leaderboard.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{text.rank}</TableHead>
                      <TableHead>{text.member}</TableHead>
                      <TableHead>{text.points}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.data.leaderboard.map((row, index) => (
                      <TableRow key={`${row.displayName}-${row.rank}-${index}`}>
                        <TableCell>{formatNumber(row.rank, locale)}</TableCell>
                        <TableCell>{row.displayName}</TableCell>
                        <TableCell>{formatNumber(row.score, locale)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : <p className="text-sm text-muted-foreground">{text.noScores}</p>}
              <DialogFooter>
                {selected.isOwner ? (
                  <Button variant="destructive" onClick={() => setArchiveOpen(true)} disabled={archive.isPending}>
                    <DoorOpenIcon data-icon="inline-start" />
                    {text.archive}
                  </Button>
                ) : (
                  <Button variant="outline" onClick={() => leave.mutate(selected.id)} disabled={leave.isPending}>
                    <DoorOpenIcon data-icon="inline-start" />
                    {text.leave}
                  </Button>
                )}
              </DialogFooter>
              {leave.error || archive.error ? <p role="alert" className="text-sm text-destructive">{(leave.error || archive.error)?.message}</p> : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{text.archiveTitle}</DialogTitle>
            <DialogDescription>{text.archiveDescription}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiveOpen(false)}>{text.cancel}</Button>
            <Button variant="destructive" onClick={() => selected && archive.mutate(selected.id)} disabled={!selected || archive.isPending}>{text.archiveAction}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
