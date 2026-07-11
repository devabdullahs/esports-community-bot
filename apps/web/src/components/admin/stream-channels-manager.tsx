"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { CheckIcon, PencilIcon, PlusIcon, SearchIcon, StarIcon, Trash2Icon } from "lucide-react";
import { getAdminCopy } from "@/lib/admin-copy";
import type { Locale } from "@/lib/i18n";
import {
  STREAM_DEFAULT_EMBED_PLATFORMS,
  STREAM_PLATFORMS,
  STREAM_SCOPES,
  type StreamChannel,
  type StreamPlatform,
  type StreamScope,
} from "@/lib/stream-types";
import { normalizeCreatorKey } from "@/lib/stream-normalize";
import { PlatformIcon } from "@/components/platform-icon";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type GameOption = {
  slug: string;
  name: string;
  tag?: string;
};

const PLATFORM_LABELS: Record<StreamPlatform, string> = {
  twitch: "Twitch",
  kick: "Kick",
  youtube: "YouTube",
  soop: "SOOP",
};

const SCOPE_ORDER: StreamScope[] = ["ewc", "game", "team", "match"];
const DEFAULT_EMBED_PLATFORM_SET = new Set<StreamPlatform>(STREAM_DEFAULT_EMBED_PLATFORMS);
type StreamManagerCopy = ReturnType<typeof getAdminCopy>["streams"];

function scopeTarget(channel: StreamChannel): string | null {
  if (channel.scope === "game") return channel.gameSlugs.join(", ");
  if (channel.scope === "team") return channel.teamKey;
  if (channel.scope === "match") return channel.matchExternalId;
  return channel.gameSlugs.length ? channel.gameSlugs.join(", ") : null;
}

type CreatorGroup = {
  key: string;
  scope: StreamScope;
  channels: StreamChannel[];
};

function groupLabel(group: CreatorGroup): string {
  return group.channels.find((c) => c.label)?.label || group.channels[0]?.handle || "";
}

function groupTargets(group: CreatorGroup): string[] {
  return [...new Set(group.channels.map(scopeTarget).filter((t): t is string => Boolean(t)))];
}

function firstHandle(handles: Record<StreamPlatform, string>): string {
  return STREAM_PLATFORMS.map((platform) => handles[platform].trim()).find(Boolean) ?? "";
}

