"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, ClockIcon, HistoryIcon, ListChecksIcon, LockIcon, SaveIcon, TrophyIcon } from "lucide-react";
import { LocalDateTime } from "@/components/local-date-time";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  knownPickerClubs,
  orderedRoundGames,
  pickerRoundGroups,
  roundPickProgress,
  seasonPickerSlots,
  type PickerGame,
  type PickerRound,
} from "@/lib/ewc-web-picker-model";
import { copy, formatNumber, type Locale } from "@/lib/i18n";
import { trackProductEvent } from "@/lib/product-analytics";

type Picker = {
  weekly: PickerRound[];
  season: { topSize: number; status: string; openAt: number | null; closeAt: number | null; picks: string[]; choices: string[] } | null;
};

type Text = (typeof copy)[Locale]["profile"];

type MutationResult = { error?: string; actionableRounds?: unknown[] };

async function jsonOrThrow(response: Response): Promise<MutationResult> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Unable to save your prediction.");
  return data;
}

function gameKeyOf(round: PickerRound, game: PickerGame) {
  return `${round.weekKey}:${game.key}`;
}

function ClubCombobox({
  id,
  value,
  choices,
  placeholder,
  emptyLabel,
  disabled,
  onChange,
}: {
  id: string;
  value: string;
  choices: string[];
  placeholder: string;
  emptyLabel: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const selected = choices.includes(value) ? value : null;
  return (
    <Combobox
      items={choices}
      value={selected}
      inputValue={value}
      onInputValueChange={onChange}
      onValueChange={(next) => onChange(next ?? "")}
      autoHighlight
    >
      <ComboboxInput id={id} className="w-full" placeholder={placeholder} disabled={disabled} showClear />
      <ComboboxContent>
        <ComboboxEmpty>{emptyLabel}</ComboboxEmpty>
        <ComboboxList>
          {(club) => <ComboboxItem key={club} value={club}>{club}</ComboboxItem>}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

function GameHeading({ game, label }: { game: PickerGame; label: string }) {
  return (
    <div className="min-w-0">
      <p className="font-medium">{game.game}</p>
      <p className="text-sm text-muted-foreground">{game.event || label}</p>
    </div>
  );
}

function LockBadge({ game, text, locale }: { game: PickerGame; text: Text; locale: Locale }) {
  if (!game.lockAt) return null;
  const locked = game.state !== "open";
  return (
    <Badge variant="outline">
      {locked ? <LockIcon data-icon="inline-start" /> : <ClockIcon data-icon="inline-start" />}
      {locked ? text.lockedAt : text.nextLock}{" "}
      <LocalDateTime value={new Date(game.lockAt * 1000).toISOString()} locale={locale} />
    </Badge>
  );
}

// A settled game: the pick can no longer change, so it reads as a record — what was
// picked, and (once the round is scored) how that pick did.
function SettledGameRow({
  game,
  roundLabel,
  text,
  locale,
}: {
  game: PickerGame;
  roundLabel: string;
  text: Text;
  locale: Locale;
}) {
  const result = game.result;
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 rounded-lg border p-3">
      <GameHeading game={game} label={roundLabel} />
      <div className="flex flex-wrap items-center gap-2">
        {game.pick ? (
          <Badge variant="secondary">{text.currentPick}: {game.pick}</Badge>
        ) : (
          <Badge variant="outline">{text.noPickMade}</Badge>
        )}
        {result ? (
          <Badge variant={result.points > 0 ? "default" : "outline"}>
            <TrophyIcon data-icon="inline-start" />
            {text.roundScore(formatNumber(result.points, locale))}
            {result.place ? ` · ${result.place}` : ""}
          </Badge>
        ) : game.pick ? (
          <Badge variant="outline">{text.awaitingResult}</Badge>
        ) : null}
        <LockBadge game={game} text={text} locale={locale} />
      </div>
    </div>
  );
}

function RoundStatusBadge({ round, text }: { round: PickerRound; text: Text }) {
  const status = round.status || "open";
  const label = text.roundStatus[status as keyof typeof text.roundStatus] || status;
  return (
    <Badge variant={status === "open" || status === "partly open" ? "default" : "secondary"}>
      <ClockIcon data-icon="inline-start" />
      {label}
    </Badge>
  );
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
  const [savedGameKey, setSavedGameKey] = useState<string | null>(null);
  const [savedSeasonSlot, setSavedSeasonSlot] = useState<number | null>(null);
  const rounds = useMemo(() => pickerRoundGroups(picker?.weekly || []), [picker]);
  const clubs = useMemo(
    () => knownPickerClubs(picker?.weekly || [], picker?.season?.picks || [], picker?.season?.choices || []),
    [picker],
  );

  const weekly = useMutation({
    mutationFn: async ({ weekKey, gameKey, pick }: { weekKey: string; gameKey: string; pick: string }) =>
      jsonOrThrow(await fetch("/api/me/ewc/picks/weekly", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekKey, gameKey, pick }),
      })),
    onSuccess: (_result, variables) => {
      trackProductEvent("prediction_submit");
      setSavedGameKey(`${variables.weekKey}:${variables.gameKey}`);
      return queryClient.invalidateQueries({ queryKey });
    },
  });
  const season = useMutation({
    mutationFn: async (body: { action: "set"; index: number; pick: string } | { action: "swap"; a: number; b: number }) =>
      jsonOrThrow(await fetch("/api/me/ewc/picks/season", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })),
    onSuccess: (_result, variables) => {
      trackProductEvent("prediction_submit");
      setSavedSeasonSlot(variables.action === "set" ? variables.index : null);
      return queryClient.invalidateQueries({ queryKey });
    },
  });

  if (!picker) return null;
  const seasonSlots = picker.season ? seasonPickerSlots(picker.season.picks, picker.season.topSize) : [];
  const seasonEditable = picker.season?.status === "open";
  const hasAnything = rounds.live.length || rounds.review.length || picker.season;

  function openGameRow(round: PickerRound, game: PickerGame) {
    const key = gameKeyOf(round, game);
    const value = drafts[key] ?? game.pick ?? "";
    const saving = weekly.isPending && weekly.variables?.weekKey === round.weekKey && weekly.variables?.gameKey === game.key;
    const unchanged = value.trim() === (game.pick || "").trim();
    return (
      <FieldGroup key={key} className="rounded-lg border p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <GameHeading game={game} label={round.label} />
          <LockBadge game={game} text={text} locale={locale} />
        </div>
        <Field>
          <FieldLabel htmlFor={`pick-${key}`}>{text.clubPick}</FieldLabel>
          <ClubCombobox
            id={`pick-${key}`}
            value={value}
            choices={game.choices || []}
            onChange={(next) => setDrafts((current) => ({ ...current, [key]: next }))}
            placeholder={text.clubPickPlaceholder}
            emptyLabel={text.clubPickHelp}
            disabled={saving}
          />
          <FieldDescription>{game.individualPicks ? text.soloPickHelp : text.clubPickHelp}</FieldDescription>
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={!value.trim() || saving || unchanged}
            onClick={() => weekly.mutate({ weekKey: round.weekKey, gameKey: game.key, pick: value })}
          >
            {saving ? <SaveIcon data-icon="inline-start" /> : <CheckIcon data-icon="inline-start" />}
            {game.pick ? text.savePick : text.addPick}
          </Button>
          {game.pick ? <Badge variant="secondary">{text.currentPick}: {game.pick}</Badge> : null}
          {savedGameKey === key && unchanged && !saving ? (
            <Badge variant="outline"><CheckIcon data-icon="inline-start" />{text.pickSaved}</Badge>
          ) : null}
        </div>
      </FieldGroup>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {weekly.error ? <Alert variant="destructive"><AlertTitle>{text.pickSaveFailed}</AlertTitle><AlertDescription>{weekly.error.message}</AlertDescription></Alert> : null}
      {season.error ? <Alert variant="destructive"><AlertTitle>{text.pickSaveFailed}</AlertTitle><AlertDescription>{season.error.message}</AlertDescription></Alert> : null}

      {rounds.live.map((round) => {
        const { open, locked } = orderedRoundGames(round);
        const progress = roundPickProgress(round);
        return (
          <Card key={round.weekKey}>
            <CardHeader>
              <CardTitle>{round.label}</CardTitle>
              <CardDescription>{text.webWeeklyDescription}</CardDescription>
              <CardAction>
                <RoundStatusBadge round={round} text={text} />
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Progress value={progress.percent}>
                <ProgressLabel>{text.pickProgress}</ProgressLabel>
                <ProgressValue>
                  {() => `${formatNumber(progress.picked, locale)}/${formatNumber(progress.total, locale)}`}
                </ProgressValue>
              </Progress>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">
                  <ListChecksIcon data-icon="inline-start" />
                  {progress.picked >= progress.total ? text.picksComplete : text.remainingPicks(open.filter((game) => !game.pick).length)}
                </Badge>
                {round.nextLockAt ? (
                  <Badge variant="outline">
                    <ClockIcon data-icon="inline-start" />
                    {text.nextLock} <LocalDateTime value={new Date(round.nextLockAt * 1000).toISOString()} locale={locale} />
                  </Badge>
                ) : null}
                {round.closeAt ? (
                  <Badge variant="outline">
                    {text.closes} <LocalDateTime value={new Date(round.closeAt * 1000).toISOString()} locale={locale} />
                  </Badge>
                ) : null}
              </div>

              {open.map((game) => openGameRow(round, game))}

              {locked.length ? (
                <div className="flex flex-col gap-3">
                  <Separator />
                  <div className="flex flex-col gap-1">
                    <p className="font-medium">{text.webLockedTitle}</p>
                    <p className="text-sm text-muted-foreground">{text.webLockedDescription}</p>
                  </div>
                  {locked.map((game) => (
                    <SettledGameRow key={gameKeyOf(round, game)} game={game} roundLabel={round.label} text={text} locale={locale} />
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>
        );
      })}

      {rounds.review.length ? (
        <Card>
          <CardHeader>
            <CardTitle>{text.webHistoryTitle}</CardTitle>
            <CardDescription>{text.webHistoryDescription}</CardDescription>
            <CardAction>
              <Badge variant="outline"><HistoryIcon data-icon="inline-start" />{formatNumber(rounds.review.length, locale)}</Badge>
            </CardAction>
          </CardHeader>
          <CardContent>
            <Accordion defaultValue={[rounds.review[0].weekKey]}>
              {rounds.review.map((round) => {
                const progress = roundPickProgress(round);
                return (
                  <AccordionItem key={round.weekKey} value={round.weekKey}>
                    <AccordionTrigger>
                      <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="font-medium">{round.label}</p>
                          <p className="text-sm text-muted-foreground">
                            {formatNumber(progress.picked, locale)}/{formatNumber(progress.total, locale)} · {text.roundStatus[(round.status || "closed") as keyof typeof text.roundStatus] || round.status}
                          </p>
                        </div>
                        <Badge variant={round.score == null ? "outline" : "secondary"}>
                          {round.score == null ? text.roundUnscored : text.roundScore(formatNumber(round.score, locale))}
                        </Badge>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="flex flex-col gap-3">
                      {round.games.map((game) => (
                        <SettledGameRow key={gameKeyOf(round, game)} game={game} roundLabel={round.label} text={text} locale={locale} />
                      ))}
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          </CardContent>
        </Card>
      ) : null}

      {picker.season ? (
        <Card>
          <CardHeader>
            <CardTitle>{text.webSeasonTitle}</CardTitle>
            <CardDescription>{text.webSeasonDescription}</CardDescription>
            <CardAction>
              {picker.season.closeAt ? (
                <Badge variant="outline">
                  {text.closes} <LocalDateTime value={new Date(picker.season.closeAt * 1000).toISOString()} locale={locale} />
                </Badge>
              ) : null}
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Progress value={picker.season.topSize ? Math.round((picker.season.picks.length / picker.season.topSize) * 100) : 0}>
              <ProgressLabel>{text.pickProgress}</ProgressLabel>
              <ProgressValue>
                {() => `${formatNumber(picker.season?.picks.length || 0, locale)}/${formatNumber(picker.season?.topSize || 0, locale)}`}
              </ProgressValue>
            </Progress>
            {seasonSlots.map((slot) => {
              const value = seasonDrafts[slot.index] ?? slot.pick ?? "";
              const saving = season.isPending && season.variables?.action === "set" && season.variables.index === slot.index;
              const unchanged = value.trim() === (slot.pick || "").trim();
              return (
                <FieldGroup key={slot.index} className="rounded-lg border p-4">
                  <Field data-disabled={slot.locked || undefined}>
                    <FieldLabel htmlFor={`season-pick-${slot.index}`}>{text.seasonRank(formatNumber(slot.index + 1, locale))}</FieldLabel>
                    <ClubCombobox
                      id={`season-pick-${slot.index}`}
                      value={value}
                      choices={clubs}
                      onChange={(next) => setSeasonDrafts((current) => ({ ...current, [slot.index]: next }))}
                      disabled={slot.locked || saving || !seasonEditable}
                      placeholder={text.clubPickPlaceholder}
                      emptyLabel={text.clubPickHelp}
                    />
                    {slot.locked ? <FieldDescription>{text.seasonFillOrder}</FieldDescription> : null}
                  </Field>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      disabled={slot.locked || !value.trim() || saving || unchanged || !seasonEditable}
                      onClick={() => season.mutate({ action: "set", index: slot.index, pick: value })}
                    >
                      {saving ? <SaveIcon data-icon="inline-start" /> : <CheckIcon data-icon="inline-start" />}
                      {slot.pick ? text.savePick : text.addPick}
                    </Button>
                    {slot.pick ? <Badge variant="secondary">{text.currentPick}: {slot.pick}</Badge> : null}
                    {savedSeasonSlot === slot.index && unchanged && !saving ? (
                      <Badge variant="outline"><CheckIcon data-icon="inline-start" />{text.pickSaved}</Badge>
                    ) : null}
                  </div>
                </FieldGroup>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      {!hasAnything ? (
        <Alert>
          <AlertTitle>{text.noCurrentRound}</AlertTitle>
          <AlertDescription>{text.noCurrentRoundDescription}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
