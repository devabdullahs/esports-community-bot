"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PencilIcon, Trash2Icon, UserPlusIcon, XIcon } from "lucide-react";
import type { AdminRow } from "@/lib/admins";
import { getAdminCopy } from "@/lib/admin-copy";
import type { Locale } from "@/lib/i18n";
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
  emptyLabel,
}: {
  title: string;
  options: Opt[];
  selected: Set<string>;
  onToggle: (slug: string) => void;
  emptyLabel: string;
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
        <p className="text-xs text-muted-foreground">{emptyLabel}</p>
      )}
    </div>
  );
}

export function TeamManager({
  admins,
  games,
  media,
  locale,
}: {
  admins: AdminRow[];
  games: Opt[];
  media: Opt[];
  locale: Locale;
}) {
  const router = useRouter();
  const t = getAdminCopy(locale);
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
      setError(t.team.discordIdRequired);
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
      if (!res.ok) throw new Error(data.error || t.team.addFailed);
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
      if (!res.ok) throw new Error(data.error || t.team.saveFailed);
      setEditId(null);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(discordId: string, name: string) {
    if (!window.confirm(t.team.removeConfirm(name || discordId))) return;
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
          <AlertTitle>{t.common.actionFailed}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t.team.addCardTitle}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="add-id">{t.team.discordId}</FieldLabel>
              <Input
                id="add-id"
                value={addId}
                onChange={(e) => setAddId(e.target.value)}
                placeholder={t.team.discordIdPlaceholder}
              />
              <FieldDescription>{t.team.discordIdDescription}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="add-name">{t.team.displayName}</FieldLabel>
              <Input
                id="add-name"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                placeholder={t.team.displayNamePlaceholder}
              />
            </Field>
          </div>
          <Chips title={t.team.gamesManage} options={games} selected={addGames} onToggle={(s) => toggle(addGames, setAddGames, s)} emptyLabel={t.team.noneAvailable} />
          <Chips title={t.team.mediaManage} options={media} selected={addMedia} onToggle={(s) => toggle(addMedia, setAddMedia, s)} emptyLabel={t.team.noneAvailable} />
          <Button onClick={addAdmin} disabled={busy || !addId.trim()} className="w-fit">
            <UserPlusIcon data-icon="inline-start" />
            {t.team.addAction}
          </Button>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">
          {t.team.adminsCount(admins.length)}
        </h2>
        {admins.length ? (
          admins.map((admin) => (
            <Card key={admin.discordId} size="sm">
              <CardContent className="flex flex-col gap-3 pt-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">{admin.displayName || t.team.noName}</span>
                    <span className="font-mono text-xs text-muted-foreground">{admin.discordId}</span>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={t.common.edit}
                      aria-label={t.common.edit}
                      onClick={() => (editId === admin.discordId ? setEditId(null) : startEdit(admin))}
                    >
                      {editId === admin.discordId ? <XIcon /> : <PencilIcon />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-destructive"
                      title={t.common.remove}
                      aria-label={t.common.remove}
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
                      <FieldLabel>{t.team.displayName}</FieldLabel>
                      <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                    </Field>
                    <Chips title={t.team.games} options={games} selected={editGames} onToggle={(s) => toggle(editGames, setEditGames, s)} emptyLabel={t.team.noneAvailable} />
                    <Chips title={t.team.media} options={media} selected={editMedia} onToggle={(s) => toggle(editMedia, setEditMedia, s)} emptyLabel={t.team.noneAvailable} />
                    <Button onClick={saveEdit} disabled={busy} className="w-fit" size="sm">
                      {t.common.saveChanges}
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {admin.games.length === 0 && admin.media.length === 0 ? (
                      <span className="text-xs text-muted-foreground">{t.team.noAssignments}</span>
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
              {t.team.empty}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
