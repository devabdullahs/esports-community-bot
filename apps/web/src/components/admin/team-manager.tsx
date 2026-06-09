"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PencilIcon, Trash2Icon, UserPlusIcon, XIcon } from "lucide-react";
import type { AdminRow } from "@/lib/admins";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type Opt = { slug: string; label: string };

function Chips({
  title,
  options,
  selected,
  onToggle,
}: {
  title: string;
  options: Opt[];
  selected: Set<string>;
  onToggle: (slug: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      {options.length ? (
        <div className="flex flex-wrap gap-1.5">
          {options.map((o) => {
            const on = selected.has(o.slug);
            return (
              <button
                key={o.slug}
                type="button"
                onClick={() => onToggle(o.slug)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs transition-colors",
                  on
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:bg-muted",
                )}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">None available</p>
      )}
    </div>
  );
}

export function TeamManager({
  admins,
  games,
  media,
}: {
  admins: AdminRow[];
  games: Opt[];
  media: Opt[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [addId, setAddId] = useState("");
  const [addName, setAddName] = useState("");
  const [addGames, setAddGames] = useState<Set<string>>(new Set());
  const [addMedia, setAddMedia] = useState<Set<string>>(new Set());

  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editGames, setEditGames] = useState<Set<string>>(new Set());
  const [editMedia, setEditMedia] = useState<Set<string>>(new Set());

  const labelOf = (opts: Opt[], slug: string) => opts.find((o) => o.slug === slug)?.label ?? slug;
  const toggle = (set: Set<string>, setFn: (s: Set<string>) => void, slug: string) => {
    const next = new Set(set);
    if (next.has(slug)) next.delete(slug);
    else next.add(slug);
    setFn(next);
  };

  async function addAdmin() {
    if (!addId.trim()) {
      setError("Discord ID is required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discordId: addId.trim(),
          displayName: addName.trim(),
          games: [...addGames],
          media: [...addMedia],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to add admin");
      setAddId("");
      setAddName("");
      setAddGames(new Set());
      setAddMedia(new Set());
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function startEdit(admin: AdminRow) {
    setEditId(admin.discordId);
    setEditName(admin.displayName);
    setEditGames(new Set(admin.games));
    setEditMedia(new Set(admin.media));
  }

  async function saveEdit() {
    if (!editId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/team/${editId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: editName.trim(),
          games: [...editGames],
          media: [...editMedia],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to save");
      setEditId(null);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(discordId: string, name: string) {
    if (!window.confirm(`Remove ${name || discordId} from the admin team?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/team/${discordId}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Action failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Add admin</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="add-id">Discord user ID</FieldLabel>
              <Input
                id="add-id"
                value={addId}
                onChange={(e) => setAddId(e.target.value)}
                placeholder="e.g. 100000000000000001"
              />
              <FieldDescription>The member&apos;s Discord account (snowflake) ID.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="add-name">Display name</FieldLabel>
              <Input
                id="add-name"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                placeholder="e.g. Echo MENA team"
              />
            </Field>
          </div>
          <Chips title="Games they can manage" options={games} selected={addGames} onToggle={(s) => toggle(addGames, setAddGames, s)} />
          <Chips title="Media channels they can manage" options={media} selected={addMedia} onToggle={(s) => toggle(addMedia, setAddMedia, s)} />
          <Button onClick={addAdmin} disabled={busy || !addId.trim()} className="w-fit">
            <UserPlusIcon data-icon="inline-start" />
            Add admin
          </Button>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">
          Admins ({admins.length})
        </h2>
        {admins.length ? (
          admins.map((admin) => (
            <Card key={admin.discordId} size="sm">
              <CardContent className="flex flex-col gap-3 pt-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">{admin.displayName || "(no name)"}</span>
                    <span className="font-mono text-xs text-muted-foreground">{admin.discordId}</span>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="Edit"
                      aria-label="Edit"
                      onClick={() => (editId === admin.discordId ? setEditId(null) : startEdit(admin))}
                    >
                      {editId === admin.discordId ? <XIcon /> : <PencilIcon />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-destructive"
                      title="Remove"
                      aria-label="Remove"
                      disabled={busy}
                      onClick={() => remove(admin.discordId, admin.displayName)}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                </div>

                {editId === admin.discordId ? (
                  <div className="flex flex-col gap-3 border-t pt-3">
                    <Field>
                      <FieldLabel>Display name</FieldLabel>
                      <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                    </Field>
                    <Chips title="Games" options={games} selected={editGames} onToggle={(s) => toggle(editGames, setEditGames, s)} />
                    <Chips title="Media channels" options={media} selected={editMedia} onToggle={(s) => toggle(editMedia, setEditMedia, s)} />
                    <Button onClick={saveEdit} disabled={busy} className="w-fit" size="sm">
                      Save changes
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {admin.games.length === 0 && admin.media.length === 0 ? (
                      <span className="text-xs text-muted-foreground">No assignments yet</span>
                    ) : (
                      <>
                        {admin.games.map((slug) => (
                          <Badge key={`g-${slug}`} variant="secondary">
                            {labelOf(games, slug)}
                          </Badge>
                        ))}
                        {admin.media.map((slug) => (
                          <Badge key={`m-${slug}`} variant="outline">
                            {labelOf(media, slug)}
                          </Badge>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        ) : (
          <div className="rounded-md border border-dashed p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No regular admins yet. Add one above to delegate specific games or channels.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
