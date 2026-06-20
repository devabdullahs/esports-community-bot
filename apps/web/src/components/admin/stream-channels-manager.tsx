"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { ExternalLinkIcon, PlusIcon, Trash2Icon } from "lucide-react";
import {
  STREAM_PLATFORMS,
  STREAM_SCOPES,
  type StreamChannel,
  type StreamPlatform,
  type StreamScope,
} from "@/lib/stream-types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

// EWC first (the headline list), then the broadest scopes.
const SCOPE_ORDER: StreamScope[] = ["ewc", "game", "team", "match"];

function scopeTarget(channel: StreamChannel): string | null {
  if (channel.scope === "game") return channel.gameSlug;
  if (channel.scope === "team") return channel.teamKey;
  if (channel.scope === "match") return channel.matchExternalId;
  return null;
}

export function StreamChannelsManager({ channels }: { channels: StreamChannel[] }) {
  const router = useRouter();
  const [items, setItems] = useState<StreamChannel[]>(channels);
  const [platform, setPlatform] = useState<StreamPlatform>("twitch");
  const [scope, setScope] = useState<StreamScope>("ewc");
  const [handle, setHandle] = useState("");
  const [label, setLabel] = useState("");
  const [gameSlug, setGameSlug] = useState("");
  const [team, setTeam] = useState("");
  const [matchExternalId, setMatchExternalId] = useState("");
  const [language, setLanguage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<StreamScope, StreamChannel[]>();
    for (const s of SCOPE_ORDER) map.set(s, []);
    for (const channel of items) map.get(channel.scope)?.push(channel);
    return map;
  }, [items]);

  async function add(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/streams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, handle, label, scope, gameSlug, team, matchExternalId, language }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || `Could not add the channel (${res.status}).`);
        return;
      }
      setItems((prev) => [...prev.filter((c) => c.id !== data.id), data as StreamChannel]);
      setHandle("");
      setLabel("");
      setGameSlug("");
      setTeam("");
      setMatchExternalId("");
      router.refresh();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(channel: StreamChannel) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/streams/${channel.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !channel.active }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data) setItems((prev) => prev.map((c) => (c.id === channel.id ? (data as StreamChannel) : c)));
    } finally {
      setBusy(false);
    }
  }

  async function remove(channel: StreamChannel) {
    if (!window.confirm(`Remove ${PLATFORM_LABELS[channel.platform]} / ${channel.handle}?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/streams/${channel.id}`, { method: "DELETE" });
      if (res.ok) setItems((prev) => prev.filter((c) => c.id !== channel.id));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <form onSubmit={add} className="flex flex-col gap-4 rounded-lg border p-4">
        <h2 className="text-lg font-semibold">Add a co-stream channel</h2>
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Could not add</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>Platform</Label>
            <Select value={platform} onValueChange={(value) => setPlatform(value as StreamPlatform)}>
              <SelectTrigger className="w-full">
                <SelectValue>{(value) => PLATFORM_LABELS[value as StreamPlatform] ?? value}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {STREAM_PLATFORMS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {PLATFORM_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="stream-handle">Channel handle or URL</Label>
            <Input
              id="stream-handle"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="owbrain  ·  twitch.tv/owbrain"
              autoComplete="off"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Scope</Label>
            <Select value={scope} onValueChange={(value) => setScope(value as StreamScope)}>
              <SelectTrigger className="w-full">
                <SelectValue>{(value) => SCOPE_LABELS[value as StreamScope] ?? value}</SelectValue>
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

          {scope === "game" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="stream-game">Game slug</Label>
              <Input
                id="stream-game"
                value={gameSlug}
                onChange={(e) => setGameSlug(e.target.value)}
                placeholder="overwatch · rocketleague · valorant"
                autoComplete="off"
              />
            </div>
          ) : null}
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
                placeholder="sgg:104353062 · Match:ID_…"
                autoComplete="off"
              />
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="stream-label">Display label (optional)</Label>
            <Input
              id="stream-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="OWBrain"
              autoComplete="off"
            />
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
        </div>

        <Button type="submit" disabled={busy} className="w-fit">
          <PlusIcon data-icon="inline-start" />
          Add channel
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
                  return (
                    <div
                      key={channel.id}
                      className={`flex items-center gap-3 rounded-lg border p-3 ${channel.active ? "" : "opacity-60"}`}
                    >
                      <Badge variant="secondary">{PLATFORM_LABELS[channel.platform]}</Badge>
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
                              <ExternalLinkIcon className="size-3" />
                            </a>
                          ) : (
                            <span className="font-mono text-xs text-muted-foreground">{channel.handle}</span>
                          )}
                          {target ? <Badge variant="outline">{target}</Badge> : null}
                          {channel.language ? <Badge variant="outline">{channel.language}</Badge> : null}
                          {!channel.active ? <Badge variant="outline">inactive</Badge> : null}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => toggleActive(channel)}>
                          {channel.active ? "Disable" : "Enable"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-destructive"
                          disabled={busy}
                          onClick={() => remove(channel)}
                          title="Remove"
                          aria-label="Remove"
                        >
                          <Trash2Icon />
                        </Button>
                      </div>
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
    </div>
  );
}
