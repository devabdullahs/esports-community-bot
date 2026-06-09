"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BoldIcon,
  CodeIcon,
  EyeIcon,
  EyeOffIcon,
  Heading2Icon,
  ImageIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  ListTodoIcon,
  Loader2Icon,
  PencilIcon,
  QuoteIcon,
  SaveIcon,
  SendIcon,
  SmilePlusIcon,
  SquareCodeIcon,
  StrikethroughIcon,
  TableIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import {
  getMarkdownActiveState,
  imageTransform,
  insertCodeBlock,
  insertLink,
  insertTable,
  insertText,
  toggleLinePrefix,
  toggleWrap,
} from "@bot/lib/markdownTools.js";
import { communityGames, localizeText } from "@/lib/community-content";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { NewsContentMode, NewsPost, NewsStatus } from "@/lib/news";
import {
  NEWS_BODY_MAX_LENGTH,
  NEWS_SUMMARY_MAX_LENGTH,
  NEWS_TITLE_MAX_LENGTH,
} from "@/lib/news-validation";
import { PostBody } from "@/components/news/post-body";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type TranslationDraft = {
  title: string;
  summary: string;
  body: string;
};

type TranslationMap = Record<Locale, TranslationDraft>;
type SelectionState = { start: number; end: number };
type Transform = (
  value: string,
  start: number,
  end: number,
) => { text: string; selStart: number; selEnd: number };

const EMPTY_TRANSLATION: TranslationDraft = { title: "", summary: "", body: "" };
const ARABIC_LABEL = "\u0627\u0644\u0639\u0631\u0628\u064a\u0629";
const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  ar: ARABIC_LABEL,
};

const EMOJIS = [
  "\u{1F525}",
  "\u{1F3C6}",
  "\u2B50",
  "\u{1F3AE}",
  "\u{1F3AF}",
  "\u{1F4AA}",
  "\u{1F60E}",
  "\u{1F91D}",
  "\u{1F602}",
  "\u{1F605}",
  "\u{1F44F}",
  "\u{1F64C}",
  "\u{1F44D}",
  "\u{1F44E}",
  "\u2705",
  "\u274C",
  "\u26A1",
  "\u{1F4A5}",
  "\u{1F680}",
  "\u{1F389}",
  "\u2764\uFE0F",
  "\u{1F947}",
  "\u{1F4E2}",
  "\u{1F440}",
];

const INLINE_TOOL_DEFS = [
  { value: "bold", icon: BoldIcon, label: "Bold" },
  { value: "italic", icon: ItalicIcon, label: "Italic" },
  { value: "strike", icon: StrikethroughIcon, label: "Strikethrough" },
  { value: "code", icon: CodeIcon, label: "Inline code" },
  { value: "heading", icon: Heading2Icon, label: "Heading" },
  { value: "bulletList", icon: ListIcon, label: "Bullet list" },
  { value: "numberedList", icon: ListOrderedIcon, label: "Numbered list" },
  { value: "taskList", icon: ListTodoIcon, label: "Task list" },
  { value: "quote", icon: QuoteIcon, label: "Quote" },
] as const;

const INSERT_TOOL_DEFS = [
  { value: "link", icon: LinkIcon, label: "Link" },
  { value: "table", icon: TableIcon, label: "Table" },
  { value: "codeBlock", icon: SquareCodeIcon, label: "Code block" },
  { value: "imageUrl", icon: ImageIcon, label: "Insert image by URL" },
] as const;

type InlineToolValue = (typeof INLINE_TOOL_DEFS)[number]["value"];
type InsertToolValue = (typeof INSERT_TOOL_DEFS)[number]["value"];

function emptyTranslations(): TranslationMap {
  return {
    en: { ...EMPTY_TRANSLATION },
    ar: { ...EMPTY_TRANSLATION },
  };
}

function initialTranslations(post?: NewsPost): TranslationMap {
  const values = emptyTranslations();
  for (const locale of ["en", "ar"] as const) {
    const translation = post?.translations?.[locale];
    if (translation) {
      values[locale] = {
        title: translation.title,
        summary: translation.summary,
        body: translation.body,
      };
    }
  }
  if (post && !post.translations?.[post.defaultLocale]) {
    values[post.defaultLocale] = {
      title: post.title || "",
      summary: post.summary || "",
      body: post.body || "",
    };
  }
  return values;
}