function GamePicker({
  games,
  selected,
  onChange,
  required,
  copy,
}: {
  games: GameOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  required?: boolean;
  copy: StreamManagerCopy;
}) {
  const selectedSet = new Set(selected);
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const selectedGames = games.filter((game) => selectedSet.has(game.slug));
  const matchingGames = games.filter((game) => {
    if (!normalizedQuery) return true;
    return [game.name, game.slug, game.tag].some((value) => value?.toLowerCase().includes(normalizedQuery));
  });
  const availableGames = matchingGames.filter((game) => !selectedSet.has(game.slug));

  function toggleGame(slug: string) {
    onChange(selectedSet.has(slug) ? selected.filter((selectedSlug) => selectedSlug !== slug) : [...selected, slug]);
  }

  function renderGameButton(game: GameOption) {
    const active = selectedSet.has(game.slug);
    return (
      <Button
        key={game.slug}
        type="button"
        variant={active ? "default" : "outline"}
        size="sm"
        className="max-w-full justify-start"
        title={game.name}
        onClick={() => toggleGame(game.slug)}
      >
        {active ? <CheckIcon data-icon="inline-start" /> : null}
        <span className="truncate">{game.name}</span>
      </Button>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2 sm:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label>{required ? copy.games : copy.gameTagsOptional}</Label>
        <span className="text-xs text-muted-foreground">{copy.selectedCount(selected.length)}</span>
      </div>
      <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border/70 bg-background/40 p-2">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copy.gameSearchPlaceholder}
            autoComplete="off"
            className="h-9 ps-9"
          />
        </div>
        {selectedGames.length ? (
          <div className="flex max-h-24 flex-wrap gap-2 overflow-y-auto border-b border-border/60 pb-2">
            {selectedGames.map(renderGameButton)}
          </div>
        ) : null}
        <div className="max-h-56 overflow-y-auto pe-1">
          {availableGames.length ? (
            <div className="flex min-w-0 flex-wrap gap-2">{availableGames.map(renderGameButton)}</div>
          ) : normalizedQuery && !matchingGames.length ? (
            <p className="px-1 py-2 text-sm text-muted-foreground">{copy.gameSearchNoResults}</p>
          ) : null}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{copy.gamePickerHelp}</p>
    </div>
  );
}

export function StreamChannelsManager({
  channels,
  games,
  locale,
}: {
  channels: StreamChannel[];
  games: GameOption[];
  locale: Locale;
}) {
  const router = useRouter();
  const copy = getAdminCopy(locale).streams;
  const [items, setItems] = useState<StreamChannel[]>(channels);
  const [scope, setScope] = useState<StreamScope>("ewc");
  const [handles, setHandles] = useState<Record<StreamPlatform, string>>({
    twitch: "",
    kick: "",
    youtube: "",
    soop: "",
  });
  const [defaultPlatform, setDefaultPlatform] = useState<StreamPlatform>("twitch");
  const [label, setLabel] = useState("");
  const [selectedGames, setSelectedGames] = useState<string[]>([]);
  const [team, setTeam] = useState("");
  const [matchExternalId, setMatchExternalId] = useState("");
  const [language, setLanguage] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editLanguage, setEditLanguage] = useState("");
  const [editGames, setEditGames] = useState<string[]>([]);
  const [removeTarget, setRemoveTarget] = useState<StreamChannel | null>(null);
  const [removeGroupTarget, setRemoveGroupTarget] = useState<CreatorGroup | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One card per streamer: within each scope, collapse the per-platform rows
  // sharing a creator_key (the server already propagates label/language/game
  // edits across those siblings). Platforms render as compact rows inside.
  const grouped = useMemo(() => {
    const map = new Map<StreamScope, CreatorGroup[]>();
    for (const s of SCOPE_ORDER) map.set(s, []);
    const byKey = new Map<string, CreatorGroup>();
    for (const channel of items) {
      const key = `${channel.scope}:${channel.creatorKey || channel.label.toLowerCase() || channel.handle}`;
      let group = byKey.get(key);
      if (!group) {
        group = { key, scope: channel.scope, channels: [] };
        byKey.set(key, group);
        map.get(channel.scope)?.push(group);
      }
      group.channels.push(channel);
    }
    const platformRank = (p: StreamPlatform) => STREAM_PLATFORMS.indexOf(p);
    for (const groups of map.values()) {
      for (const group of groups) {
        group.channels.sort((a, b) => platformRank(a.platform) - platformRank(b.platform));
      }
      groups.sort((a, b) => {
        const orderA = Math.min(...a.channels.map((c) => c.sortOrder));
        const orderB = Math.min(...b.channels.map((c) => c.sortOrder));
        if (orderA !== orderB) return orderA - orderB;
        return groupLabel(a).localeCompare(groupLabel(b));
      });
    }
    return map;
  }, [items]);

  function updateHandle(platform: StreamPlatform, value: string) {
    setHandles((prev) => ({ ...prev, [platform]: value }));
  }

  function startEdit(group: CreatorGroup) {
    const channel = group.channels[0];
    if (!channel) return;
    setEditingKey(group.key);
    setEditLabel(groupLabel(group));
    setEditLanguage(group.channels.find((c) => c.language)?.language ?? "");
    setEditGames(channel.gameSlugs);
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const entries = STREAM_PLATFORMS.map((p) => ({ platform: p, handle: handles[p].trim() })).filter((e) => e.handle);
    if (!entries.length) {
      setError(copy.validation.platformRequired);
      return;
    }
    if (entries.length > 1 && !label.trim()) {
      setError(copy.validation.labelRequired);
      return;
    }
    if (scope === "game" && selectedGames.length === 0) {
      setError(copy.validation.gameRequired);
      return;
    }

    const creatorKey = normalizeCreatorKey(label || firstHandle(handles));
    const embeddableEntries = entries.filter((entry) => DEFAULT_EMBED_PLATFORM_SET.has(entry.platform));
    const effectiveDefault =
      embeddableEntries.find((entry) => entry.platform === defaultPlatform)?.platform ??
      embeddableEntries[0]?.platform ??
      entries[0].platform;

    setBusy(true);
    try {
      const created: StreamChannel[] = [];
      for (const entry of entries) {
        const res = await fetch("/api/admin/streams", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            platform: entry.platform,
            handle: entry.handle,
            label,
            scope,
            gameSlugs: selectedGames,
            gameSlug: selectedGames[0],
            team,
            matchExternalId,
            language,
            creatorKey,
            isDefault: entry.platform === effectiveDefault,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setError(data?.error || copy.platformError(PLATFORM_LABELS[entry.platform], res.status));
          return;
        }
        created.push(data as StreamChannel);
      }
      setItems((prev) => {
        const ids = new Set(created.map((c) => c.id));
        return [...prev.filter((c) => !ids.has(c.id)), ...created];
      });
      setHandles({ twitch: "", kick: "", youtube: "", soop: "" });
      setLabel("");
      setSelectedGames([]);
      setTeam("");
      setMatchExternalId("");
      router.refresh();
    } catch {
      setError(copy.networkError);
    } finally {
      setBusy(false);
    }
  }

  async function patchChannel(channel: StreamChannel, patch: Partial<StreamChannel>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/streams/${channel.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data) {
        setItems((prev) => {
          const updated = data as StreamChannel;
          return prev.map((c) => {
            if (c.id === updated.id) return updated;
            if (updated.isDefault && c.creatorKey === updated.creatorKey) return { ...c, isDefault: false };
            return c;
          });
        });
      } else {
        setError(data?.error || copy.updateError(channel.label || channel.handle));
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(group: CreatorGroup) {
    const channel = group.channels[0];
    if (!channel) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/streams/${channel.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: editLabel,
          language: editLanguage,
          gameSlugs: editGames,
          creatorKey: channel.creatorKey,
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data) {
        const updated = data as StreamChannel;
        // The server propagates label/language/games to the creator's sibling
        // rows (same creator_key + scope); mirror that locally so every
        // platform row in the card reflects the edit without a refetch.
        setItems((prev) =>
          prev.map((c) => {
            if (c.id === updated.id) return updated;
            if (c.creatorKey === updated.creatorKey && c.scope === updated.scope) {
              return { ...c, label: updated.label, language: updated.language, gameSlugs: updated.gameSlugs };
            }
            return c;
          }),
        );
        setEditingKey(null);
      } else {
        setError(data?.error || copy.updateError(channel.label || channel.handle));
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(channel: StreamChannel) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/streams/${channel.id}`, { method: "DELETE" });
      if (res.ok) {
        setItems((prev) => prev.filter((c) => c.id !== channel.id));
        setRemoveTarget(null);
      }
    } finally {
      setBusy(false);
    }
  }

  // Removes every platform row of a streamer within the scope in one action.
  async function removeGroup(group: CreatorGroup) {
    setBusy(true);
    try {
      const removed: number[] = [];
      for (const channel of group.channels) {
        const res = await fetch(`/api/admin/streams/${channel.id}`, { method: "DELETE" });
        if (!res.ok) break;
        removed.push(channel.id);
      }
      if (removed.length) {
        const ids = new Set(removed);
        setItems((prev) => prev.filter((c) => !ids.has(c.id)));
      }
      if (removed.length === group.channels.length) setRemoveGroupTarget(null);
      else setError(copy.updateError(groupLabel(group)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <form onSubmit={add} className="flex min-w-0 flex-col gap-5 rounded-xl border border-border/70 bg-card/70 p-4 shadow-sm sm:p-5">
        <div>
          <h2 className="text-lg font-semibold">{copy.addTitle}</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{copy.addDescription}</p>
        </div>
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>{copy.couldNotSave}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="stream-label">{copy.labels.streamer}</Label>
            <Input
              id="stream-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={copy.placeholders.streamer}
              autoComplete="off"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{copy.labels.defaultPlatform}</Label>
            <Select value={defaultPlatform} onValueChange={(value) => setDefaultPlatform(value as StreamPlatform)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={copy.labels.platformPlaceholder}>
                  {(v) => (v ? PLATFORM_LABELS[v as StreamPlatform] : "")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {STREAM_DEFAULT_EMBED_PLATFORMS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {PLATFORM_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{copy.embedHelp}</p>
          </div>

          {STREAM_PLATFORMS.map((p) => (
            <div key={p} className="flex flex-col gap-1.5">
              <Label htmlFor={`stream-${p}`}>{copy.labels.handleOrUrl(PLATFORM_LABELS[p])}</Label>
              <Input
                id={`stream-${p}`}
                value={handles[p]}
                onChange={(e) => updateHandle(p, e.target.value)}
                placeholder={p === "twitch" ? copy.placeholders.twitch : copy.placeholders.channelUrl(PLATFORM_LABELS[p])}
                autoComplete="off"
              />
            </div>
          ))}

          <div className="flex flex-col gap-1.5">
            <Label>{copy.labels.scope}</Label>
            <Select value={scope} onValueChange={(value) => setScope(value as StreamScope)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={copy.labels.scope}>
                  {(v) => (v ? copy.scopeLabels[v as StreamScope] : "")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {STREAM_SCOPES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {copy.scopeLabels[s]}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="stream-language">{copy.labels.language}</Label>
            <Input
              id="stream-language"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              placeholder={copy.placeholders.language}
              autoComplete="off"
              maxLength={8}
            />
          </div>

          <GamePicker
            games={games}
            selected={selectedGames}
            onChange={setSelectedGames}
            required={scope === "game"}
            copy={copy}
          />

          {scope === "team" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="stream-team">{copy.labels.team}</Label>
              <Input
                id="stream-team"
                value={team}
                onChange={(e) => setTeam(e.target.value)}
                placeholder={copy.placeholders.team}
                autoComplete="off"
              />
            </div>
          ) : null}
          {scope === "match" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="stream-match">{copy.labels.matchExternalId}</Label>
              <Input
                id="stream-match"
                value={matchExternalId}
                onChange={(e) => setMatchExternalId(e.target.value)}
                placeholder={copy.placeholders.matchExternalId}
                autoComplete="off"
              />
            </div>
          ) : null}
        </div>

        <Button type="submit" disabled={busy} className="w-fit">
          <PlusIcon data-icon="inline-start" />
          {copy.addAction}
        </Button>
      </form>

      {SCOPE_ORDER.map((s) => {
        const creators = grouped.get(s) ?? [];
        return (
          <section key={s} className="flex min-w-0 flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-lg font-semibold">{copy.scopeLabels[s]}</h2>
              <Badge variant="secondary">{copy.streamersCount(creators.length)}</Badge>
            </div>
            {creators.length ? (
              <div className="grid min-w-0 gap-3">
                {creators.map((group) => {
                  const label = groupLabel(group);
                  const targets = groupTargets(group);
                  const language = group.channels.find((c) => c.language)?.language ?? null;
                  const allInactive = group.channels.every((c) => !c.active);
                  const isEditing = editingKey === group.key;
                  return (
                    <div
                      key={group.key}
                      className={`flex min-w-0 flex-col gap-3 rounded-xl border border-border/70 bg-card/60 p-3 shadow-sm sm:p-4 ${
                        allInactive ? "opacity-60" : ""
                      }`}
                    >
                      {/* Streamer header: one identity line + creator-level actions. */}
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="min-w-0 max-w-full truncate text-base font-semibold" dir="auto">{label}</span>
                        <span className="text-xs text-muted-foreground">
                          {copy.platformsCount(group.channels.length)}
                        </span>
                        {targets.map((target) => (
                          <Badge key={target} variant="outline" className="max-w-full truncate">{target}</Badge>
                        ))}
                        {language ? <Badge variant="outline">{language}</Badge> : null}
                        {allInactive ? <Badge variant="outline">{copy.inactive}</Badge> : null}
                        <div className="ms-auto flex shrink-0 flex-wrap gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            disabled={busy}
                            onClick={() => (isEditing ? setEditingKey(null) : startEdit(group))}
                            title={copy.labels.editLabel}
                            aria-label={copy.labels.editLabel}
                          >
                            <PencilIcon />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-destructive"
                            disabled={busy}
                            onClick={() => setRemoveGroupTarget(group)}
                            title={copy.removeStreamer}
                            aria-label={copy.removeStreamer}
                          >
                            <Trash2Icon />
                          </Button>
                        </div>
                      </div>

                      {/* One compact row per platform. */}
                      <div className="flex min-w-0 flex-col divide-y divide-border/60 rounded-lg border border-border/60 bg-background/40">
                        {group.channels.map((channel) => (
                          <div
                            key={channel.id}
                            className={`grid min-w-0 gap-2 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center ${channel.active ? "" : "opacity-55"}`}
                          >
                            <div className="grid min-w-0 gap-1.5 sm:grid-cols-[6rem_minmax(0,1fr)] sm:items-center">
                              <span className="inline-flex min-w-0 items-center gap-1.5 text-sm font-medium">
                                <PlatformIcon platform={channel.platform} className="size-3.5 shrink-0" />
                                <span className="truncate">{PLATFORM_LABELS[channel.platform]}</span>
                              </span>
                              <div className="flex min-w-0 flex-wrap items-center gap-2">
                                {channel.url ? (
                                  <a
                                    href={channel.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="min-w-0 max-w-full truncate font-mono text-xs text-muted-foreground hover:text-foreground"
                                  >
                                    {channel.handle}
                                  </a>
                                ) : (
                                  <span className="min-w-0 max-w-full truncate font-mono text-xs text-muted-foreground">
                                    {channel.handle}
                                  </span>
                                )}
                                {channel.isDefault ? (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 shrink-0 px-2 text-xs"
                                    disabled={busy}
                                    onClick={() => patchChannel(channel, { isDefault: false } as Partial<StreamChannel>)}
                                    title={copy.removeDefault}
                                    aria-label={`${copy.removeDefault}: ${PLATFORM_LABELS[channel.platform]}`}
                                  >
                                    <StarIcon data-icon="inline-start" />
                                    {copy.defaultBadge}
                                  </Button>
                                ) : null}
                                {!channel.active ? <Badge variant="outline">{copy.inactive}</Badge> : null}
                              </div>
                            </div>
                            <div className="flex min-w-0 flex-wrap gap-1 sm:justify-end">
                              {!channel.isDefault && DEFAULT_EMBED_PLATFORM_SET.has(channel.platform) ? (
                                <Button variant="ghost" size="sm" className="shrink-0 px-2" disabled={busy} onClick={() => patchChannel(channel, { isDefault: true } as Partial<StreamChannel>)}>
                                  {copy.setDefault}
                                </Button>
                              ) : null}
                              <Button variant="ghost" size="sm" className="shrink-0 px-2" disabled={busy} onClick={() => patchChannel(channel, { active: !channel.active } as Partial<StreamChannel>)}>
                                {channel.active ? copy.disable : copy.enable}
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="text-destructive"
                                disabled={busy}
                                onClick={() => setRemoveTarget(channel)}
                                title={copy.remove}
                                aria-label={copy.remove}
                              >
                                <Trash2Icon />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>

                      {isEditing ? (
                        <div className="grid gap-3 rounded-lg border border-border/70 bg-muted/30 p-3 sm:grid-cols-2">
                          <div className="flex flex-col gap-1.5">
                            <Label>{copy.labels.editLabel}</Label>
                            <Input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <Label>{copy.labels.editLanguage}</Label>
                            <Input value={editLanguage} onChange={(e) => setEditLanguage(e.target.value)} maxLength={8} />
                          </div>
                          <GamePicker games={games} selected={editGames} onChange={setEditGames} copy={copy} />
                          <div className="flex gap-2 sm:col-span-2">
                            <Button size="sm" disabled={busy} onClick={() => saveEdit(group)}>
                              {copy.save}
                            </Button>
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditingKey(null)}>
                              {copy.cancel}
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 p-5 text-center sm:p-8">
                <p className="text-sm text-muted-foreground">{copy.empty}</p>
              </div>
            )}
          </section>
        );
      })}

      <ConfirmDialog
        open={Boolean(removeTarget)}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        title={copy.removeTitle}
        description={
          removeTarget
            ? copy.removeDescription(PLATFORM_LABELS[removeTarget.platform], removeTarget.handle)
            : undefined
        }
        cancelLabel={copy.cancel}
        actions={[
          {
            label: copy.remove,
            variant: "destructive",
            onClick: () => {
              if (removeTarget) void remove(removeTarget);
            },
          },
        ]}
      />

      <ConfirmDialog
        open={Boolean(removeGroupTarget)}
        onOpenChange={(open) => {
          if (!open) setRemoveGroupTarget(null);
        }}
        title={copy.removeStreamerTitle}
        description={
          removeGroupTarget
            ? copy.removeStreamerDescription(groupLabel(removeGroupTarget), removeGroupTarget.channels.length)
            : undefined
        }
        cancelLabel={copy.cancel}
        actions={[
          {
            label: copy.removeStreamer,
            variant: "destructive",
            onClick: () => {
              if (removeGroupTarget) void removeGroup(removeGroupTarget);
            },
          },
        ]}
      />
    </div>
  );
}
