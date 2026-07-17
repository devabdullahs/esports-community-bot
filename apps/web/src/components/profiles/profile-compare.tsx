"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeftRightIcon,
  ArrowRightIcon,
  SearchIcon,
  UserRoundIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import { ProfileAvatar } from "@/components/profiles/profile-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { cn } from "@/lib/utils";
import {
  copy,
  directionForLocale,
  formatNumber,
  formatUnixSeconds,
  localizedPath,
  type Locale,
} from "@/lib/i18n";
import type {
  ComparisonKind,
  ComparisonProfile,
  ComparisonSearchOption,
} from "@/lib/profile-comparison";

const MAX_QUERY_LENGTH = 80;

function comparisonHref(
  locale: Locale,
  kind: ComparisonKind,
  leftId: number | null,
  rightId: number | null,
) {
  const params = new URLSearchParams({ kind });
  if (leftId) params.set("left", String(leftId));
  if (rightId) params.set("right", String(rightId));
  return `${localizedPath("/compare", locale)}?${params.toString()}`;
}

function ProfileSelector({
  id,
  label,
  kind,
  selected,
  locale,
  onSelect,
  onClear,
}: {
  id: string;
  label: string;
  kind: ComparisonKind;
  selected: ComparisonProfile | null;
  locale: Locale;
  onSelect: (id: number) => void;
  onClear: () => void;
}) {
  const text = copy[locale].profiles;
  const [query, setQuery] = useState(selected?.name ?? "");
  const [options, setOptions] = useState<ComparisonSearchOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const visibleOptions = options;
  const optionIds = visibleOptions.map((option) => String(option.id));

  useEffect(() => {
    const trimmed = query.trim();
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => {
      setLoading(true);
      setFailed(false);
      const params = new URLSearchParams({ kind, q: trimmed });
      void fetch(`/api/compare/search?${params.toString()}`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error("Comparison search failed.");
          return response.json() as Promise<{ profiles?: ComparisonSearchOption[] }>;
        })
        .then((data) => {
          if (active) setOptions(Array.isArray(data.profiles) ? data.profiles : []);
        })
        .catch((error: unknown) => {
          if (active && (error as { name?: string })?.name !== "AbortError") {
            setOptions([]);
            setFailed(true);
          }
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 180);

    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [kind, query]);

  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <Combobox
          items={optionIds}
          value={selected ? String(selected.id) : null}
          inputValue={query}
          onInputValueChange={(next) => setQuery((next ?? "").slice(0, MAX_QUERY_LENGTH))}
          onValueChange={(value) => {
            const option = visibleOptions.find((entry) => String(entry.id) === value);
            if (option) onSelect(option.id);
          }}
          autoHighlight
        >
          <ComboboxInput
            id={id}
            className="w-full"
            placeholder={text.comparisonSearchPlaceholder}
            aria-describedby={`${id}-hint`}
            showClear
          />
          <ComboboxContent>
            <ComboboxList>
              {(value) => {
                const option = visibleOptions.find((entry) => String(entry.id) === value);
                if (!option) return null;
                return (
                  <ComboboxItem key={value} value={value}>
                    <ProfileAvatar
                      src={option.imageUrl}
                      name={option.name}
                      shape={kind === "team" ? "rounded" : "circle"}
                      fit={kind === "team" ? "contain" : "cover"}
                      className="size-7 shrink-0 border border-border/70"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium" dir="auto">{option.name}</span>
                      <span className="block truncate text-xs text-muted-foreground" dir="auto">
                        {[option.game, option.detail].filter(Boolean).join(" - ")}
                      </span>
                    </span>
                  </ComboboxItem>
                );
              }}
            </ComboboxList>
            {!loading && !failed ? <ComboboxEmpty>{text.comparisonSearchEmpty}</ComboboxEmpty> : null}
          </ComboboxContent>
        </Combobox>
        {selected ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClear}
            aria-label={text.clearComparisonSelection}
            title={text.clearComparisonSelection}
            className="shrink-0"
          >
            <XIcon />
          </Button>
        ) : null}
      </div>
      <p id={`${id}-hint`} className="mt-1.5 text-xs text-muted-foreground">
        {failed ? text.comparisonSearchFailed : loading ? text.comparisonSearching : text.comparisonSearchHint}
      </p>
    </div>
  );
}

