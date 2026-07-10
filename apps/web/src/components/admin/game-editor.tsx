"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PlusIcon, SaveIcon, Trash2Icon } from "lucide-react";
import { normalizeSlug, validateGameContent } from "@/lib/game-validation";
import { getAdminCopy } from "@/lib/admin-copy";
import type { GameRecord, LocalizedText } from "@/lib/games";
import { copy, localizedPath, type Locale } from "@/lib/i18n";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const ARABIC_LABEL = "العربية";
const empty = (): LocalizedText => ({ en: "", ar: "" });

function BiField({
  label,
  value,
  onChange,
  multiline,
  description,
}: {
  label: string;
  value: LocalizedText;
  onChange: (next: LocalizedText) => void;
  multiline?: boolean;
  description?: string;
}) {
  const Comp = multiline ? Textarea : Input;
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <div className="grid gap-2 sm:grid-cols-2">
        <Comp
          value={value.en}
          dir="ltr"
          placeholder="English"
          onChange={(e) => onChange({ ...value, en: e.target.value })}
        />
        <Comp
          value={value.ar}
          dir="rtl"
          placeholder={ARABIC_LABEL}
          onChange={(e) => onChange({ ...value, ar: e.target.value })}
        />
      </div>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  );
}

export function GameEditor({
  mode,
  game,
  locale = "en",
}: {
  mode: "create" | "edit";
  game?: GameRecord;
  locale?: Locale;
}) {
  const router = useRouter();
  const t = getAdminCopy(locale);
  const [slug, setSlug] = useState(game?.slug || "");
  const [slugTouched, setSlugTouched] = useState(mode === "edit");
  const [title, setTitle] = useState<LocalizedText>(game?.title || empty());
  const [status, setStatus] = useState<LocalizedText>(game?.status || empty());
  const [description, setDescription] = useState<LocalizedText>(game?.description || empty());
  const [owner, setOwner] = useState<LocalizedText>(game?.owner || empty());
  const [focus, setFocus] = useState<LocalizedText[]>(game?.focus?.length ? game.focus : [empty()]);
  const [discordChannelId, setDiscordChannelId] = useState(game?.discordChannelId || "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSave = Boolean(
    title.en.trim() && title.ar.trim() && (mode === "edit" || slug.trim()),
  );

  async function save() {
    setError(null);
    const clientPayload = {
      slug,
      title,
      status,
      description,
      owner,
      focus: focus.filter((f) => f.en.trim() || f.ar.trim()),
      discordChannelId: discordChannelId.trim(),
    };
    const clientValidation = validateGameContent(clientPayload);
    if (!clientValidation.ok) {
      const adminErrors = copy[locale].adminErrors as Record<string, string>;
      setError(adminErrors[clientValidation.code] ?? clientValidation.error);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(
        mode === "create" ? "/api/admin/games" : `/api/admin/games/${game?.slug}`,
        {
          method: mode === "create" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(clientPayload),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t.common.couldNotSave);
      router.push(localizedPath("/admin/games", locale));
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t.common.couldNotSave}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{mode === "create" ? t.games.newTitle : t.games.editTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="game-slug">{t.editor.urlSlug}</FieldLabel>
              <Input
                id="game-slug"
                value={slug}
                disabled={mode === "edit"}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(normalizeSlug(e.target.value));
                }}
                placeholder="valorant"
              />
              <FieldDescription>
                {mode === "edit"
                  ? t.editor.fixedGameSlug
                  : t.editor.gamePublicUrl(slug)}
              </FieldDescription>
            </Field>

            <BiField
              label={t.editor.titleLabel}
              value={title}
              onChange={(next) => {
                setTitle(next);
                if (mode === "create" && !slugTouched) setSlug(normalizeSlug(next.en));
              }}
              description={t.editor.titleDescription}
            />
            <BiField
              label={t.editor.statusBadge}
              value={status}
              onChange={setStatus}
              description={t.editor.statusDescription}
            />
            <BiField label={t.editor.descriptionLabel} value={description} onChange={setDescription} multiline />
            <BiField label={t.editor.ownerLabel} value={owner} onChange={setOwner} />

            <Field>
              <FieldLabel htmlFor="game-discord-channel">{t.editor.discordNewsChannel}</FieldLabel>
              <Input
                id="game-discord-channel"
                value={discordChannelId}
                dir="ltr"
                inputMode="numeric"
                placeholder="e.g. 123456789012345678"
                onChange={(e) => setDiscordChannelId(e.target.value)}
              />
              <FieldDescription>
                {t.editor.discordNewsDescription}
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel>{t.editor.focusTags}</FieldLabel>
              <div className="flex flex-col gap-2">
                {focus.map((tag, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      value={tag.en}
                      dir="ltr"
                      placeholder={t.editor.englishTag}
                      className="flex-1"
                      onChange={(e) =>
                        setFocus((prev) =>
                          prev.map((f, i) => (i === index ? { ...f, en: e.target.value } : f)),
                        )
                      }
                    />
                    <Input
                      value={tag.ar}
                      dir="rtl"
                      placeholder={t.editor.arabicTag}
                      className="flex-1"
                      onChange={(e) =>
                        setFocus((prev) =>
                          prev.map((f, i) => (i === index ? { ...f, ar: e.target.value } : f)),
                        )
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="text-destructive"
                      title={t.editor.removeTag}
                      aria-label={t.editor.removeTag}
                      onClick={() => setFocus((prev) => prev.filter((_, i) => i !== index))}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  onClick={() => setFocus((prev) => [...prev, empty()])}
                >
                  <PlusIcon data-icon="inline-start" />
                  {t.editor.addTag}
                </Button>
              </div>
              <FieldDescription>{t.editor.focusDescription}</FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={save} disabled={!canSave || busy}>
          <SaveIcon data-icon="inline-start" />
          {mode === "create" ? t.editor.createGame : t.common.saveChanges}
        </Button>
      </div>
    </div>
  );
}
