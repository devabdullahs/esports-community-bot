"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  BookOpenIcon,
  CalendarIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  KeyRoundIcon,
  LinkIcon,
  LockIcon,
  Trash2Icon,
  UserIcon,
  XIcon,
} from "lucide-react";
import { localizedPath, type Locale } from "@/lib/i18n";
import type { McpKey } from "@/lib/mcp-keys";
import {
  applyPurpose,
  clearScopes,
  defaultMcpKeySelection,
  selectScopes,
  toggleScope,
  toggleTool,
  validateMcpKeySelection,
  type McpKeyPurpose,
  type McpKeySelection,
  type McpKeySelectionError,
} from "@/lib/mcp-key-selection";
import { cn } from "@/lib/utils";
import { McpScopePicker, type ScopeOption } from "@/components/admin/mcp-scope-picker";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type McpToolOption = {
  name: string;
  title: string;
  description: string;
  kind: "read" | "write";
};

const MCP_TOKEN_ENV_VAR = "ESPORTS_COMMUNITY_MCP_TOKEN";

function text(locale: Locale) {
  return locale === "ar"
    ? {
        create: "إنشاء مفتاح MCP",
        purpose: "الغرض من المفتاح",
        purposeResearch: "بحث وقراءة",
        purposeNews: "صياغة الأخبار",
        purposeStream: "إدارة البث",
        purposeCustom: "مخصص",
        purposeResearchHint: "قراءة فقط بدون أدوات كتابة — الخيار الافتراضي الأقل صلاحية.",
        purposeNewsHint: "قراءة الأخبار مع إنشاء مسودات في النطاقات المحددة.",
        purposeStreamHint: "تحديث قنوات البث المشترك للألعاب المحددة.",
        purposeCustomHint: "اختيار يدوي كامل للأدوات.",
        label: "التسمية",
        labelPlaceholder: "مثال: مساعد التغطية",
        identity: "هوية المالك",
        identityDescription: "يصدر المفتاح لحسابك الإداري المسجل حاليا ولا يمكن تغييره.",
        expiresAt: "ينتهي في",
        expiryDate: "تاريخ الانتهاء",
        expiryTime: "وقت الانتهاء",
        expiryDescription: "المفاتيح المنتهية تلقائيا أكثر أمانا من المفاتيح الدائمة.",
        expiry30: "30 يوما",
        expiry90: "90 يوما",
        noExpiry: "بلا انتهاء",
        clearExpiry: "مسح الانتهاء",
        pickDate: "اختر تاريخا",
        tools: "الأدوات الممنوحة",
        toolsDescription: "تمنح هذه الأدوات صراحة لهذا المفتاح. أدوات الكتابة معلمة بوضوح.",
        alwaysOn: "متاحة دائما",
        alwaysOnDescription: "قراءات عامة تعمل مع كل مفتاح إداري صالح ولا تحتاج إلى منح.",
        readBadge: "قراءة",
        writeBadge: "كتابة",
        games: "نطاق الألعاب",
        media: "نطاق قنوات الإعلام",
        gameScopeDescription: "حدد الألعاب التي يمكن لهذا المفتاح استخدامها.",
        mediaScopeDescription: "حدد المنصات الإعلامية التي يمكن لهذا المفتاح استخدامها.",
        scopesNote: "تحديد الألعاب أو القنوات يضيّق صلاحياتك الحالية فقط — لا يمكن للمفتاح تجاوز صلاحيات حسابك.",
        scopePlaceholder: "لم يحدد أي نطاق",
        scopeSearch: "ابحث…",
        scopeEmpty: "لا نتائج مطابقة.",
        scopeSelectVisible: "تحديد الظاهر",
        scopeClear: "مسح",
        scopeCount: (n: number) => `${n} محدد`,
        scopeRemove: (label: string) => `إزالة ${label}`,
        summary: "ملخص الصلاحيات",
        summaryTools: (n: number) => `${n} أدوات`,
        summaryGames: (n: number) => `${n} ألعاب`,
        summaryMedia: (n: number) => `${n} قنوات`,
        summaryNoExpiry: "بلا انتهاء",
        createAction: "إنشاء المفتاح",
        validationNoTools: "اختر أداة واحدة على الأقل.",
        validationNewsScope: "صياغة الأخبار تتطلب تحديد لعبة أو قناة إعلامية واحدة على الأقل.",
        validationStreamScope: "إدارة البث تتطلب تحديد لعبة واحدة على الأقل.",
        validationExpiryPast: "اختر وقت انتهاء في المستقبل.",
        secretTitle: "انسخ المفتاح الآن — لن يظهر مرة أخرى",
        secretDescription: "يحفظ الموقع بصمة المفتاح فقط. عند إغلاق هذه اللوحة يختفي النص الكامل نهائيا.",
        secretCopyKey: "نسخ المفتاح",
        secretCopyEndpoint: "نسخ رابط الخادم",
        secretDocs: "دليل الإعداد",
        secretSetupHint: `ضع المفتاح في متغير البيئة ${MCP_TOKEN_ENV_VAR} ثم استخدم أحد الإعدادين:`,
        secretDone: "حفظت المفتاح",
        copied: "تم النسخ",
        failed: "فشل الإجراء",
        activeKeys: "كل المفاتيح",
        ownKeys: "مفاتيحك",
        noKeysTitle: "لا توجد مفاتيح بعد",
        noKeysDescription: "أنشئ مفتاحا أعلاه لربط مساعد ذكاء اصطناعي بلوحة التحكم.",
        active: "نشط",
        expired: "منتهي",
        revoked: "ملغي",
        revoke: "إلغاء المفتاح",
        revokeConfirm: "إلغاء هذا المفتاح؟ سيتوقف فورا عن العمل.",
        cancel: "إلغاء",
        created: "أنشئ",
        lastUsed: "آخر استخدام",
        neverUsed: "لم يستخدم",
        expires: "ينتهي",
        details: "التفاصيل",
        keyPurposeRead: "قراءة فقط",
        keyPurposeNews: "صياغة الأخبار",
        keyPurposeStream: "إدارة البث",
        keyPurposeMixed: "قراءة وكتابة",
        allScopes: "بدون نطاق محدد",
        scopeNoticeSuper: "يمكنك إنشاء مفاتيح لحسابك ورؤية مفاتيح الجميع وإلغاؤها.",
        scopeNoticeScoped: "يمكنك إنشاء مفاتيح لحسابك فقط، ضمن نفس صلاحياتك في لوحة التحكم.",
      }
    : {
        create: "Create MCP key",
        purpose: "Key purpose",
        purposeResearch: "Research",
        purposeNews: "News drafting",
        purposeStream: "Stream management",
        purposeCustom: "Custom",
        purposeResearchHint: "Read-only, no write tools — the least-privilege default.",
        purposeNewsHint: "News reads plus draft creation in the selected scopes.",
        purposeStreamHint: "Update co-stream channels for the selected games.",
        purposeCustomHint: "Full manual tool selection.",
        label: "Label",
        labelPlaceholder: "e.g. Coverage assistant",
        identity: "Owner identity",
        identityDescription: "Keys are issued to your signed-in admin account and cannot be transferred.",
        expiresAt: "Expires",
        expiryDate: "Expiry date",
        expiryTime: "Expiry time",
        expiryDescription: "Keys that expire on their own are safer than permanent ones.",
        expiry30: "30 days",
        expiry90: "90 days",
        noExpiry: "No expiry",
        clearExpiry: "Clear expiry",
        pickDate: "Pick a date",
        tools: "Granted tools",
        toolsDescription: "These tools are explicitly granted to this key. Write tools are clearly marked.",
        alwaysOn: "Always available",
        alwaysOnDescription: "Public reads that work with every valid admin key — no grant needed.",
        readBadge: "Read",
        writeBadge: "Write",
        games: "Game scope",
        media: "Media scope",
        gameScopeDescription: "Choose the games this key may access.",
        mediaScopeDescription: "Choose the media channels this key may access.",
        scopesNote: "Selecting games or media only narrows your existing permissions — a key can never exceed your account.",
        scopePlaceholder: "No scope selected",
        scopeSearch: "Search…",
        scopeEmpty: "No matching results.",
        scopeSelectVisible: "Select visible",
        scopeClear: "Clear",
        scopeCount: (n: number) => `${n} selected`,
        scopeRemove: (label: string) => `Remove ${label}`,
        summary: "Permission summary",
        summaryTools: (n: number) => `${n} tools`,
        summaryGames: (n: number) => `${n} games`,
        summaryMedia: (n: number) => `${n} media`,
        summaryNoExpiry: "no expiry",
        createAction: "Create key",
        validationNoTools: "Select at least one tool.",
        validationNewsScope: "News drafting needs at least one game or media scope.",
        validationStreamScope: "Stream management needs at least one game scope.",
        validationExpiryPast: "Pick a future expiry time.",
        secretTitle: "Copy this key now — it will not be shown again",
        secretDescription: "Only a fingerprint is stored. Once you close this panel the full key is gone for good.",
        secretCopyKey: "Copy key",
        secretCopyEndpoint: "Copy endpoint URL",
        secretDocs: "Setup guide",
        secretSetupHint: `Put the key in the ${MCP_TOKEN_ENV_VAR} environment variable, then use either setup:`,
        secretDone: "I saved the key",
        copied: "Copied",
        failed: "Action failed",
        activeKeys: "All keys",
        ownKeys: "Your keys",
        noKeysTitle: "No keys yet",
        noKeysDescription: "Create a key above to connect an AI assistant to the dashboard.",
        active: "Active",
        expired: "Expired",
        revoked: "Revoked",
        revoke: "Revoke key",
        revokeConfirm: "Revoke this MCP key? It stops working immediately.",
        cancel: "Cancel",
        created: "Created",
        lastUsed: "Last used",
        neverUsed: "Never used",
        expires: "Expires",
        details: "Details",
        keyPurposeRead: "Read-only",
        keyPurposeNews: "News drafting",
        keyPurposeStream: "Stream management",
        keyPurposeMixed: "Read + write",
        allScopes: "No scope selected",
        scopeNoticeSuper: "You can create keys for your own account and view or revoke everyone's keys.",
        scopeNoticeScoped: "You can create keys only for your own account, within your existing dashboard permissions.",
      };
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

// DB timestamps are 'YYYY-MM-DD HH:MM:SS' in UTC (see nowText in src/db).
function parseDbDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(`${value.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function keyStatus(key: McpKey, nowSec: number): "active" | "expired" | "revoked" {
  if (key.revokedAt) return "revoked";
  if (key.expiresAt != null && key.expiresAt <= nowSec) return "expired";
  return "active";
}

function keyPurposeLabel(key: McpKey, t: ReturnType<typeof text>) {
  const hasNews = key.tools.includes("create_news_draft");
  const hasStream = key.tools.includes("update_stream_channel");
  if (hasNews && hasStream) return t.keyPurposeMixed;
  if (hasNews) return t.keyPurposeNews;
  if (hasStream) return t.keyPurposeStream;
  return t.keyPurposeRead;
}

function realScopes(values: string[]) {
  return values.filter((value) => !value.startsWith("__ec_"));
}

export function McpKeyManager({
  keys,
  selectableTools,
  alwaysOnTools,
  games,
  media,
  locale,
  isSuper,
  defaultOwnerDiscordId,
  defaultOwnerName,
}: {
  keys: McpKey[];
  selectableTools: McpToolOption[];
  alwaysOnTools: McpToolOption[];
  games: ScopeOption[];
  media: ScopeOption[];
  locale: Locale;
  isSuper: boolean;
  defaultOwnerDiscordId: string;
  defaultOwnerName: string;
}) {
  const router = useRouter();
  const t = text(locale);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState<"key" | "endpoint" | null>(null);
  const [removeTarget, setRemoveTarget] = useState<McpKey | null>(null);
  const [expandedKeyId, setExpandedKeyId] = useState<number | null>(null);
  const [label, setLabel] = useState("");
  const [expiresOn, setExpiresOn] = useState<Date | undefined>();
  const [expiresTime, setExpiresTime] = useState("23:59");
  const [selection, setSelection] = useState<McpKeySelection>(defaultMcpKeySelection);

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "ar" ? "ar-SA-u-ca-gregory" : "en-US", {
        dateStyle: "medium",
        timeZone: "Asia/Riyadh",
      }),
    [locale],
  );
  const dateTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "ar" ? "ar-SA-u-ca-gregory" : "en-US", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Riyadh",
      }),
    [locale],
  );
  // Mount-time clock: render-side status/expiry checks may be minutes stale,
  // which is fine — createKey re-validates and the server enforces expiry.
  const [nowSec] = useState(() => Math.floor(Date.now() / 1000));
  const today = useMemo(() => {
    const day = new Date(nowSec * 1000);
    day.setHours(0, 0, 0, 0);
    return day;
  }, [nowSec]);

  const expiresAt = getExpirySeconds(expiresOn, expiresTime);
  const validation = validateMcpKeySelection(selection, { expiresAt, nowSec });
  const validationMessage: Record<McpKeySelectionError, string> = {
    "no-tools": t.validationNoTools,
    "news-needs-scope": t.validationNewsScope,
    "stream-needs-game": t.validationStreamScope,
    "expiry-past": t.validationExpiryPast,
  };

  function setExpiryPreset(days: number) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    setExpiresOn(date);
    setExpiresTime("23:59");
  }

  async function createKey() {
    if (!validation.ok) return;
    setBusy(true);
    setError(null);
    setSecret(null);
    try {
      const res = await fetch("/api/admin/mcp-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label,
          expiresAt,
          tools: selection.tools,
          games: selection.games,
          media: selection.media,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t.failed);
      setSecret(data.secret);
      // Reset to least privilege, never back to maximum access.
      setLabel("");
      setExpiresOn(undefined);
      setExpiresTime("23:59");
      setSelection(defaultMcpKeySelection());
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

  async function copyText(value: string, which: "key" | "endpoint") {
    await navigator.clipboard.writeText(value);
    setCopied(which);
    window.setTimeout(() => setCopied(null), 1500);
  }

  const endpointUrl =
    typeof window !== "undefined" ? `${window.location.origin}/api/mcp` : "/api/mcp";
  const codexSnippet = [
    "[mcp_servers.esports_community]",
    "enabled = true",
    `url = "${endpointUrl}"`,
    `bearer_token_env_var = "${MCP_TOKEN_ENV_VAR}"`,
  ].join("\n");
  const claudeSnippet = JSON.stringify(
    {
      mcpServers: {
        "esports-community": {
          type: "http",
          url: endpointUrl,
          headers: { Authorization: `Bearer \${${MCP_TOKEN_ENV_VAR}}` },
        },
      },
    },
    null,
    2,
  );

  const purposes: { value: McpKeyPurpose; label: string; hint: string }[] = [
    { value: "research", label: t.purposeResearch, hint: t.purposeResearchHint },
    { value: "news", label: t.purposeNews, hint: t.purposeNewsHint },
    { value: "stream", label: t.purposeStream, hint: t.purposeStreamHint },
    { value: "custom", label: t.purposeCustom, hint: t.purposeCustomHint },
  ];
  const activePurpose = purposes.find((purpose) => purpose.value === selection.purpose);

  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t.failed}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {secret ? (
        <Alert className="border-primary/40">
          <KeyRoundIcon className="size-4" />
          <AlertTitle>{t.secretTitle}</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <span>{t.secretDescription}</span>
            <code
              className="min-w-0 overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs"
              dir="ltr"
            >
              {secret}
            </code>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={() => copyText(secret, "key")}>
                {copied === "key" ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
                {copied === "key" ? t.copied : t.secretCopyKey}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => copyText(endpointUrl, "endpoint")}
              >
                {copied === "endpoint" ? <CheckIcon data-icon="inline-start" /> : <LinkIcon data-icon="inline-start" />}
                {copied === "endpoint" ? t.copied : t.secretCopyEndpoint}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                render={
                  <a
                    href={localizedPath("/docs/admin-mcp", locale)}
                    target="_blank"
                    rel="noreferrer"
                  />
                }
                nativeButton={false}
              >
                <BookOpenIcon data-icon="inline-start" />
                {t.secretDocs}
              </Button>
            </div>
            <span className="text-xs text-muted-foreground">{t.secretSetupHint}</span>
            <div className="grid gap-2 lg:grid-cols-2">
              <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 text-[11px] leading-relaxed" dir="ltr">
                <span className="text-muted-foreground"># Codex (~/.codex/config.toml)</span>
                {"\n"}
                {codexSnippet}
              </pre>
              <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 text-[11px] leading-relaxed" dir="ltr">
                <span className="text-muted-foreground">{"// Claude Code (.mcp.json)"}</span>
                {"\n"}
                {claudeSnippet}
              </pre>
            </div>
            <Button type="button" size="sm" variant="secondary" className="w-fit" onClick={() => setSecret(null)}>
              <CheckIcon data-icon="inline-start" />
              {t.secretDone}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t.create}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <p className="text-sm text-muted-foreground">
            {isSuper ? t.scopeNoticeSuper : t.scopeNoticeScoped}
          </p>

          <Field>
            <FieldLabel htmlFor="mcp-purpose">{t.purpose}</FieldLabel>
            <ToggleGroup
              id="mcp-purpose"
              value={[selection.purpose]}
              onValueChange={(value: unknown[]) => {
                const next = value[0] as McpKeyPurpose | undefined;
                if (next) setSelection((prev) => applyPurpose(prev, next));
              }}
              variant="outline"
              className="flex-wrap"
            >
              {purposes.map((purpose) => (
                <ToggleGroupItem key={purpose.value} value={purpose.value} aria-label={purpose.label}>
                  {purpose.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {activePurpose ? <FieldDescription>{activePurpose.hint}</FieldDescription> : null}
          </Field>

          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="mcp-label">{t.label}</FieldLabel>
              <Input
                id="mcp-label"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder={t.labelPlaceholder}
              />
            </Field>
            <FieldSet>
              <FieldLegend variant="label">{t.expiresAt}</FieldLegend>
              <div className="flex flex-wrap items-end gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => setExpiryPreset(30)}>
                  {t.expiry30}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setExpiryPreset(90)}>
                  {t.expiry90}
                </Button>
                <Field className="w-auto">
                  <FieldLabel htmlFor="mcp-expiry-date" className="text-xs">
                    {t.expiryDate}
                  </FieldLabel>
                  <Popover>
                    <PopoverTrigger
                      render={
                        <Button
                          id="mcp-expiry-date"
                          type="button"
                          size="sm"
                          variant="outline"
                          className={cn("justify-start", !expiresOn && "text-muted-foreground")}
                        />
                      }
                    >
                      <CalendarIcon data-icon="inline-start" />
                      {expiresOn ? dateFormatter.format(expiresOn) : t.pickDate}
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
                </Field>
                <Field className="w-auto" data-disabled={!expiresOn}>
                  <FieldLabel htmlFor="mcp-expiry-time" className="text-xs">
                    {t.expiryTime}
                  </FieldLabel>
                  <Input
                    id="mcp-expiry-time"
                    type="time"
                    value={expiresTime}
                    onChange={(event) => setExpiresTime(event.target.value)}
                    disabled={!expiresOn}
                    className="w-28"
                    dir="ltr"
                  />
                </Field>
                {expiresOn ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setExpiresOn(undefined)}
                    aria-label={t.clearExpiry}
                    title={t.clearExpiry}
                  >
                    <XIcon />
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">{t.noExpiry}</span>
                )}
              </div>
              <FieldDescription>{t.expiryDescription}</FieldDescription>
            </FieldSet>
          </div>

          <div className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
              <UserIcon className="size-4 text-muted-foreground" />
            </span>
            <div className="min-w-0 text-sm">
              <p className="truncate font-medium">{defaultOwnerName || defaultOwnerDiscordId}</p>
              <p className="font-mono text-xs text-muted-foreground" dir="ltr">
                {defaultOwnerDiscordId}
              </p>
            </div>
            <p className="ms-auto hidden max-w-56 text-end text-xs text-muted-foreground sm:block">
              {t.identityDescription}
            </p>
          </div>

          <FieldSet>
            <FieldLegend>{t.tools}</FieldLegend>
            <FieldDescription>{t.toolsDescription}</FieldDescription>
            <div className="mt-2 flex flex-col gap-1">
              {selectableTools.map((tool) => {
                const checked = selection.tools.includes(tool.name);
                const inputId = `mcp-tool-${tool.name}`;
                const descriptionId = `${inputId}-description`;
                return (
                  <label
                    key={tool.name}
                    htmlFor={inputId}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                      checked ? "border-primary/50 bg-primary/5" : "border-border hover:bg-muted/50",
                    )}
                  >
                    <Checkbox
                      id={inputId}
                      aria-describedby={descriptionId}
                      checked={checked}
                      onCheckedChange={() => setSelection((prev) => toggleTool(prev, tool.name))}
                      className="mt-0.5"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{tool.title}</span>
                        <Badge variant={tool.kind === "write" ? "destructive" : "secondary"} className="text-[10px]">
                          {tool.kind === "write" ? t.writeBadge : t.readBadge}
                        </Badge>
                        <code className="font-mono text-[11px] text-muted-foreground" dir="ltr">
                          {tool.name}
                        </code>
                      </span>
                      <span id={descriptionId} className="mt-0.5 block text-xs text-muted-foreground">
                        {tool.description}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </FieldSet>

          <div className="rounded-lg border border-dashed border-border px-3 py-2.5">
            <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <LockIcon className="size-3.5" />
              {t.alwaysOn}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{t.alwaysOnDescription}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {alwaysOnTools.map((tool) => (
                <Tooltip key={tool.name}>
                  <TooltipTrigger
                    render={<Badge variant="outline" className="font-mono text-[10px] text-muted-foreground" />}
                  >
                    <span dir="ltr">{tool.name}</span>
                  </TooltipTrigger>
                  <TooltipContent>{tool.title}</TooltipContent>
                </Tooltip>
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <McpScopePicker
              label={t.games}
              description={t.gameScopeDescription}
              options={games}
              selected={selection.games}
              onToggle={(slug) => setSelection((prev) => toggleScope(prev, "games", slug))}
              onSelectVisible={(slugs) => setSelection((prev) => selectScopes(prev, "games", slugs))}
              onClear={() => setSelection((prev) => clearScopes(prev, "games"))}
              placeholder={t.scopePlaceholder}
              searchPlaceholder={t.scopeSearch}
              emptyLabel={t.scopeEmpty}
              selectVisibleLabel={t.scopeSelectVisible}
              clearLabel={t.scopeClear}
              selectedCountLabel={t.scopeCount}
              removeLabel={t.scopeRemove}
            />
            <McpScopePicker
              label={t.media}
              description={t.mediaScopeDescription}
              options={media}
              selected={selection.media}
              onToggle={(slug) => setSelection((prev) => toggleScope(prev, "media", slug))}
              onSelectVisible={(slugs) => setSelection((prev) => selectScopes(prev, "media", slugs))}
              onClear={() => setSelection((prev) => clearScopes(prev, "media"))}
              placeholder={t.scopePlaceholder}
              searchPlaceholder={t.scopeSearch}
              emptyLabel={t.scopeEmpty}
              selectVisibleLabel={t.scopeSelectVisible}
              clearLabel={t.scopeClear}
              selectedCountLabel={t.scopeCount}
              removeLabel={t.scopeRemove}
            />
          </div>
          <p className="text-xs text-muted-foreground">{t.scopesNote}</p>

          <div className="flex flex-col gap-2 border-t border-border pt-4">
            <p className="text-xs font-medium text-muted-foreground">{t.summary}</p>
            <div className="flex flex-wrap items-center gap-1.5 text-sm">
              <Badge variant="secondary">{activePurpose?.label}</Badge>
              <Badge variant="outline">{t.summaryTools(selection.tools.length)}</Badge>
              <Badge variant="outline">{t.summaryGames(selection.games.length)}</Badge>
              <Badge variant="outline">{t.summaryMedia(selection.media.length)}</Badge>
              <Badge variant="outline">
                {expiresAt ? dateTimeFormatter.format(new Date(expiresAt * 1000)) : t.summaryNoExpiry}
              </Badge>
            </div>
            {!validation.ok ? <FieldError>{validationMessage[validation.error]}</FieldError> : null}
            <Button
              onClick={createKey}
              disabled={busy || !validation.ok}
              className="mt-1 w-fit"
            >
              <KeyRoundIcon data-icon="inline-start" />
              {t.createAction}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{isSuper ? t.activeKeys : t.ownKeys}</h2>
        {keys.length === 0 ? (
          <Empty className="border border-dashed border-border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <KeyRoundIcon />
              </EmptyMedia>
              <EmptyTitle>{t.noKeysTitle}</EmptyTitle>
              <EmptyDescription>{t.noKeysDescription}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          keys.map((key) => {
            const status = keyStatus(key, nowSec);
            const createdAt = parseDbDate(key.createdAt);
            const lastUsedAt = parseDbDate(key.lastUsedAt);
            const keyGames = realScopes(key.games);
            const keyMedia = realScopes(key.media);
            const expanded = expandedKeyId === key.id;
            return (
              <Card key={key.id} size="sm">
                <CardHeader className="flex-row items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="break-words text-base">
                      {key.label || key.keyPrefix}
                    </CardTitle>
                    <CardDescription className="mt-1 font-mono text-xs" dir="ltr">
                      {key.keyPrefix}…
                    </CardDescription>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Badge
                      variant={
                        status === "active" ? "default" : status === "expired" ? "outline" : "secondary"
                      }
                    >
                      {status === "active" ? t.active : status === "expired" ? t.expired : t.revoked}
                    </Badge>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-destructive"
                            disabled={busy || Boolean(key.revokedAt)}
                            onClick={() => setRemoveTarget(key)}
                            aria-label={t.revoke}
                          />
                        }
                      >
                        <Trash2Icon />
                      </TooltipTrigger>
                      <TooltipContent>{t.revoke}</TooltipContent>
                    </Tooltip>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline">{keyPurposeLabel(key, t)}</Badge>
                    <Badge variant="outline">{t.summaryTools(key.tools.length)}</Badge>
                    <Badge variant="outline">{t.summaryGames(keyGames.length)}</Badge>
                    <Badge variant="outline">{t.summaryMedia(keyMedia.length)}</Badge>
                  </div>
                  <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                    <span>{key.ownerName || key.ownerDiscordId}</span>
                    {isSuper && key.ownerName ? (
                      <span className="font-mono" dir="ltr">{key.ownerDiscordId}</span>
                    ) : null}
                    <span>
                    {createdAt ? ` · ${t.created} ${dateFormatter.format(createdAt)}` : ""}
                    {` · ${t.lastUsed} ${lastUsedAt ? dateTimeFormatter.format(lastUsedAt) : t.neverUsed}`}
                    {key.expiresAt != null
                      ? ` · ${t.expires} ${dateTimeFormatter.format(new Date(key.expiresAt * 1000))}`
                      : ""}
                    </span>
                  </div>
                  <div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="-ms-2 h-7 text-xs text-muted-foreground"
                      onClick={() => setExpandedKeyId(expanded ? null : key.id)}
                      aria-expanded={expanded}
                    >
                      <ChevronDownIcon
                        data-icon="inline-start"
                        className={cn("transition-transform", expanded && "rotate-180")}
                      />
                      {t.details}
                    </Button>
                    {expanded ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {key.tools.map((tool) => (
                          <Badge key={tool} variant="outline" className="font-mono text-[10px]" dir="ltr">
                            {tool}
                          </Badge>
                        ))}
                        {keyGames.map((game) => (
                          <Badge key={`g-${game}`} variant="secondary">{game}</Badge>
                        ))}
                        {keyMedia.map((channel) => (
                          <Badge key={`m-${channel}`} variant="secondary">{channel}</Badge>
                        ))}
                        {keyGames.length === 0 && keyMedia.length === 0 ? (
                          <span className="text-xs text-muted-foreground">{t.allScopes}</span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        title={t.revokeConfirm}
        cancelLabel={t.cancel}
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