function ProfileHeading({
  profile,
  locale,
}: {
  profile: ComparisonProfile;
  locale: Locale;
}) {
  const text = copy[locale].profiles;
  const icon = profile.kind === "team" ? <UsersIcon className="size-3.5" /> : <UserRoundIcon className="size-3.5" />;
  return (
    <div className="flex min-w-0 items-center gap-3 border-b pb-4">
      <ProfileAvatar
        src={profile.imageUrl}
        name={profile.name}
        shape={profile.kind === "team" ? "rounded" : "circle"}
        fit={profile.kind === "team" ? "contain" : "cover"}
        focus="top"
        className="size-14 shrink-0 border border-border sm:size-16"
      />
      <div className="min-w-0 flex-1">
        <Badge variant="outline" className="mb-1.5 gap-1.5 text-xs">
          {icon}
          {profile.kind === "team" ? text.teamProfile : text.playerProfile}
        </Badge>
        <div className="truncate text-lg font-semibold" dir="auto">{profile.name}</div>
      </div>
      <Button
        render={<Link href={localizedPath(profile.profilePath, locale)} />}
        nativeButton={false}
        variant="ghost"
        size="icon"
        aria-label={`${text.viewProfile}: ${profile.name}`}
        title={`${text.viewProfile}: ${profile.name}`}
        className="shrink-0"
      >
        <ArrowRightIcon className="rtl:rotate-180" />
      </Button>
    </div>
  );
}

function ValueCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border bg-background/35 p-3">
      <div className="mb-1 text-xs font-medium text-muted-foreground" dir="auto">{label}</div>
      <div className="min-w-0 text-sm font-medium" dir="auto">{children}</div>
    </div>
  );
}

function ComparisonRow({
  label,
  left,
  right,
  leftLabel,
  rightLabel,
  locale,
}: {
  label: string;
  left: React.ReactNode;
  right: React.ReactNode;
  leftLabel: string;
  rightLabel: string;
  locale: Locale;
}) {
  const text = copy[locale].profiles;
  const leftText = typeof left === "string" ? left : "";
  const rightText = typeof right === "string" ? right : "";
  const different = Boolean(leftText && rightText && leftText !== rightText);
  return (
    <div className="grid gap-2 border-b border-border/60 py-4 last:border-b-0 md:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)] md:items-start">
      <div className="flex items-center gap-2 pt-1 text-sm font-medium">
        <span>{label}</span>
        {different ? <Badge variant="outline" className="text-[0.65rem]">{text.comparisonDifferent}</Badge> : null}
      </div>
      <ValueCell label={leftLabel}>{left || text.comparisonNotAvailable}</ValueCell>
      <ValueCell label={rightLabel}>{right || text.comparisonNotAvailable}</ValueCell>
    </div>
  );
}

function Achievements({ profile, locale }: { profile: ComparisonProfile; locale: Locale }) {
  const text = copy[locale].profiles;
  if (!profile.achievements.length) return <span className="text-muted-foreground">{text.comparisonNoAchievements}</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {profile.achievements.map((achievement) => <Badge key={achievement} variant="secondary" dir="auto">{achievement}</Badge>)}
    </div>
  );
}

