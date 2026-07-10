"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, LockIcon, SaveIcon } from "lucide-react";
import { LocalDateTime } from "@/components/local-date-time";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { actionablePickerGames, knownPickerClubs, seasonPickerSlots, type PickerRound } from "@/lib/ewc-web-picker-model";
import { copy, formatNumber, type Locale } from "@/lib/i18n";

type Picker = {
  weekly: PickerRound[];
  season: { topSize: number; status: string; closeAt: number | null; picks: string[] } | null;
};

type MutationResult = { error?: string; actionableRounds?: unknown[] };

async function jsonOrThrow(response: Response): Promise<MutationResult> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Unable to save your prediction.");
  return data;
}

export function WebPredictionPicker({
  picker,
  locale,
  queryKey,
}: {
  picker: Picker | null;
  locale: Locale;
  queryKey: readonly unknown[];
}) {
  const queryClient = useQueryClient();
  const text = copy[locale].profile;
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [seasonDrafts, setSeasonDrafts] = useState<Record<number, string>>({});
  const games = actionablePickerGames(picker?.weekly || []);
  const clubs = useMemo(() => knownPickerClubs(picker?.weekly || [], picker?.season?.picks || []), [picker]);

  const weekly = useMutation({
    mutationFn: async ({ weekKey, gameKey, pick }: { weekKey: string; gameKey: string; pick: string }) =>
      jsonOrThrow(await fetch("/api/me/ewc/picks/weekly", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekKey, gameKey, pick }),
      })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });
  const season = useMutation({
    mutationFn: async (body: { action: "set"; index: number; pick: string } | { action: "swap"; a: number; b: number }) =>
      jsonOrThrow(await fetch("/api/me/ewc/picks/season", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  if (!picker) return null;
  const datalistId = "ewc-known-clubs";
  const seasonSlots = picker.season ? seasonPickerSlots(picker.season.picks, picker.season.topSize) : [];

  return (
    <div className="flex flex-col gap-4">
      <datalist id={datalistId}>{clubs.map((club) => <option key={club} value={club} />)}</datalist>
      {weekly.error ? <Alert variant="destructive"><AlertTitle>{text.pickSaveFailed}</AlertTitle><AlertDescription>{weekly.error.message}</AlertDescription></Alert> : null}
      {season.error ? <Alert variant="destructive"><AlertTitle>{text.pickSaveFailed}</AlertTitle><AlertDescription>{season.error.message}</AlertDescription></Alert> : null}
      {games.length ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold">{text.webWeeklyTitle}</h2>
            <p className="text-sm text-muted-foreground">{text.webWeeklyDescription}</p>
          </div>
          {games.map((game) => {
            const key = `${game.weekKey}:${game.key}`;
            const value = drafts[key] ?? game.pick ?? "";
            const saving = weekly.isPending && weekly.variables?.weekKey === game.weekKey && weekly.variables?.gameKey === game.key;
            return (
              <FieldGroup key={key} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0"><p className="font-medium">{game.game}</p><p className="text-sm text-muted-foreground">{game.event || game.label}</p></div>
                  {game.lockAt ? <Badge variant="outline"><LockIcon data-icon="inline-start" />{text.nextLock} <LocalDateTime value={new Date(game.lockAt * 1000).toISOString()} locale={locale} /></Badge> : null}
                </div>
                <Field>
                  <FieldLabel htmlFor={`pick-${key}`}>{text.clubPick}</FieldLabel>
                  <Input id={`pick-${key}`} list={datalistId} value={value} onChange={(event) => setDrafts((current) => ({ ...current, [key]: event.target.value }))} placeholder={text.clubPickPlaceholder} disabled={saving} />
                  <FieldDescription>{text.clubPickHelp}</FieldDescription>
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={!value.trim() || saving} onClick={() => weekly.mutate({ weekKey: game.weekKey, gameKey: game.key, pick: value })}>
                    {saving ? <SaveIcon data-icon="inline-start" /> : <CheckIcon data-icon="inline-start" />}
                    {game.pick ? text.savePick : text.addPick}
                  </Button>
                  {game.pick ? <Badge variant="secondary">{text.currentPick}: {game.pick}</Badge> : null}
                </div>
              </FieldGroup>
            );
          })}
        </div>
      ) : null}

      {picker.season ? (
        <div className="flex flex-col gap-4 border-t pt-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><h2 className="text-lg font-semibold">{text.webSeasonTitle}</h2><p className="text-sm text-muted-foreground">{text.webSeasonDescription}</p></div>
            {picker.season.closeAt ? <Badge variant="outline">{text.closes} <LocalDateTime value={new Date(picker.season.closeAt * 1000).toISOString()} locale={locale} /></Badge> : null}
          </div>
          <Progress value={picker.season.topSize ? Math.round((picker.season.picks.length / picker.season.topSize) * 100) : 0}><ProgressLabel>{text.pickProgress}</ProgressLabel><ProgressValue>{() => `${formatNumber(picker.season?.picks.length || 0, locale)}/${formatNumber(picker.season?.topSize || 0, locale)}`}</ProgressValue></Progress>
          {seasonSlots.map((slot) => {
            const value = seasonDrafts[slot.index] ?? slot.pick ?? "";
            const saving = season.isPending && season.variables?.action === "set" && season.variables.index === slot.index;
            return (
              <FieldGroup key={slot.index} className="rounded-lg border p-4">
                <Field data-disabled={slot.locked || undefined}>
                  <FieldLabel htmlFor={`season-pick-${slot.index}`}>{text.seasonRank(formatNumber(slot.index + 1, locale))}</FieldLabel>
                  <Input id={`season-pick-${slot.index}`} list={datalistId} value={value} onChange={(event) => setSeasonDrafts((current) => ({ ...current, [slot.index]: event.target.value }))} disabled={slot.locked || saving || picker.season?.status !== "open"} placeholder={text.clubPickPlaceholder} />
                  {slot.locked ? <FieldDescription>{text.seasonFillOrder}</FieldDescription> : null}
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={slot.locked || !value.trim() || saving || picker.season?.status !== "open"} onClick={() => season.mutate({ action: "set", index: slot.index, pick: value })}>
                    <CheckIcon data-icon="inline-start" />{text.savePick}
                  </Button>
                  {slot.pick ? <Badge variant="secondary">{text.currentPick}: {slot.pick}</Badge> : null}
                </div>
              </FieldGroup>
            );
          })}
        </div>
      ) : null}
      {!games.length && !picker.season ? <Alert><AlertTitle>{text.noCurrentRound}</AlertTitle><AlertDescription>{text.noCurrentRoundDescription}</AlertDescription></Alert> : null}
    </div>
  );
}