function hasContent(value: TranslationDraft) {
  return Boolean(value.title.trim() || value.summary.trim() || value.body.trim());
}

function overLimit(value: TranslationDraft) {
  return (
    value.title.length > NEWS_TITLE_MAX_LENGTH ||
    value.summary.length > NEWS_SUMMARY_MAX_LENGTH ||
    value.body.length > NEWS_BODY_MAX_LENGTH
  );
}

function counterText(value: number, max: number) {
  return `${value.toLocaleString("en-US")}/${max.toLocaleString("en-US")}`;
}

export function NewsEditor({
  mode,
  post,
}: {
  mode: "create" | "edit";
  post?: NewsPost;
}) {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetRef = useRef<"body" | "cover">("body");

  const initialDefaultLocale = post?.defaultLocale || post?.locale || "en";
  const [gameSlug, setGameSlug] = useState(post?.gameSlug || communityGames[0]?.slug || "");
  const [contentMode, setContentMode] = useState<NewsContentMode>(post?.contentMode || "shared");
  const [defaultLocale, setDefaultLocale] = useState<Locale>(initialDefaultLocale);
  const [activeLocale, setActiveLocale] = useState<Locale>(initialDefaultLocale);
  const [translations, setTranslations] = useState<TranslationMap>(() => initialTranslations(post));
  const [coverImageUrl, setCoverImageUrl] = useState(post?.coverImageUrl || "");
  const [status, setStatus] = useState<NewsStatus>(post?.status || "draft");
  const [mobileView, setMobileView] = useState<"edit" | "preview">("edit");
  const [busy, setBusy] = useState<null | string>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [selection, setSelection] = useState<SelectionState>({ start: 0, end: 0 });

  const editLocale = contentMode === "shared" ? defaultLocale : activeLocale;
  const current = translations[editLocale];
  const game = communityGames.find((g) => g.slug === gameSlug);
  const activeMarks = useMemo(
    () => getMarkdownActiveState(current.body, selection.start, selection.end),
    [current.body, selection.end, selection.start],
  );
  const activeToolValues = Object.entries(activeMarks)
    .filter(([, value]) => value)
    .map(([key]) => key);

  function updateTranslation(locale: Locale, patch: Partial<TranslationDraft>) {
    setTranslations((prev) => ({
      ...prev,
      [locale]: { ...prev[locale], ...patch },
    }));
  }

  function rememberSelection() {
    const textarea = textareaRef.current;
    if (!textarea) return;
    setSelection({ start: textarea.selectionStart, end: textarea.selectionEnd });
  }

  function apply(transform: Transform) {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? selection.start;
    const end = textarea?.selectionEnd ?? selection.end;
    const result = transform(current.body, start, end);
    updateTranslation(editLocale, { body: result.text });
    setSelection({ start: result.selStart, end: result.selEnd });
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(result.selStart, result.selEnd);
    });
  }

  function switchContentMode(nextMode: NewsContentMode) {
    setContentMode(nextMode);
    if (nextMode === "shared") {
      const locale = activeLocale || defaultLocale;
      setDefaultLocale(locale);
      setActiveLocale(locale);
      setTranslations((prev) => ({
        ...prev,
        [locale]: hasContent(prev[locale]) ? prev[locale] : prev[defaultLocale],
      }));
    } else {
      setTranslations((prev) => ({
        en: { ...prev.en },
        ar: { ...prev.ar },
      }));
    }
  }

  function switchSharedLocale(locale: Locale) {
    setTranslations((prev) => ({
      ...prev,
      [locale]: hasContent(prev[locale]) ? prev[locale] : prev[defaultLocale],
    }));
    setDefaultLocale(locale);
    setActiveLocale(locale);
  }

  function pickImage(target: "body" | "cover") {
    uploadTargetRef.current = target;
    fileInputRef.current?.click();
  }

  async function handleUpload(file: File) {
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
      if (uploadTargetRef.current === "cover") setCoverImageUrl(json.url);
      else apply(imageTransform(json.url, false));
    } finally {
      setUploading(false);
    }
  }

  function runInlineTool(value: InlineToolValue) {
    if (value === "bold") apply((v, s, e) => toggleWrap(v, s, e, "**"));
    else if (value === "italic") apply((v, s, e) => toggleWrap(v, s, e, "*"));
    else if (value === "strike") apply((v, s, e) => toggleWrap(v, s, e, "~~"));
    else if (value === "code") apply((v, s, e) => toggleWrap(v, s, e, "`"));
    else if (value === "heading") apply((v, s, e) => toggleLinePrefix(v, s, e, { prefix: "## " }));
    else if (value === "bulletList") apply((v, s, e) => toggleLinePrefix(v, s, e, { prefix: "- " }));
    else if (value === "numberedList") apply((v, s, e) => toggleLinePrefix(v, s, e, { numbered: true }));
    else if (value === "taskList") apply((v, s, e) => toggleLinePrefix(v, s, e, { prefix: "- [ ] " }));
    else if (value === "quote") apply((v, s, e) => toggleLinePrefix(v, s, e, { prefix: "> " }));
  }

  function runInsertTool(value: InsertToolValue) {
    if (value === "link") apply(insertLink);
    else if (value === "table") apply(insertTable);
    else if (value === "codeBlock") apply(insertCodeBlock);
    else if (value === "imageUrl") apply(imageTransform("https://", true));
  }

  const translationsToPersist =
    contentMode === "shared"
      ? { [defaultLocale]: translations[defaultLocale] }
      : translations;
  const valuesToValidate =
    contentMode === "shared"
      ? [translations[defaultLocale]]
      : [translations.en, translations.ar];
  const hasLimitError = valuesToValidate.some(overLimit);
  const publishError =
    contentMode === "shared"
      ? !translations[defaultLocale].title.trim() || !translations[defaultLocale].body.trim()
      : !translations.en.title.trim() ||
        !translations.en.body.trim() ||
        !translations.ar.title.trim() ||
        !translations.ar.body.trim();
  const canSave = Boolean(gameSlug && !hasLimitError);
  const canPublish = canSave && !publishError;

  async function persist(targetStatus: NewsStatus, action: string) {
    setError(null);
    if (targetStatus === "published" && !canPublish) {
      setError(
        contentMode === "translated"
          ? "English and Arabic headlines and bodies are required before publishing."
          : "Headline and body are required before publishing.",
      );
      return;
    }
    setBusy(action);
    try {
      const payload = {
        gameSlug,
        contentMode,
        defaultLocale,
        translations: translationsToPersist,
        coverImageUrl: coverImageUrl.trim() || null,
        status: targetStatus,
      };
      const res = await fetch(
        mode === "create" ? "/api/admin/news" : `/api/admin/news/${post?.id}`,
        {
          method: mode === "create" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Save failed");
      setStatus(targetStatus);
      router.push("/admin");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (mode !== "edit" || !post) return;
    if (!window.confirm("Delete this post? This cannot be undone.")) return;
    setError(null);
    setBusy("delete");
    try {
      const res = await fetch(`/api/admin/news/${post.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Delete failed");
      router.push("/admin");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void handleUpload(file);
        }}
      />
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not save</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex gap-2 lg:hidden">
        <Button
          variant={mobileView === "edit" ? "default" : "outline"}
          size="sm"
          onClick={() => setMobileView("edit")}
        >
          <PencilIcon data-icon="inline-start" />
          Edit
        </Button>
        <Button
          variant={mobileView === "preview" ? "default" : "outline"}
          size="sm"
          onClick={() => setMobileView("preview")}
        >
          <EyeIcon data-icon="inline-start" />
          Preview
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <Card className={mobileView === "preview" ? "hidden lg:flex" : undefined}>
          <CardHeader>
            <CardTitle>{mode === "create" ? "New post" : "Edit post"}</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel>Game</FieldLabel>
                  <Select value={gameSlug} onValueChange={(value) => value && setGameSlug(value)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {communityGames.map((item) => (
                          <SelectItem key={item.slug} value={item.slug}>
                            {localizeText(item.title, "en")}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel>Content language mode</FieldLabel>
                  <ToggleGroup
                    value={[contentMode]}
                    onValueChange={(value) => {
                      const next = value.at(-1);
                      if (next === "shared" || next === "translated") switchContentMode(next);
                    }}
                    spacing={1}
                    variant="outline"
                    className="w-full"
                  >
                    <ToggleGroupItem value="shared" className="flex-1">
                      Shared
                    </ToggleGroupItem>
                    <ToggleGroupItem value="translated" className="flex-1">
                      Separate
                    </ToggleGroupItem>
                  </ToggleGroup>
                  <FieldDescription>
                    Shared posts show the same text in both site languages.
                  </FieldDescription>
                </Field>
              </div>

              {contentMode === "shared" ? (
                <Field>
                  <FieldLabel>Writing language</FieldLabel>
                  <Select
                    value={defaultLocale}
                    onValueChange={(value) => {
                      if (value === "en" || value === "ar") switchSharedLocale(value);
                    }}
                  >
                    <SelectTrigger className="w-full sm:w-64">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="en">English</SelectItem>
                        <SelectItem value="ar">{ARABIC_LABEL}</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              ) : (
                <Tabs value={activeLocale} onValueChange={(value) => setActiveLocale(value as Locale)}>
                  <TabsList>
                    <TabsTrigger value="en">English</TabsTrigger>
                    <TabsTrigger value="ar">{ARABIC_LABEL}</TabsTrigger>
                  </TabsList>
                  <TabsContent value="en" />
                  <TabsContent value="ar" />
                </Tabs>
              )}

              <Field data-invalid={current.title.length > NEWS_TITLE_MAX_LENGTH}>
                <div className="flex items-center justify-between gap-3">
                  <FieldLabel htmlFor="news-title">Headline</FieldLabel>
                  <span className="text-xs text-muted-foreground">
                    {counterText(current.title.length, NEWS_TITLE_MAX_LENGTH)}
                  </span>
                </div>
                <Input
                  id="news-title"
                  value={current.title}
                  maxLength={NEWS_TITLE_MAX_LENGTH}
                  aria-invalid={current.title.length > NEWS_TITLE_MAX_LENGTH}
                  dir={editLocale === "ar" ? "rtl" : "ltr"}
                  onChange={(event) => updateTranslation(editLocale, { title: event.target.value })}
                  placeholder="Short headline for the community"
                />
                <FieldDescription>
                  Keep it short enough to fit public post cards.
                </FieldDescription>
              </Field>

              <Field data-invalid={current.summary.length > NEWS_SUMMARY_MAX_LENGTH}>
                <div className="flex items-center justify-between gap-3">
                  <FieldLabel htmlFor="news-summary">Summary</FieldLabel>
                  <span className="text-xs text-muted-foreground">
                    {counterText(current.summary.length, NEWS_SUMMARY_MAX_LENGTH)}
                  </span>
                </div>
                <Textarea
                  id="news-summary"
                  value={current.summary}
                  maxLength={NEWS_SUMMARY_MAX_LENGTH}
                  aria-invalid={current.summary.length > NEWS_SUMMARY_MAX_LENGTH}
                  dir={editLocale === "ar" ? "rtl" : "ltr"}
                  onChange={(event) => updateTranslation(editLocale, { summary: event.target.value })}
                  placeholder="One or two lines shown on the game page card"
                />
                <FieldDescription>
                  Summaries are shown in latest-post cards and are clamped on public pages.
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel htmlFor="news-cover">Cover image (optional)</FieldLabel>
                <div className="flex gap-2">
                  <Input
                    id="news-cover"
                    value={coverImageUrl}
                    onChange={(event) => setCoverImageUrl(event.target.value)}
                    placeholder="https://assets.moonbot.info/..."
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={uploading}
                    onClick={() => pickImage("cover")}
                  >
                    {uploading ? (
                      <Loader2Icon data-icon="inline-start" className="animate-spin" />
                    ) : (
                      <UploadIcon data-icon="inline-start" />
                    )}
                    Upload
                  </Button>
                </div>
                <FieldDescription>Paste an http(s) image URL or upload a file.</FieldDescription>
              </Field>

              <Field data-invalid={current.body.length > NEWS_BODY_MAX_LENGTH}>
                <div className="flex items-center justify-between gap-3">
                  <FieldLabel htmlFor="news-body">Post body</FieldLabel>
                  <span className="text-xs text-muted-foreground">
                    {counterText(current.body.length, NEWS_BODY_MAX_LENGTH)}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1 rounded-md border border-border bg-muted/40 p-1">
                  <ToggleGroup
                    multiple
                    value={activeToolValues}
                    onValueChange={() => undefined}
                    spacing={0}
                    size="sm"
                    variant="default"
                    className="flex-wrap"
                  >
                    {INLINE_TOOL_DEFS.map((tool) => (
                      <ToggleGroupItem
                        key={tool.value}
                        value={tool.value}
                        title={tool.label}
                        aria-label={tool.label}
                        onClick={() => runInlineTool(tool.value)}
                      >
                        <tool.icon data-icon="inline-start" />
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                  <div className="flex flex-wrap gap-1">
                    {INSERT_TOOL_DEFS.map((tool) => (
                      <Button
                        key={tool.label}
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        title={tool.label}
                        aria-label={tool.label}
                        onClick={() => runInsertTool(tool.value)}
                      >
                        <tool.icon />
                      </Button>
                    ))}
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            title="Insert emoji"
                            aria-label="Insert emoji"
                          />
                        }
                      >
                        <SmilePlusIcon />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-64">
                        <DropdownMenuGroup className="grid grid-cols-6 gap-1">
                          {EMOJIS.map((emoji) => (
                            <DropdownMenuItem
                              key={emoji}
                              className="justify-center"
                              onClick={() => apply(insertText(emoji))}
                            >
                              {emoji}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      title="Upload image"
                      aria-label="Upload image"
                      disabled={uploading}
                      onClick={() => pickImage("body")}
                    >
                      {uploading ? <Loader2Icon className="animate-spin" /> : <UploadIcon />}
                    </Button>
                  </div>
                </div>
                <Textarea
                  id="news-body"
                  ref={textareaRef}
                  value={current.body}
                  maxLength={NEWS_BODY_MAX_LENGTH}
                  aria-invalid={current.body.length > NEWS_BODY_MAX_LENGTH}
                  dir={editLocale === "ar" ? "rtl" : "ltr"}
                  className="article-copy min-h-64 text-sm"
                  placeholder="Write the update. Use the toolbar for bold, italics, headings, lists, links, and images."
                  onChange={(event) => updateTranslation(editLocale, { body: event.target.value })}
                  onSelect={rememberSelection}
                  onKeyUp={rememberSelection}
                  onClick={rememberSelection}
                />
                <FieldDescription>
                  Markdown is supported. Images are inserted on their own line between paragraphs.
                </FieldDescription>
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>

        <Card className={mobileView === "edit" ? "hidden lg:flex" : undefined}>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <Badge variant="outline">
                <EyeIcon data-icon="inline-start" />
                Live preview
              </Badge>
              <Badge variant={status === "published" ? "default" : "secondary"}>
                {status === "published" ? "Published" : "Draft"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <article
              lang={editLocale}
              dir={editLocale === "ar" ? "rtl" : "ltr"}
              className="flex flex-col gap-4"
            >
              {coverImageUrl.trim() ? (
                // eslint-disable-next-line @next/next/no-img-element -- external/admin URL, validated http(s)
                <img
                  src={coverImageUrl.trim()}
                  alt=""
                  className="aspect-video w-full rounded-lg border border-border object-cover"
                />
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                {game ? <Badge variant="secondary">{localizeText(game.title, editLocale)}</Badge> : null}
                <Badge variant="outline">{contentMode === "shared" ? "Shared" : LOCALE_LABELS[editLocale]}</Badge>
              </div>
              <h1 className="text-2xl font-semibold leading-tight">
                {current.title || "Untitled post"}
              </h1>
              {current.summary.trim() ? (
                <p className="article-copy text-muted-foreground">{current.summary}</p>
              ) : null}
              {current.body.trim() ? (
                <PostBody markdown={current.body} />
              ) : (
                <p className="text-sm text-muted-foreground">Start writing to preview the post.</p>
              )}
            </article>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() => persist("draft", "draft")}
          disabled={!canSave || busy !== null}
          variant="outline"
        >
          <SaveIcon data-icon="inline-start" />
          {mode === "edit" && status === "published" ? "Save as draft" : "Save draft"}
        </Button>
        <Button onClick={() => persist("published", "publish")} disabled={!canPublish || busy !== null}>
          <SendIcon data-icon="inline-start" />
          {mode === "edit" && status === "published" ? "Update published" : "Publish"}
        </Button>
        {mode === "edit" && status === "published" ? (
          <Button onClick={() => persist("draft", "unpublish")} disabled={busy !== null} variant="outline">
            <EyeOffIcon data-icon="inline-start" />
            Unpublish
          </Button>
        ) : null}
        <div className="ms-auto">
          {mode === "edit" ? (
            <Button
              onClick={remove}
              disabled={busy !== null}
              variant="ghost"
              className={cn("text-destructive")}
            >
              <Trash2Icon data-icon="inline-start" />
              Delete
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
