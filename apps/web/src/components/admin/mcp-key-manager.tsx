"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CalendarIcon, CopyIcon, KeyRoundIcon, Trash2Icon, XIcon } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import type { McpKey } from "@/lib/mcp-keys";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type Opt = { slug: string; label: string };

function text(locale: Locale) {
  return locale === "ar"
    ? {
        create: "إنشاء مفتاح MCP",
        label: "التسمية",
        owner: "معرّف ديسكورد للمالك",
        ownerName: "اسم المالك",
        ownerDescription: "يصدر المفتاح لحسابك الإداري المسجل حاليا.",
        expiresAt: "ينتهي في",
        expiryDescription: "اختر تاريخا ووقتا أو اتركه بلا انتهاء.",
        noExpiry: "بلا انتهاء",
        clearExpiry: "مسح الانتهاء",
        expiryPast: "اختر وقت انتهاء في المستقبل.",
        tools: "الأدوات",
        games: "الألعاب",
        media: "قنوات الإعلام",
        createAction: "إنشاء المفتاح",
        secretTitle: "انسخ المفتاح الآن",
        secretDescription: "لن يظهر هذا المفتاح مرة أخرى بعد تحديث الصفحة.",
        activeKeys: "المفاتيح",
        revoked: "ملغي",
        active: "نشط",
        revoke: "إلغاء",
        revokeConfirm: "إلغاء هذا المفتاح؟",
        copied: "تم النسخ",
        failed: "فشل الإجراء",
      }
    : {
        create: "Create MCP key",
        label: "Label",
        owner: "Owner Discord ID",
        ownerName: "Owner name",
        ownerDescription: "Keys are issued to your signed-in admin account.",
        expiresAt: "Expires at",
        expiryDescription: "Pick a date and time, or leave blank for no expiry.",
        noExpiry: "No expiry",
        clearExpiry: "Clear expiry",
        expiryPast: "Pick a future expiry time.",
        tools: "Tools",
        games: "Games",
        media: "Media channels",
        createAction: "Create key",
        secretTitle: "Copy this key now",
        secretDescription: "This secret will not be shown again after the page refreshes.",
        activeKeys: "Keys",
        revoked: "Revoked",
        active: "Active",
        revoke: "Revoke",
        revokeConfirm: "Revoke this MCP key?",
        copied: "Copied",
        failed: "Action failed",
      };
}

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
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const on = selected.has(option.slug);
          return (
            <button
              key={option.slug}
              type="button"
              onClick={() => onToggle(option.slug)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition-colors",
                on
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function getExpirySeconds(date: Date | undefined, time: string) {
  if (!date) return null;
  const [rawHours, rawMinutes] = time.split(":").map((part) => Number(part));
  const expiresAt = new Date(date);
  expiresAt.setHours(
    Number.isFinite(rawHours) ? rawHours : 23,
    Number.isFinite(rawMinutes) ? rawMinutes : 59,
    0,
    0,
  );
  return Math.floor(expiresAt.getTime() / 1000);
}

export function McpKeyManager({
  keys,
  tools,
  games,
  media,
  locale,
  defaultOwnerDiscordId,
  defaultOwnerName,
}: {
  keys: McpKey[];
  tools: string[];
  games: Opt[];
  media: Opt[];
  locale: Locale;
  defaultOwnerDiscordId: string;
  defaultOwnerName: string;
}) {
  const router = useRouter();
  const t = text(locale);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<McpKey | null>(null);
  const [label, setLabel] = useState("");
  const ownerDiscordId = defaultOwnerDiscordId;
  const ownerName = defaultOwnerName;
  const [expiresOn, setExpiresOn] = useState<Date | undefined>();
  const [expiresTime, setExpiresTime] = useState("23:59");
  const [selectedTools, setSelectedTools] = useState<Set<string>>(new Set(tools));
  const [selectedGames, setSelectedGames] = useState<Set<string>>(new Set());
  const [selectedMedia, setSelectedMedia] = useState<Set<string>>(new Set());
  const dateFormatter = new Intl.DateTimeFormat(locale === "ar" ? "ar-SA" : "en-US", {
    dateStyle: "medium",
  });
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const toggle = (set: Set<string>, setFn: (next: Set<string>) => void, value: string) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setFn(next);
  };

  async function createKey() {
    setBusy(true);
    setError(null);
    setSecret(null);
    try {
      const expiresAt = getExpirySeconds(expiresOn, expiresTime);
      if (expiresAt !== null && expiresAt <= Math.floor(Date.now() / 1000)) {
        throw new Error(t.expiryPast);
      }
      const res = await fetch("/api/admin/mcp-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label,
          ownerDiscordId,
          ownerName,
          expiresAt,
          tools: [...selectedTools],
          games: [...selectedGames],
          media: [...selectedMedia],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t.failed);
      setSecret(data.secret);
      setLabel("");
      setExpiresOn(undefined);
      setExpiresTime("23:59");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: number) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/mcp-keys/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t.failed);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copySecret() {
    if (!secret) return;
    await navigator.clipboard.writeText(secret);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t.failed}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {secret ? (
        <Alert>
          <KeyRoundIcon className="size-4" />
          <AlertTitle>{t.secretTitle}</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <span>{t.secretDescription}</span>
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
              <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs">
                {secret}
              </code>
              <Button type="button" variant="outline" onClick={copySecret}>
                <CopyIcon data-icon="inline-start" />
                {copied ? t.copied : "Copy"}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t.create}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel>{t.label}</FieldLabel>
              <Input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Codex admin" />
            </Field>
            <Field>
              <FieldLabel>{t.expiresAt}</FieldLabel>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Popover>
                  <PopoverTrigger
                    render={
                      <Button
                        type="button"
                        variant="outline"
                        className={cn(
                          "justify-start text-start sm:min-w-48",
                          !expiresOn && "text-muted-foreground",
                        )}
                      />
                    }
                  >
                    <CalendarIcon data-icon="inline-start" />
                    {expiresOn ? dateFormatter.format(expiresOn) : t.noExpiry}
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={expiresOn}
                      onSelect={setExpiresOn}
                      disabled={{ before: today }}
                    />
                  </PopoverContent>
                </Popover>
                <Input
                  type="time"
                  value={expiresTime}
                  onChange={(event) => setExpiresTime(event.target.value)}
                  disabled={!expiresOn}
                  className="sm:w-32"
                />
                {expiresOn ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setExpiresOn(undefined)}
                    aria-label={t.clearExpiry}
                    title={t.clearExpiry}
                  >
                    <XIcon />
                  </Button>
                ) : null}
              </div>
              <FieldDescription>{t.expiryDescription}</FieldDescription>
            </Field>
            <Field data-disabled>
              <FieldLabel>{t.owner}</FieldLabel>
              <Input value={ownerDiscordId} readOnly disabled />
              <FieldDescription>{t.ownerDescription}</FieldDescription>
            </Field>
            <Field data-disabled>
              <FieldLabel>{t.ownerName}</FieldLabel>
              <Input value={ownerName} readOnly disabled />
            </Field>
          </div>
          <Chips
            title={t.tools}
            options={tools.map((tool) => ({ slug: tool, label: tool }))}
            selected={selectedTools}
            onToggle={(tool) => toggle(selectedTools, setSelectedTools, tool)}
          />
          <Chips
            title={t.games}
            options={games}
            selected={selectedGames}
            onToggle={(game) => toggle(selectedGames, setSelectedGames, game)}
          />
          <Chips
            title={t.media}
            options={media}
            selected={selectedMedia}
            onToggle={(channel) => toggle(selectedMedia, setSelectedMedia, channel)}
          />
          <Button onClick={createKey} disabled={busy || !ownerDiscordId.trim() || selectedTools.size === 0} className="w-fit">
            <KeyRoundIcon data-icon="inline-start" />
            {t.createAction}
          </Button>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t.activeKeys}</h2>
        {keys.map((key) => (
          <Card key={key.id} size="sm">
            <CardContent className="flex flex-col gap-3 py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{key.label || key.keyPrefix}</span>
                    <Badge variant={key.revokedAt ? "secondary" : "default"}>
                      {key.revokedAt ? t.revoked : t.active}
                    </Badge>
                  </div>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">{key.keyPrefix}...</p>
                  <p className="text-xs text-muted-foreground">
                    {key.ownerName || key.ownerDiscordId} · created {key.createdAt}
                    {key.lastUsedAt ? ` · last used ${key.lastUsedAt}` : ""}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-destructive"
                  disabled={busy || Boolean(key.revokedAt)}
                  onClick={() => setRemoveTarget(key)}
                  aria-label={t.revoke}
                  title={t.revoke}
                >
                  <Trash2Icon />
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {key.tools.map((tool) => (
                  <Badge key={tool} variant="outline">{tool}</Badge>
                ))}
                {key.games.map((game) => (
                  <Badge key={`g-${game}`} variant="secondary">{game}</Badge>
                ))}
                {key.media.map((channel) => (
                  <Badge key={`m-${channel}`} variant="secondary">{channel}</Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        title={t.revokeConfirm}
        cancelLabel={locale === "ar" ? "إلغاء" : "Cancel"}
        actions={[
          {
            label: t.revoke,
            variant: "destructive",
            onClick: () => {
              const target = removeTarget;
              setRemoveTarget(null);
              if (target) void revoke(target.id);
            },
          },
        ]}
      />
    </div>
  );
}