function Roster({ profile, locale }: { profile: ComparisonProfile; locale: Locale }) {
  const text = copy[locale].profiles;
  if (!profile.activeRoster.length) return <p className="text-sm text-muted-foreground">{text.comparisonNoRoster}</p>;
  return (
    <ul className="grid gap-2">
      {profile.activeRoster.map((player) => (
        <li key={player.id}>
          <Link
            href={localizedPath(player.profilePath, locale)}
            className="flex min-w-0 items-center gap-2 rounded-lg border bg-background/35 p-2 outline-none transition-colors hover:border-primary/40 hover:bg-background focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ProfileAvatar src={player.imageUrl} name={player.name} shape="circle" fit="cover" focus="top" className="size-7 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium" dir="auto">{player.name}</span>
            {player.role ? <span className="truncate text-xs uppercase text-muted-foreground">{player.role}</span> : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function RecentMatches({ profile, locale }: { profile: ComparisonProfile; locale: Locale }) {
  const text = copy[locale].profiles;
  if (!profile.recentMatches.length) return <p className="text-sm text-muted-foreground">{text.comparisonNoRecentMatches}</p>;
  return (
    <ul className="grid gap-2">
      {profile.recentMatches.map((match) => (
        <li key={match.id} className="min-w-0 rounded-lg border bg-background/35 p-2.5">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <span className="truncate text-sm font-medium" dir="auto">
              {[match.teamA, match.teamB].filter(Boolean).join(" vs ") || match.tournamentName}
            </span>
            <Badge variant={match.status === "running" ? "destructive" : "outline"} className="shrink-0 text-[0.65rem]">
              {match.status === "running" ? text.comparisonLive : text.comparisonUpcoming}
            </Badge>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground" dir="auto">
            {[match.tournamentName, formatUnixSeconds(match.scheduledAt, locale)].filter(Boolean).join(" - ")}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function ProfileCompare({
  kind,
  leftId,
  rightId,
  left,
  right,
  gameNames,
  locale,
}: {
  kind: ComparisonKind;
  leftId: number | null;
  rightId: number | null;
  left: ComparisonProfile | null;
  right: ComparisonProfile | null;
  gameNames: Record<string, string>;
  locale: Locale;
}) {
  const router = useRouter();
  const text = copy[locale].profiles;
  const modeIcon = kind === "team" ? <UsersIcon className="size-4" /> : <UserRoundIcon className="size-4" />;
  const profiles = left && right ? { left, right } : null;
  const unavailable = (leftId !== null && !left) || (rightId !== null && !right);
  const displayGame = (profile: ComparisonProfile) => profile.game ? gameNames[profile.game] ?? profile.game : "";
  const goTo = (nextKind: ComparisonKind, nextLeft: number | null, nextRight: number | null) => {
    router.push(comparisonHref(locale, nextKind, nextLeft, nextRight));
  };

  return (
    <div className="flex flex-col gap-6" dir={directionForLocale(locale)}>
      <div className="flex flex-col gap-4 rounded-lg border bg-card/40 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            {modeIcon}
            {text.comparisonChooseProfiles}
          </div>
          <div role="tablist" aria-label={text.comparisonModeLabel} className="inline-flex rounded-lg bg-muted p-1">
            {(["team", "player"] as const).map((optionKind) => {
              const active = optionKind === kind;
              const Icon = optionKind === "team" ? UsersIcon : UserRoundIcon;
              return (
                <Link
                  key={optionKind}
                  role="tab"
                  aria-selected={active}
                  href={comparisonHref(locale, optionKind, null, null)}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                    active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-3.5" />
                  {optionKind === "team" ? text.teams : text.players}
                </Link>
              );
            })}
          </div>
        </div>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_2.5rem_minmax(0,1fr)] lg:items-end">
          <ProfileSelector
            key={`left-${kind}-${left?.id ?? leftId ?? "none"}`}
            id="comparison-left"
            label={kind === "team" ? text.comparisonFirstTeam : text.comparisonFirstPlayer}
            kind={kind}
            selected={left}
            locale={locale}
            onSelect={(id) => goTo(kind, id, rightId)}
            onClear={() => goTo(kind, null, rightId)}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => goTo(kind, rightId, leftId)}
            disabled={!leftId || !rightId}
            aria-label={text.swapComparisonSelections}
            title={text.swapComparisonSelections}
            className="hidden lg:inline-flex"
          >
            <ArrowLeftRightIcon />
          </Button>
          <ProfileSelector
            key={`right-${kind}-${right?.id ?? rightId ?? "none"}`}
            id="comparison-right"
            label={kind === "team" ? text.comparisonSecondTeam : text.comparisonSecondPlayer}
            kind={kind}
            selected={right}
            locale={locale}
            onSelect={(id) => goTo(kind, leftId, id)}
            onClear={() => goTo(kind, leftId, null)}
          />
        </div>
      </div>

      {!profiles ? (
        <section className="rounded-lg border border-dashed bg-muted/20 px-5 py-10 text-center">
          <SearchIcon className="mx-auto mb-3 size-6 text-muted-foreground" />
          <h2 className="text-base font-semibold">{unavailable ? text.comparisonUnavailableTitle : text.comparisonEmptyTitle}</h2>
          <p className="mx-auto mt-1.5 max-w-xl text-sm text-muted-foreground">
            {unavailable ? text.comparisonUnavailableDescription : text.comparisonEmptyDescription}
          </p>
        </section>
      ) : (
        <>
          <section className="grid gap-4 lg:grid-cols-2">
            <ProfileHeading profile={profiles.left} locale={locale} />
            <ProfileHeading profile={profiles.right} locale={locale} />
          </section>

          <section aria-labelledby="comparison-details" className="border-y">
            <div className="flex items-center justify-between gap-3 py-4">
              <h2 id="comparison-details" className="text-lg font-semibold">{text.comparisonDetails}</h2>
              <Badge variant="outline">{formatNumber(2, locale)} {text.comparisonProfiles}</Badge>
            </div>
            <ComparisonRow label={text.game} left={displayGame(profiles.left)} right={displayGame(profiles.right)} leftLabel={profiles.left.name} rightLabel={profiles.right.name} locale={locale} />
            <ComparisonRow label={text.region} left={profiles.left.region ?? ""} right={profiles.right.region ?? ""} leftLabel={profiles.left.name} rightLabel={profiles.right.name} locale={locale} />
            {kind === "player" ? <ComparisonRow label={text.currentTeam} left={profiles.left.currentTeam ?? ""} right={profiles.right.currentTeam ?? ""} leftLabel={profiles.left.name} rightLabel={profiles.right.name} locale={locale} /> : null}
            {kind === "player" ? <ComparisonRow label={text.role} left={profiles.left.role ?? ""} right={profiles.right.role ?? ""} leftLabel={profiles.left.name} rightLabel={profiles.right.name} locale={locale} /> : null}
            <ComparisonRow label={text.totalWinnings} left={profiles.left.approximateWinnings ?? ""} right={profiles.right.approximateWinnings ?? ""} leftLabel={profiles.left.name} rightLabel={profiles.right.name} locale={locale} />
            <ComparisonRow
              label={text.achievements}
              left={<Achievements profile={profiles.left} locale={locale} />}
              right={<Achievements profile={profiles.right} locale={locale} />}
              leftLabel={`${profiles.left.name} (${formatNumber(profiles.left.achievementCount, locale)})`}
              rightLabel={`${profiles.right.name} (${formatNumber(profiles.right.achievementCount, locale)})`}
              locale={locale}
            />
          </section>

          {kind === "team" ? (
            <section className="grid gap-4 lg:grid-cols-2">
              <div className="min-w-0 rounded-lg border bg-card/40 p-4 sm:p-5">
                <h2 className="text-base font-semibold">{profiles.left.name} - {text.comparisonActiveRoster}</h2>
                <div className="mt-3"><Roster profile={profiles.left} locale={locale} /></div>
              </div>
              <div className="min-w-0 rounded-lg border bg-card/40 p-4 sm:p-5">
                <h2 className="text-base font-semibold">{profiles.right.name} - {text.comparisonActiveRoster}</h2>
                <div className="mt-3"><Roster profile={profiles.right} locale={locale} /></div>
              </div>
            </section>
          ) : null}

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="min-w-0 rounded-lg border bg-card/40 p-4 sm:p-5">
              <h2 className="text-base font-semibold">{profiles.left.name} - {text.comparisonRecentMatches}</h2>
              <div className="mt-3"><RecentMatches profile={profiles.left} locale={locale} /></div>
            </div>
            <div className="min-w-0 rounded-lg border bg-card/40 p-4 sm:p-5">
              <h2 className="text-base font-semibold">{profiles.right.name} - {text.comparisonRecentMatches}</h2>
              <div className="mt-3"><RecentMatches profile={profiles.right} locale={locale} /></div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
