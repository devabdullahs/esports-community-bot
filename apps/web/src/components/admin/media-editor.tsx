"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2Icon, PlusIcon, SaveIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { normalizeSlug, MEDIA_URL_MAX_LENGTH } from "@/lib/media-validation";
import type { LocalizedText, MediaChannelRecord, MediaLink, MediaPlatform } from "@/lib/media";
import { copy, type Locale } from "@/lib/i18n";
import { isSafeUrl } from "@/lib/safe-url";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const ARABIC_LABEL = "العربية";
const empty = (): LocalizedText => ({ en: "", ar: "" });

const PLATFORM_LABELS: Record<MediaPlatform, string> = {
  x: "X (Twitter)",
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  twitch: "Twitch",
  website: "Website",
};
const PLATFORMS = Object.keys(PLATFORM_LABELS) as MediaPlatform[];

function BiField({
  label,
  value,
  onChange,
  multiline,
}: {
  label: string;
  value: LocalizedText;
  onChange: (next: LocalizedText) => void;
  multiline?: boolean;
}) {
  const Comp = multiline ? Textarea : Input;
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <div className="grid gap-2 sm:grid-cols-2">
        <Comp value={value.en} dir="ltr" placeholder="English" onChange={(e) => onChange({ ...value, en: e.target.value })} />
        <Comp value={value.ar} dir="rtl" placeholder={ARABIC_LABEL} onChange={(e) => onChange({ ...value, ar: e.target.value })} />
      </div>
    </Field>
  );
}

function isInvalidLinkUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false; // empty is ignored, not invalid
  if (trimmed.length > MEDIA_URL_MAX_LENGTH) return true;
  return !isSafeUrl(trimmed);
}

export function MediaEditor({
  mode,
  channel,
  locale = "en",
}: {
  mode: "create" | "edit";
  channel?: MediaChannelRecord;
  locale?: Locale;
}) {
  const router = useRouter();
  const [slug, setSlug] = useState(channel?.slug || "");
  const [slugTouched, setSlugTouched] = useState(mode === "edit");
  const [name, setName] = useState<LocalizedText>(channel?.name || empty());
  const [description, setDescription] = useState<LocalizedText>(channel?.description || empty());
  const [logoUrl, setLogoUrl] = useState(channel?.logoUrl || "");
  const [links, setLinks] = useState<MediaLink[]>(channel?.links?.length ? channel.links : []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const adminErrors = copy[locale].adminErrors as Record<string, string>;
  const hasInvalidLinks = links.some((l) => isInvalidLinkUrl(l.url));
  const canSave = Boolean(name.en.trim() && name.ar.trim() && (mode === "edit" || slug.trim()) && !hasInvalidLinks);

  async function uploadLogo(file: File) {
    setError(null);
    setUploading(true);
    try {
      const data = new FormData();
      data.append("file", file);
      const res = await fetch("/api/admin/news/upload", { method: "POST", body: data });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || "Upload failed");
        return;
      }
      setLogoUrl(json.url);
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    setError(null);
    if (hasInvalidLinks) {
      setError(adminErrors["link-url-invalid"] ?? "Link must be a valid http(s) URL");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        slug,
        name,
        description,
        logoUrl: logoUrl.trim() || null,
        links: links.filter((l) => l.url.trim()),
      };
      const res = await fetch(
        mode === "create" ? "/api/admin/media" : `/api/admin/media/${channel?.slug}`,
        {
          method: mode === "create" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.error || "Save failed");
      router.push("/admin/media");
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
          <AlertTitle>Could not save</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{mode === "create" ? "New media channel" : "Edit media channel"}</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="media-slug">URL slug</FieldLabel>
              <Input
                id="media-slug"
                value={slug}
                disabled={mode === "edit"}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(normalizeSlug(e.target.value));
                }}
                placeholder="echo-mena"
              />
              <FieldDescription>
                {mode === "edit" ? "The slug is fixed once created." : `Public URL: /media/${slug || "your-slug"}`}
              </FieldDescription>
            </Field>

            <BiField
              label="Name"
              value={name}
              onChange={(next) => {
                setName(next);
                if (mode === "create" && !slugTouched) setSlug(normalizeSlug(next.en));
              }}
            />
            <BiField label="Description" value={description} onChange={setDescription} multiline />

            <Field>
              <FieldLabel htmlFor="media-logo">Logo image (optional)</FieldLabel>
              <div className="flex gap-2">
                <Input
                  id="media-logo"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  placeholder="https://assets.moonbot.info/..."
                  className="flex-1"
                />
                <input
                  id="media-logo-file"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                  hidden
                  onChange={(e) => {
                    const file = e.currentTarget.files?.[0];
                    e.currentTarget.value = "";
                    if (file) void uploadLogo(file);
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={uploading}
                  onClick={() => document.getElementById("media-logo-file")?.click()}
                >
                  {uploading ? (
                    <Loader2Icon data-icon="inline-start" className="animate-spin" />
                  ) : (
                    <UploadIcon data-icon="inline-start" />
                  )}
                  Upload
                </Button>
              </div>
            </Field>

            <Field>
              <FieldLabel>Social & platform links</FieldLabel>
              <div className="flex flex-col gap-2">
                {links.map((link, index) => {
                  const urlInvalid = isInvalidLinkUrl(link.url);
                  return (
                    <div key={index} className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <Select
                          value={link.platform}
                          onValueChange={(value) =>
                            setLinks((prev) =>
                              prev.map((l, i) => (i === index ? { ...l, platform: value as MediaPlatform } : l)),
                            )
                          }
                        >
                          <SelectTrigger className="w-40 shrink-0">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {PLATFORMS.map((p) => (
                                <SelectItem key={p} value={p}>
                                  {PLATFORM_LABELS[p]}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        <Input
                          value={link.url}
                          dir="ltr"
                          placeholder="https://..."
                          className="flex-1"
                          aria-invalid={urlInvalid}
                          onChange={(e) =>
                            setLinks((prev) => prev.map((l, i) => (i === index ? { ...l, url: e.target.value } : l)))
                          }
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="text-destructive"
                          title="Remove link"
                          aria-label="Remove link"
                          onClick={() => setLinks((prev) => prev.filter((_, i) => i !== index))}
                        >
                          <Trash2Icon />
                        </Button>
                      </div>
                      {urlInvalid ? (
                        <p className="text-xs text-destructive">
                          {adminErrors["link-url-invalid"] ?? "Link must be a valid http(s) URL"}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  onClick={() => setLinks((prev) => [...prev, { platform: "x", url: "" }])}
                >
                  <PlusIcon data-icon="inline-start" />
                  Add link
                </Button>
              </div>
              <FieldDescription>Only http(s) links are saved.</FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={save} disabled={!canSave || busy}>
          <SaveIcon data-icon="inline-start" />
          {mode === "create" ? "Create channel" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
