"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { CheckIcon, PencilIcon, PlusIcon, StarIcon, Trash2Icon } from "lucide-react";
import {
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

const SCOPE_LABELS: Record<StreamScope, string> = {
  ewc: "EWC official list",
  game: "Per game",
  team: "Per team",
  match: "Per match",
};

const SCOPE_ORDER: StreamScope[] = ["ewc", "game", "team", "match"];
const EMBED_PLATFORMS: StreamPlatform[] = ["twitch", "kick"];

function scopeTarget(channel: StreamChannel): string | null {
  if (channel.scope === "game") return channel.gameSlugs.join(", ");
  if (channel.scope === "team") return channel.teamKey;
  if (channel.scope === "match") return channel.matchExternalId;
  return channel.gameSlugs.length ? channel.gameSlugs.join(", ") : null;
}

function firstHandle(handles: Record<StreamPlatform, string>): string {
  return STREAM_PLATFORMS.map((platform) => handles[platform].trim()).find(Boolean) ?? "";
}

function GamePicker({
  games,
  selected,
  onChange,
  required,
}: {
  games: GameOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  required?: boolean;
}) {
  const selectedSet = new Set(selected);
  return (
    <div className="flex flex-col gap-2 sm:col-span-2">
      <div className="flex items-center justify-between gap-3">
        <Label>{required ? "Games" : "Game tags (optional)"}</Label>
        <span className="text-xs text-muted-foreground">{selected.length} selected</span>
      </div>
      <div className="flex flex-wrap gap-2 rounded-md border p-2">
        {games.map((game) => {
          const active = selectedSet.has(game.slug);
          return (
            <Button
              key={game.slug}
              type="button"
              variant={active ? "default" : "outline"}
              size="sm"
              onClick={() =>
                onChange(active ? selected.filter((slug) => slug !== game.slug) : [...selected, game.slug])
              }
            >
              {active ? <CheckIcon data-icon="inline-start" /> : null}
              {game.name}
            </Button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Pick with buttons instead of typing separators. This also lets one streamer appear under multiple games.
      </p>
    </div>
  );
}

export function StreamChannelsManager({
  channels,
  games,
}: {
  channels: StreamChannel[];
  games: GameOption[];
}) {
  const router = useRouter();
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
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editLanguage, setEditLanguage] = useState("");
  const [editGames, setEditGames] = useState<string[]>([]);
  const [removeTarget, setRemoveTarget] = useState<StreamChannel | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<StreamScope, StreamChannel[]>();
    for (const s of SCOPE_ORDER) map.set(s, []);
    for (const channel of items) map.get(channel.scope)?.push(channel);
    return map;
  }, [items]);

  function updateHandle(platform: StreamPlatform, value: string) {
    setHandles((prev) => ({ ...prev, [platform]: value }));
  }

  function startEdit(channel: StreamChannel) {
    setEditingId(channel.id);
    setEditLabel(channel.label);
    setEditLanguage(channel.language ?? "");
    setEditGames(channel.gameSlugs);
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const entries = STREAM_PLATFORMS.map((p) => ({ platform: p, handle: handles[p].trim() })).filter((e) => e.handle);
    if (!entries.length) {
      setError("Add at least one platform handle or URL.");
      return;
    }
    if (entries.length > 1 && !label.trim()) {
      setError("A display label is required when adding multiple platform channels for the same streamer.");
      return;
    }
    if (scope === "game" && selectedGames.length === 0) {
      setError("Pick at least one game for a per-game channel.");
      return;
    }

    const creatorKey = normalizeCreatorKey(label || firstHandle(handles));
    const embeddableEntries = entries.filter((entry) => EMBED_PLATFORMS.includes(entry.platform));
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
          setError(data?.error || `Could not add ${PLATFORM_LABELS[entry.platform]} (${res.status}).`);
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
      setError("Network error — please try again.");
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
        setError(data?.error || `Could not update ${channel.label || channel.handle}.`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(channel: StreamChannel) {
    await patchChannel(channel, {
      label: editLabel,
      language: editLanguage,
      gameSlugs: editGames,
      creatorKey: channel.creatorKey,
    } as Partial<StreamChannel>);
    setEditingId(null);
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

  return (
    <div className="flex flex-col gap-8">
      <form onSubmit={add} className="flex flex-col gap-4 rounded-lg border p-4">
        <div>
          <h2 className="text-lg font-semibold">Add co-streamer channels</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Add Twitch, Kick, YouTube, and SOOP for one streamer in a single action. Pick which platform should be the default embed.
          </p>
        </div>
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Could not save</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="stream-label">Streamer display label</Label>
            <Input
              id="stream-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="OWBrain"
              autoComplete="off"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Default embed platform</Label>
            <Select value={defaultPlatform} onValueChange={(value) => setDefaultPlatform(value as StreamPlatform)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Default platform" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {EMBED_PLATFORMS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {PLATFORM_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Embeds are available for Twitch and Kick. Other platforms are saved as links.</p>
          </div>

          {STREAM_PLATFORMS.map((p) => (
            <div key={p} className="flex flex-col gap-1.5">
              <Label htmlFor={`stream-${p}`}>{PLATFORM_LABELS[p]} handle or URL</Label>
              <Input
                id={`stream-${p}`}
                value={handles[p]}
                onChange={(e) => updateHandle(p, e.target.value)}
                placeholder={p === "twitch" ? "owbrain · twitch.tv/owbrain" : `${PLATFORM_LABELS[p]} channel URL`}
                autoComplete="off"
              />
            </div>
          ))}

          <div className="flex flex-col gap-1.5">
            <Label>Scope</Label>
            <Select value={scope} onValueChange={(value) => setScope(value as StreamScope)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Scope" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {STREAM_SCOPES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {SCOPE_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="stream-language">Language (optional)</Label>
            <Input
              id="stream-language"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              placeholder="en · ar"
              autoComplete="off"
              maxLength={8}
            />
          </div>

          <GamePicker
            games={games}
            selected={selectedGames}
            onChange={setSelectedGames}
            required={scope === "game"}
          />

          {scope === "team" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="stream-team">Team name</Label>
              <Input
                id="stream-team"
                value={team}
                onChange={(e) => setTeam(e.target.value)}
                placeholder="Twisted Minds"
                autoComplete="off"
              />
            </div>
          ) : null}
          {scope === "match" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="stream-match">Match external id</Label>
              <Input
                id="stream-match"
                value={matchExternalId}
                onChange={(e) => setMatchExternalId(e.target.value)}
                placeholder="sgg:104353062 · Match:ID_..."
                autoComplete="off"
              />
            </div>
          ) : null}
        </div>

        <Button type="submit" disabled={busy} className="w-fit">
          <PlusIcon data-icon="inline-start" />
          Add streamer
        </Button>
      </form>

      {SCOPE_ORDER.map((s) => {
        const list = grouped.get(s) ?? [];
        return (
          <section key={s} className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-lg font-semibold">{SCOPE_LABELS[s]}</h2>
              <span className="text-sm text-muted-foreground">{list.length} channel(s)</span>
            </div>
            {list.length ? (
              <div className="flex flex-col gap-2">
                {list.map((channel) => {
                  const target = scopeTarget(channel);
                  const isEditing = editingId === channel.id;
                  return (
                    <div
                      key={channel.id}
                      className={`flex flex-col gap-3 rounded-lg border p-3 ${channel.active ? "" : "opacity-60"}`}
                    >
                      <div className="flex items-center gap-3">
                        <Badge variant={channel.isDefault ? "default" : "secondary"}>
                          {channel.isDefault ? <StarIcon data-icon="inline-start" /> : null}
                          {PLATFORM_LABELS[channel.platform]}
                        </Badge>
                        <div className="flex flex-1 flex-col gap-0.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{channel.label || channel.handle}</span>
                            {channel.url ? (
                              <a
                                href={channel.url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
                              >
                                {channel.handle}
                                <PlatformIcon platform={channel.platform} className="size-3" />
                              </a>
                            ) : (
                              <span className="font-mono text-xs text-muted-foreground">{channel.handle}</span>
                            )}
                            {target ? <Badge variant="outline">{target}</Badge> : null}
                            {channel.language ? <Badge variant="outline">{channel.language}</Badge> : null}
                            {!channel.active ? <Badge variant="outline">inactive</Badge> : null}
                          </div>
                          <p className="text-xs text-muted-foreground">Group: {channel.creatorKey}</p>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {!channel.isDefault && EMBED_PLATFORMS.includes(channel.platform) ? (
                            <Button variant="ghost" size="sm" disabled={busy} onClick={() => patchChannel(channel, { isDefault: true } as Partial<StreamChannel>)}>
                              Set default
                            </Button>
                          ) : null}
                          <Button variant="ghost" size="sm" disabled={busy} onClick={() => patchChannel(channel, { active: !channel.active } as Partial<StreamChannel>)}>
                            {channel.active ? "Disable" : "Enable"}
                          </Button>
                          <Button variant="ghost" size="icon-sm" disabled={busy} onClick={() => startEdit(channel)} title="Edit" aria-label="Edit">
                            <PencilIcon />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-destructive"
                            disabled={busy}
                            onClick={() => setRemoveTarget(channel)}
                            title="Remove"
                            aria-label="Remove"
                          >
                            <Trash2Icon />
                          </Button>
                        </div>
                      </div>

                      {isEditing ? (
                        <div className="grid gap-3 rounded-md border bg-muted/30 p-3 sm:grid-cols-2">
                          <div className="flex flex-col gap-1.5">
                            <Label>Edit label</Label>
                            <Input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <Label>Edit language</Label>
                            <Input value={editLanguage} onChange={(e) => setEditLanguage(e.target.value)} maxLength={8} />
                          </div>
                          <GamePicker games={games} selected={editGames} onChange={setEditGames} />
                          <div className="flex gap-2 sm:col-span-2">
                            <Button size="sm" disabled={busy} onClick={() => saveEdit(channel)}>
                              Save
                            </Button>
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditingId(null)}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-md border border-dashed p-6 text-center">
                <p className="text-sm text-muted-foreground">No channels yet.</p>
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
        title="Remove co-stream channel?"
        description={
          removeTarget
            ? `This removes ${PLATFORM_LABELS[removeTarget.platform]} / ${removeTarget.handle} from the co-stream registry.`
            : undefined
        }
        cancelLabel="Cancel"
        actions={[
          {
            label: "Remove",
            variant: "destructive",
            onClick: () => {
              if (removeTarget) void remove(removeTarget);
            },
          },
        ]}
      />
    </div>
  );
}
