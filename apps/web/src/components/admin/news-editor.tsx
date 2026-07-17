"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  BoldIcon,
  CalendarClockIcon,
  CheckIcon,
  CodeIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  ExternalLinkIcon,
  Heading2Icon,
  ImageIcon,
  ImagePlusIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  ListTodoIcon,
  Loader2Icon,
  MessageCircleIcon,
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
import {
  buildNewsCrossPostPreview,
  buildNewsDiscordAnnouncementPreview,
  buildXIntentUrl,
  getNewsCrossPostWebsiteState,
} from "@bot/lib/newsCrossPost.js";
import { localizeText } from "@/lib/community-content";
import { riyadhDateTimeToIso, toRiyadhDateTimeInput } from "@/lib/scheduled-publishing";
import type { GameRecord } from "@/lib/games";
import { copy as i18nCopy, localizedPath, type Locale } from "@/lib/i18n";
import { safeUrlOrUndefined } from "@/lib/safe-url";
import { cn } from "@/lib/utils";
import type {
  NewsContentMode,
  NewsCoverPlacement,
  NewsPost,
  NewsStatus,
} from "@/lib/news";
import {
  NEWS_BODY_MAX_LENGTH,
  NEWS_SUMMARY_MAX_LENGTH,
  NEWS_TITLE_MAX_LENGTH,
} from "@/lib/news-validation";
import { useAdminNavigationGuard } from "@/components/admin/admin-navigation-guard";
import { ImageCropDialog } from "@/components/admin/image-crop-dialog";
import { AuthorAvatar } from "@/components/news/author-avatar";
import { PostBody } from "@/components/news/post-body";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
import { Separator } from "@/components/ui/separator";
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

type EligibleAuthor = { discordId: string; name: string; avatarUrl: string | null };

type TranslationMap = Record<Locale, TranslationDraft>;
type SelectionState = { start: number; end: number };
type Transform = (
  value: string,
  start: number,
  end: number,
) => { text: string; selStart: number; selEnd: number };

const EMPTY_TRANSLATION: TranslationDraft = { title: "", summary: "", body: "" };
const ARABIC_LABEL = "العربية";
// Sentinel for "no related game" in the media-post game picker (Select needs a value).
const NO_GAME = "__none__";
const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  ar: ARABIC_LABEL,
};

const CROSS_POST_COPY = {
  en: {
    title: "Cross-post composer",
    website: "Website",
    discord: "Discord preview",
    xDraft: "X draft",
    status: "Website status",
    draft: "Draft",
    scheduled: "Scheduled",
    published: "Published",
    unsaved: "Save to generate public links",
    canonicalUrl: "Canonical public URL",
    noCanonicalUrl: "Save this post to create its canonical public URL.",
    openWebsite: "Open website",
    hashtags: "Optional hashtags",
    hashtagsPlaceholder: "EWC, Valorant",
    copyDraft: "Copy X draft",
    copied: "Copied",
    openX: "Open X draft",
    noXDraft: "Add a headline to prepare an X draft.",
    readMore: "Read more",
  },
  ar: {
    title: "\u0645\u0644\u062d\u0646 \u0627\u0644\u0646\u0634\u0631 \u0627\u0644\u0645\u062a\u0642\u0627\u0637\u0639",
    website: "\u0627\u0644\u0645\u0648\u0642\u0639",
    discord: "\u0645\u0639\u0627\u064a\u0646\u0629 Discord",
    xDraft: "\u0645\u0633\u0648\u062f\u0629 X",
    status: "\u062d\u0627\u0644\u0629 \u0627\u0644\u0645\u0648\u0642\u0639",
    draft: "\u0645\u0633\u0648\u062f\u0629",
    scheduled: "\u0645\u062c\u062f\u0648\u0644",
    published: "\u0645\u0646\u0634\u0648\u0631",
    unsaved: "\u0627\u062d\u0641\u0638 \u0627\u0644\u0645\u0646\u0634\u0648\u0631 \u0644\u0625\u0646\u0634\u0627\u0621 \u0631\u0648\u0627\u0628\u0637 \u0639\u0627\u0645\u0629",
    canonicalUrl: "\u0627\u0644\u0631\u0627\u0628\u0637 \u0627\u0644\u0639\u0627\u0645 \u0627\u0644\u0642\u064a\u0627\u0633\u064a",
    noCanonicalUrl: "\u0627\u062d\u0641\u0638 \u0627\u0644\u0645\u0646\u0634\u0648\u0631 \u0644\u0625\u0646\u0634\u0627\u0621 \u0631\u0627\u0628\u0637\u0647 \u0627\u0644\u0639\u0627\u0645 \u0627\u0644\u0642\u064a\u0627\u0633\u064a.",
    openWebsite: "\u0641\u062a\u062d \u0627\u0644\u0645\u0648\u0642\u0639",
    hashtags: "\u0648\u0633\u0648\u0645 \u0627\u062e\u062a\u064a\u0627\u0631\u064a\u0629",
    hashtagsPlaceholder: "EWC, Valorant",
    copyDraft: "\u0646\u0633\u062e \u0645\u0633\u0648\u062f\u0629 X",
    copied: "\u062a\u0645 \u0627\u0644\u0646\u0633\u062e",
    openX: "\u0641\u062a\u062d \u0645\u0633\u0648\u062f\u0629 X",
    noXDraft: "\u0623\u0636\u0641 \u0639\u0646\u0648\u0627\u0646\u064b\u0627 \u0644\u062a\u062c\u0647\u064a\u0632 \u0645\u0633\u0648\u062f\u0629 X.",
    readMore: "\u0627\u0642\u0631\u0623 \u0627\u0644\u0645\u0632\u064a\u062f",
  },
} satisfies Record<Locale, Record<string, string>>;

// Formats that the crop canvas cannot re-encode meaningfully; uploaded as-is.
const NON_CROPPABLE_TYPES = new Set(["image/gif", "image/avif"]);

const EMOJIS = [
  "\u{1F525}",
  "\u{1F3C6}",
  "⭐",
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
  "✅",
  "❌",
  "⚡",
  "\u{1F4A5}",
  "\u{1F680}",
  "\u{1F389}",
  "❤️",
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

function wordCount(value: string) {
  const matches = value.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

function subscribeToLocation() {
  return () => {};
}

function currentPublicOrigin() {
  return window.location.origin;
}

function serverPublicOrigin() {
  return null;
}

function isImageFile(file: File) {
  return file.type.startsWith("image/");
}

export function NewsEditor({
  mode,
  post,
  games,
  mediaChannel,
  locale = "en",
  currentUser = null,
}: {
  mode: "create" | "edit";
  post?: NewsPost;
  games: GameRecord[];
  /** When set, the post is owned by this media channel (game becomes an optional tag). */
  mediaChannel?: { slug: string; name: string };
  locale?: Locale;
  /** The signed-in admin, used as the default author when creating a post. */
  currentUser?: { discordId: string | null; name: string | null } | null;
}) {
  const router = useRouter();
  const isMedia = Boolean(mediaChannel);
  const t = i18nCopy[locale].composer;
  const crossPostCopy = CROSS_POST_COPY[locale];
  const scheduleCopy =
    locale === "ar"
      ? {
          label: "\u062c\u062f\u0648\u0644\u0629 \u0627\u0644\u0646\u0634\u0631",
          hint: "\u064a\u0631\u062c\u0649 \u0627\u062e\u062a\u064a\u0627\u0631 \u0648\u0642\u062a \u0645\u0633\u062a\u0642\u0628\u0644\u064a \u0628\u062a\u0648\u0642\u064a\u062a \u0627\u0644\u0631\u064a\u0627\u0636.",
          action: "\u062c\u062f\u0648\u0644\u0629",
          update: "\u062a\u062d\u062f\u064a\u062b \u0627\u0644\u062c\u062f\u0648\u0644",
          status: "\u0645\u062c\u062f\u0648\u0644",
          invalid: "\u0627\u062e\u062a\u0631 \u0648\u0642\u062a \u0646\u0634\u0631 \u0635\u0627\u0644\u062d\u0627 \u0641\u064a \u0627\u0644\u0645\u0633\u062a\u0642\u0628\u0644.",
        }
      : {
          label: "Schedule publication",
          hint: "Choose a future time in Asia/Riyadh.",
          action: "Schedule",
          update: "Update schedule",
          status: "Scheduled",
          invalid: "Choose a valid future publish time.",
        };
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetRef = useRef<"body" | "cover">("body");
  const pendingSelectionRef = useRef<SelectionState | null>(null);
  // Keep the last picked/pasted cover File in memory so it can be re-cropped. A
  // remote already-saved cover (no File) cannot be re-cropped (canvas taint).
  const coverFileRef = useRef<File | null>(null);
  // Set while the crop dialog is cropping a BODY image (vs the default cover flow).
  const bodyCropPendingRef = useRef(false);
  // Holds the save target/action while the shared-mode discard confirm dialog is open.
  const pendingPersistRef = useRef<{ targetStatus: NewsStatus; action: string } | null>(null);

  const initialDefaultLocale = post?.defaultLocale || post?.locale || "en";
  // Owner game (game post) or optional related game (media post: "" = none).
  const [gameSlug, setGameSlug] = useState(
    post?.gameSlug || (mediaChannel ? "" : games[0]?.slug || ""),
  );
  const [contentMode, setContentMode] = useState<NewsContentMode>(post?.contentMode || "shared");
  const [defaultLocale, setDefaultLocale] = useState<Locale>(initialDefaultLocale);
  const [activeLocale, setActiveLocale] = useState<Locale>(initialDefaultLocale);
  const [translations, setTranslations] = useState<TranslationMap>(() => initialTranslations(post));
  const [coverImageUrl, setCoverImageUrl] = useState(post?.coverImageUrl || "");
  const [coverPlacement, setCoverPlacement] = useState<NewsCoverPlacement>(
    post?.coverPlacement || "top",
  );
  const [ewc, setEwc] = useState<boolean>(post?.ewc ?? false);
  const [status, setStatus] = useState<NewsStatus>(post?.status || "draft");
  const [scheduledPublishAt, setScheduledPublishAt] = useState(() =>
    toRiyadhDateTimeInput(post?.scheduledPublishAt),
  );
  const [xHashtags, setXHashtags] = useState("");
  const [xDraftOverride, setXDraftOverride] = useState<{ source: string; value: string } | null>(null);
  const [copiedCrossPostValue, setCopiedCrossPostValue] = useState<"url" | "x" | null>(null);
  // Author picker: list of eligible authors for the current game (fetched), plus
  // the currently-credited author's discord id. authorName is derived from the
  // selected option (or the post's stored name when the id isn't in the list).
  const [authors, setAuthors] = useState<EligibleAuthor[]>([]);
  const [authorsLoading, setAuthorsLoading] = useState(false);
  const [selectedAuthorIds, setSelectedAuthorIds] = useState<string[]>(() =>
    post?.authors?.length
      ? post.authors.map((a) => a.discordId)
      : post?.authorDiscordId
        ? [post.authorDiscordId]
        : [],
  );
  const [mobileView, setMobileView] = useState<"edit" | "preview">("edit");
  const [busy, setBusy] = useState<null | string>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [selection, setSelection] = useState<SelectionState>({ start: 0, end: 0 });
  const [coverDragActive, setCoverDragActive] = useState(false);
  const [bodyDragActive, setBodyDragActive] = useState(false);
  const [cropOpen, setCropOpen] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  // Body image awaiting the "Crop or upload as-is?" choice (replaces window.confirm).
  const [cropChoiceFile, setCropChoiceFile] = useState<File | null>(null);
  // Open-state for the shared-mode discard confirm and the delete confirm dialogs.
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const editLocale = contentMode === "shared" ? defaultLocale : activeLocale;
  const current = translations[editLocale];
  const isRtl = editLocale === "ar";
  const game = games.find((g) => g.slug === gameSlug);
  const safeCover = safeUrlOrUndefined(coverImageUrl);
  const canEditCover = Boolean(safeCover && coverFileRef.current);
  const activeMarks = useMemo(
    () => getMarkdownActiveState(current.body, selection.start, selection.end),
    [current.body, selection.end, selection.start],
  );
  const activeToolValues = Object.entries(activeMarks)
    .filter(([, value]) => value)
    .map(([key]) => key);

  const publicBaseUrl = useSyncExternalStore(
    subscribeToLocation,
    currentPublicOrigin,
    serverPublicOrigin,
  );

  const cropCopy = {
    title: t.cropTitle,
    description: t.cropDescription,
    zoom: t.cropZoom,
    aspect: t.cropAspect,
    free: t.cropFree,
    freeHint: t.cropFreeHint,
    cancel: t.cropCancel,
    apply: t.cropApply,
    applying: t.cropApplying,
  };

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
    // Use the remembered selection (captured on the textarea's select/click/keyup), not
    // the live textarea selection. A controlled-textarea re-render (e.g. from the active-
    // state recompute) can reset the live selection to the end, which would make toggle
    // buttons insert markers at the end instead of unwrapping the current selection. The
    // pending ref + layout effect below restore the visible selection deterministically.
    const result = transform(current.body, selection.start, selection.end);
    updateTranslation(editLocale, { body: result.text });
    const nextSelection = { start: result.selStart, end: result.selEnd };
    setSelection(nextSelection);
    pendingSelectionRef.current = nextSelection;
  }

  // Restore the textarea selection after a toolbar action changes the body, so it
  // survives the controlled re-render. Only runs for programmatic edits (typing leaves
  // pendingSelectionRef null), so normal typing is never interfered with.
  useLayoutEffect(() => {
    const pending = pendingSelectionRef.current;
    if (!pending) return;
    pendingSelectionRef.current = null;
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(pending.start, pending.end);
  }, [current.body, editLocale]);

  // Eligible authors are scoped to the owner: the fixed media channel for media
  // posts, otherwise the selected game. Media mode loads once; game mode refetches
  // when the game changes.
  const authorScope = isMedia
    ? `media=${encodeURIComponent(mediaChannel!.slug)}`
    : gameSlug
      ? `game=${encodeURIComponent(gameSlug)}`
      : null;
  useEffect(() => {
    if (!authorScope) return;
    let cancelled = false;
    // Wrapped in an async fn so the setState calls run inside promise
    // continuations (callbacks), not synchronously in the effect body.
    async function loadAuthors(scope: string) {
      setAuthorsLoading(true);
      try {
        const res = await fetch(`/api/admin/authors?${scope}`);
        const data: { authors?: EligibleAuthor[] } = res.ok ? await res.json() : { authors: [] };
        if (cancelled) return;
        const list = Array.isArray(data.authors) ? data.authors : [];
        setAuthors(list);
        setSelectedAuthorIds((prev) => {
          if (prev.length) return prev;
          if (post?.authors?.length) return post.authors.map((a) => a.discordId);
          // New post: default to the signed-in admin when they're eligible.
          if (currentUser?.discordId && list.some((a) => a.discordId === currentUser.discordId)) {
            return [currentUser.discordId];
          }
          return [];
        });
      } catch {
        if (!cancelled) setAuthors([]);
      } finally {
        if (!cancelled) setAuthorsLoading(false);
      }
    }
    void loadAuthors(authorScope);
    return () => {
      cancelled = true;
    };
    // post + currentUser are stable for the editor's lifetime; only the owner scope drives refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorScope]);

  // Resolve the display name for the selected author from the fetched list,
  // falling back to the post's stored author name so editing an existing post
  // never loses the credit even if that user is no longer in the eligible list.
  // Option list = fetched eligible authors plus the post's existing authors (so an
  // already-credited author still shows even if no longer eligible). Selected ids
  // resolve to full {name, avatar} snapshots for saving.
  const authorOptions = useMemo(() => {
    const map = new Map<string, EligibleAuthor>();
    for (const a of post?.authors || []) {
      map.set(a.discordId, { discordId: a.discordId, name: a.name, avatarUrl: a.avatarUrl });
    }
    for (const a of authors) map.set(a.discordId, a);
    return [...map.values()];
  }, [authors, post]);
  const selectedAuthors = selectedAuthorIds
    .map((id) => authorOptions.find((a) => a.discordId === id))
    .filter((a): a is EligibleAuthor => Boolean(a));

  const crossPostPost = useMemo(() => {
    const previewTranslations =
      contentMode === "shared"
        ? {
            [defaultLocale]: { locale: defaultLocale, ...translations[defaultLocale] },
          }
        : {
            en: { locale: "en" as const, ...translations.en },
            ar: { locale: "ar" as const, ...translations.ar },
          };
    const primary = previewTranslations[defaultLocale];
    return {
      id: post?.id,
      gameSlug: isMedia ? gameSlug || null : gameSlug || null,
      mediaSlug: isMedia ? mediaChannel!.slug : null,
      defaultLocale,
      locale: defaultLocale,
      title: primary?.title || "",
      summary: primary?.summary || "",
      body: primary?.body || "",
      status,
      coverImageUrl: coverImageUrl.trim() || null,
      authorName: post?.authorName || null,
      authors: selectedAuthors.map((author) => ({
        name: author.name,
        avatarUrl: author.avatarUrl,
      })),
      publishedAt: post?.publishedAt || null,
      translations: previewTranslations,
    };
  }, [
    contentMode,
    coverImageUrl,
    defaultLocale,
    gameSlug,
    isMedia,
    mediaChannel,
    post?.authorName,
    post?.id,
    post?.publishedAt,
    selectedAuthors,
    status,
    translations,
  ]);
  const crossPostPreview = useMemo(
    () =>
      buildNewsCrossPostPreview(crossPostPost, {
        baseUrl: publicBaseUrl || undefined,
        preferredLocale: locale,
        hashtags: xHashtags,
      }),
    [crossPostPost, locale, publicBaseUrl, xHashtags],
  );
  const discordPreview = useMemo(
    () =>
      buildNewsDiscordAnnouncementPreview(crossPostPost, {
        baseUrl: publicBaseUrl || undefined,
        game,
      }),
    [crossPostPost, game, publicBaseUrl],
  );
  const xDraft =
    xDraftOverride?.source === crossPostPreview.socialText
      ? xDraftOverride.value
      : crossPostPreview.socialText;
  const xIntentUrl = buildXIntentUrl(xDraft);
  const websiteState = getNewsCrossPostWebsiteState(crossPostPost);
  const websiteStatus = crossPostCopy[websiteState];

  async function copyCrossPostValue(kind: "url" | "x", value: string) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopiedCrossPostValue(kind);
    window.setTimeout(() => setCopiedCrossPostValue(null), 1_600);
  }

  function toggleAuthor(discordId: string) {
    setSelectedAuthorIds((prev) =>
      prev.includes(discordId) ? prev.filter((id) => id !== discordId) : [...prev, discordId],
    );
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

  // Decide whether a chosen image file should open the crop dialog first. Cover files
  // always crop (unless GIF/AVIF). Body image files are uploaded directly here; the crop
  // affordance for body images is offered separately as a notice.
  function handleCoverFile(file: File) {
    if (!isImageFile(file)) return;
    coverFileRef.current = file;
    if (NON_CROPPABLE_TYPES.has(file.type)) {
      setNotice(t.cropSkipNotice);
      uploadTargetRef.current = "cover";
      void handleUpload(file);
      return;
    }
    setNotice(null);
    setCropFile(file);
    setCropOpen(true);
  }

  function handleBodyFile(file: File) {
    if (!isImageFile(file)) return;
    uploadTargetRef.current = "body";
    // Body images upload as-is, but offer an optional crop first via a polished dialog
    // (skip GIF/AVIF which the crop canvas cannot re-encode meaningfully).
    if (!NON_CROPPABLE_TYPES.has(file.type)) {
      setCropChoiceFile(file);
      return;
    }
    void handleUpload(file);
  }

  // "Crop image" chosen in the crop-before-upload dialog → open the real crop tool.
  function startBodyCrop(file: File) {
    setCropChoiceFile(null);
    bodyCropPendingRef.current = true;
    coverFileRef.current = null;
    uploadTargetRef.current = "body";
    setCropFile(file);
    setCropOpen(true);
  }

  // "Upload as-is" chosen → skip cropping and upload the original body image.
  function uploadBodyAsIs(file: File) {
    setCropChoiceFile(null);
    uploadTargetRef.current = "body";
    void handleUpload(file);
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
        setError(json.error || t.uploadFailed);
        return;
      }
      if (uploadTargetRef.current === "cover") setCoverImageUrl(json.url);
      else apply(imageTransform(json.url, false));
    } finally {
      setUploading(false);
    }
  }

  function onCropApply(file: File) {
    setCropOpen(false);
    if (bodyCropPendingRef.current) {
      bodyCropPendingRef.current = false;
      uploadTargetRef.current = "body";
      void handleUpload(file);
      return;
    }
    coverFileRef.current = file;
    uploadTargetRef.current = "cover";
    void handleUpload(file);
  }

  function editCover() {
    const file = coverFileRef.current;
    if (!file) return;
    setCropFile(file);
    setCropOpen(true);
  }

  function removeCover() {
    setCoverImageUrl("");
    coverFileRef.current = null;
  }

  // --- Paste / drag-drop handlers ---------------------------------------------
  function firstImageFromDataTransfer(items: DataTransferItemList | null, files: FileList | null) {
    if (items) {
      for (const item of Array.from(items)) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) return file;
        }
      }
    }
    if (files) {
      for (const file of Array.from(files)) {
        if (file.type.startsWith("image/")) return file;
      }
    }
    return null;
  }

  function onCoverPaste(event: React.ClipboardEvent) {
    const file = firstImageFromDataTransfer(event.clipboardData.items, event.clipboardData.files);
    if (file) {
      event.preventDefault();
      handleCoverFile(file);
    }
  }

  function onBodyPaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const file = firstImageFromDataTransfer(event.clipboardData.items, event.clipboardData.files);
    if (file) {
      event.preventDefault();
      rememberSelection();
      handleBodyFile(file);
    }
  }

  function onCoverDrop(event: React.DragEvent) {
    event.preventDefault();
    setCoverDragActive(false);
    const file = firstImageFromDataTransfer(event.dataTransfer.items, event.dataTransfer.files);
    if (file) handleCoverFile(file);
  }

  function onBodyDrop(event: React.DragEvent<HTMLTextAreaElement>) {
    event.preventDefault();
    setBodyDragActive(false);
    const file = firstImageFromDataTransfer(event.dataTransfer.items, event.dataTransfer.files);
    if (file) {
      rememberSelection();
      handleBodyFile(file);
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
  // Game posts require a game; media posts require their channel (always present here).
  const canSave = Boolean((isMedia || gameSlug) && !hasLimitError);
  const canPublish = canSave && !publishError;
  const canSchedule = canPublish && Boolean(riyadhDateTimeToIso(scheduledPublishAt));

  function persist(targetStatus: NewsStatus, action: string) {
    setError(null);
    if ((targetStatus === "published" || targetStatus === "scheduled") && !canPublish) {
      setError(
        contentMode === "translated" ? t.publishRequiredTranslated : t.publishRequiredShared,
      );
      return;
    }
    if (
      targetStatus === "scheduled" &&
      (!riyadhDateTimeToIso(scheduledPublishAt) ||
        Date.parse(riyadhDateTimeToIso(scheduledPublishAt) || "") <= Date.now())
    ) {
      setError(scheduleCopy.invalid);
      return;
    }
    if (contentMode === "shared") {
      const inactiveLocale = defaultLocale === "en" ? "ar" : "en";
      if (hasContent(translations[inactiveLocale])) {
        // Confirm via a polished dialog before discarding the other-language draft.
        pendingPersistRef.current = { targetStatus, action };
        setDiscardConfirmOpen(true);
        return;
      }
    }
    void persistConfirmed(targetStatus, action);
  }

  async function persistConfirmed(targetStatus: NewsStatus, action: string) {
    setBusy(action);
    try {
      const payload = {
        gameSlug: gameSlug || null,
        mediaSlug: isMedia ? mediaChannel!.slug : null,
        contentMode,
        defaultLocale,
        translations: translationsToPersist,
        coverImageUrl: coverImageUrl.trim() || null,
        coverPlacement,
        ewc,
        status: targetStatus,
        scheduledPublishAt:
          targetStatus === "scheduled" ? riyadhDateTimeToIso(scheduledPublishAt) : null,
        authors: selectedAuthors.map((a) => ({
          discordId: a.discordId,
          name: a.name,
          avatarUrl: a.avatarUrl,
        })),
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
      if (!res.ok) throw new Error(data.error || t.saveFailed);
      setStatus(targetStatus);
      // Media posts return to their channel page (where the flow started), not
      // the general admin dashboard.
      router.push(
        localizedPath(isMedia ? `/admin/media/${mediaChannel!.slug}` : "/admin", locale),
      );
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // Opens the delete confirm dialog; the actual delete runs from removeConfirmed.
  function remove() {
    if (mode !== "edit" || !post) return;
    setDeleteConfirmOpen(true);
  }

  async function removeConfirmed() {
    if (mode !== "edit" || !post) return;
    setDeleteConfirmOpen(false);
    setError(null);
    setBusy("delete");
    try {
      const res = await fetch(`/api/admin/news/${post.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t.deleteFailed);
      router.push(
        localizedPath(isMedia ? `/admin/media/${mediaChannel!.slug}` : "/admin", locale),
      );
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  }

  const words = wordCount(current.body);

  // Unsaved-changes tracking. Content fields snapshot against the first render;
  // authors snapshot against the resolved list (the eligible-authors fetch injects
  // a default author on create, which must not count as a user edit).
  const contentSnapshot = JSON.stringify({
    gameSlug,
    contentMode,
    defaultLocale,
    translations,
    coverImageUrl,
    coverPlacement,
    ewc,
    scheduledPublishAt,
  });
  const contentBaselineRef = useRef(contentSnapshot);
  const authorsSnapshot = JSON.stringify([...selectedAuthorIds].sort());
  const authorsBaselineRef = useRef<string | null>(null);
  const authorsFetchStartedRef = useRef(false);
  useEffect(() => {
    // Capture the baseline only after the eligible-authors fetch resolves (its
    // default-author injection must not count as a user edit). authorsLoading
    // starts false, so wait for the true -> false transition.
    if (authorsLoading) {
      authorsFetchStartedRef.current = true;
      return;
    }
    if (authorsFetchStartedRef.current && authorsBaselineRef.current === null) {
      authorsBaselineRef.current = JSON.stringify([...selectedAuthorIds].sort());
    }
  }, [authorsLoading, selectedAuthorIds]);
  const isDirty =
    contentSnapshot !== contentBaselineRef.current ||
    (authorsBaselineRef.current !== null && authorsSnapshot !== authorsBaselineRef.current);

  const dirtySourceId = useMemo(
    () => `news-editor:${post?.id ?? mode}:${mediaChannel?.slug ?? "game"}`,
    [mediaChannel?.slug, mode, post?.id],
  );
  useAdminNavigationGuard(dirtySourceId, isDirty && busy === null);

  // Ctrl/Cmd+S saves a draft. The handler reads through a ref so the listener
  // doesn't need to re-bind on every state change persist() closes over.
  const saveShortcutRef = useRef<() => void>(() => {});
  saveShortcutRef.current = () => {
    if (canSave && busy === null) persist("draft", "draft");
  };
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveShortcutRef.current();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="flex flex-col gap-6" dir={isRtl ? "rtl" : "ltr"}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (!file) return;
          if (uploadTargetRef.current === "cover") handleCoverFile(file);
          else handleBodyFile(file);
        }}
      />
      <div className="flex gap-2 lg:hidden">
        <Button
          variant={mobileView === "edit" ? "default" : "outline"}
          size="sm"
          onClick={() => setMobileView("edit")}
        >
          <PencilIcon data-icon="inline-start" />
          {t.editTab}
        </Button>
        <Button
          variant={mobileView === "preview" ? "default" : "outline"}
          size="sm"
          onClick={() => setMobileView("preview")}
        >
          <EyeIcon data-icon="inline-start" />
          {t.previewTab}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <Card className={mobileView === "preview" ? "hidden lg:flex" : undefined}>
          <CardHeader>
            <CardTitle>
              {mode === "create" ? t.newPost : t.editPost}
              {isMedia ? <span className="text-muted-foreground"> · {mediaChannel!.name}</span> : null}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              {/* Meta controls: game (or related game), mode, writing language */}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel>{isMedia ? t.relatedGame : t.game}</FieldLabel>
                  {isMedia ? (
                    <Select
                      value={gameSlug || NO_GAME}
                      onValueChange={(value) => setGameSlug(value && value !== NO_GAME ? value : "")}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue>
                          {(value) => {
                            if (!value || value === NO_GAME) return t.relatedGameNone;
                            const selected = games.find((g) => g.slug === value);
                            return selected ? localizeText(selected.title, locale) : value;
                          }}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value={NO_GAME}>{t.relatedGameNone}</SelectItem>
                          {games.map((item) => (
                            <SelectItem key={item.slug} value={item.slug}>
                              {localizeText(item.title, locale)}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Select value={gameSlug} onValueChange={(value) => value && setGameSlug(value)}>
                      <SelectTrigger className="w-full">
                        {/* base-ui SelectValue renders the raw value by default; a function
                            child maps value→localized label so the trigger shows the name. */}
                        <SelectValue>
                          {(value) => {
                            const selected = games.find((g) => g.slug === value);
                            return selected ? localizeText(selected.title, locale) : value;
                          }}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {games.map((item) => (
                            <SelectItem key={item.slug} value={item.slug}>
                              {localizeText(item.title, locale)}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  )}
                </Field>
                <Field>
                  <FieldLabel>{t.contentMode}</FieldLabel>
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
                      {t.shared}
                    </ToggleGroupItem>
                    <ToggleGroupItem value="translated" className="flex-1">
                      {t.separate}
                    </ToggleGroupItem>
                  </ToggleGroup>
                  <FieldDescription>{t.sharedHint}</FieldDescription>
                </Field>
              </div>

              <Field>
                <FieldLabel>{scheduleCopy.label}</FieldLabel>
                <Input
                  type="datetime-local"
                  value={scheduledPublishAt}
                  min={toRiyadhDateTimeInput(new Date().toISOString())}
                  onChange={(event) => setScheduledPublishAt(event.target.value)}
                  className="w-full sm:max-w-sm"
                />
                <FieldDescription>{scheduleCopy.hint}</FieldDescription>
              </Field>

              {/* Authors: multi-select. Eligible = supers + roster admins for this game. */}
              <Field>
                <FieldLabel>{t.authors}</FieldLabel>
                {authorsLoading ? (
                  <p className="text-sm text-muted-foreground">{t.authorLoading}</p>
                ) : authorOptions.length ? (
                  <div className="flex flex-wrap gap-2">
                    {authorOptions.map((author) => {
                      const selected = selectedAuthorIds.includes(author.discordId);
                      return (
                        <button
                          key={author.discordId}
                          type="button"
                          onClick={() => toggleAuthor(author.discordId)}
                          aria-pressed={selected}
                          className={cn(
                            "flex items-center gap-2 rounded-full border px-2.5 py-1 text-sm transition-colors",
                            selected
                              ? "border-primary bg-primary/10 text-foreground"
                              : "border-border text-muted-foreground hover:bg-muted",
                          )}
                        >
                          <AuthorAvatar
                            name={author.name}
                            avatarUrl={author.avatarUrl}
                            className="size-5"
                          />
                          <span className="max-w-[12rem] truncate">{author.name}</span>
                          {selected ? <CheckIcon className="size-3.5 text-primary" /> : null}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{t.authorEmpty}</p>
                )}
                <FieldDescription>{t.authorsHint}</FieldDescription>
              </Field>

              {contentMode === "shared" ? (
                <Field>
                  <FieldLabel>{t.writingLanguage}</FieldLabel>
                  <Select
                    value={defaultLocale}
                    onValueChange={(value) => {
                      if (value === "en" || value === "ar") switchSharedLocale(value);
                    }}
                  >
                    <SelectTrigger className="w-full sm:w-64">
                      <SelectValue>
                        {(value) => (value === "ar" ? t.arabic : t.english)}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="en">{t.english}</SelectItem>
                        <SelectItem value="ar">{t.arabic}</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}

              {/* Cover dropzone (X-Articles style) */}
              <Field>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <FieldLabel>{t.cover}</FieldLabel>
                  <span className="text-xs text-muted-foreground">{t.coverHint}</span>
                </div>
                <div
                  className={cn(
                    "group relative flex aspect-[5/2] w-full items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-border bg-muted/30 transition-colors",
                    coverDragActive && "border-primary bg-primary/5",
                    uploading && "opacity-70",
                  )}
                  role="button"
                  tabIndex={0}
                  onPaste={onCoverPaste}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setCoverDragActive(true);
                  }}
                  onDragLeave={() => setCoverDragActive(false)}
                  onDrop={onCoverDrop}
                  onClick={() => {
                    if (!safeCover && !uploading) pickImage("cover");
                  }}
                >
                  {safeCover ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element -- validated http(s) admin URL */}
                      <img
                        src={safeCover}
                        alt=""
                        className="absolute inset-0 size-full object-cover"
                      />
                      <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                        {canEditCover ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={uploading}
                            onClick={(event) => {
                              event.stopPropagation();
                              editCover();
                            }}
                          >
                            <PencilIcon data-icon="inline-start" />
                            {t.coverEdit}
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={uploading}
                          onClick={(event) => {
                            event.stopPropagation();
                            pickImage("cover");
                          }}
                        >
                          <UploadIcon data-icon="inline-start" />
                          {t.coverReplace}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          disabled={uploading}
                          onClick={(event) => {
                            event.stopPropagation();
                            removeCover();
                          }}
                        >
                          <Trash2Icon data-icon="inline-start" />
                          {t.coverRemove}
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-2 px-4 text-center text-muted-foreground">
                      {uploading ? (
                        <Loader2Icon className="size-6 animate-spin" />
                      ) : (
                        <ImagePlusIcon className="size-6" />
                      )}
                      <span className="text-sm">
                        {coverDragActive
                          ? t.dropToUpload
                          : uploading
                            ? t.uploading
                            : t.uploadHint}
                      </span>
                    </div>
                  )}
                </div>
                <Input
                  value={coverImageUrl}
                  dir="ltr"
                  onChange={(event) => {
                    setCoverImageUrl(event.target.value);
                    // Typed/pasted remote URLs cannot be re-cropped (canvas taint).
                    coverFileRef.current = null;
                  }}
                  placeholder="https://assets.esportscommunity.net/..."
                  className="mt-2"
                />
              </Field>

              {/* Cover placement (T2) */}
              <Field>
                <FieldLabel>{t.coverPlacement}</FieldLabel>
                <Select
                  value={coverPlacement}
                  onValueChange={(value) => {
                    if (value === "top" || value === "bottom" || value === "card-only") {
                      setCoverPlacement(value);
                    }
                  }}
                >
                  <SelectTrigger className="w-full sm:w-64">
                    <SelectValue>
                      {(value) =>
                        value === "bottom"
                          ? t.placementBottom
                          : value === "card-only"
                            ? t.placementCardOnly
                            : t.placementTop
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="top">{t.placementTop}</SelectItem>
                      <SelectItem value="bottom">{t.placementBottom}</SelectItem>
                      <SelectItem value="card-only">{t.placementCardOnly}</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              {/* EWC tag — includes this post in the EWC news section. */}
              <Field>
                <FieldLabel>{t.ewcLabel}</FieldLabel>
                <ToggleGroup
                  value={[ewc ? "yes" : "no"]}
                  onValueChange={(value) => {
                    const next = value.at(-1);
                    if (next === "yes" || next === "no") setEwc(next === "yes");
                  }}
                  spacing={1}
                  variant="outline"
                  className="w-full sm:w-64"
                >
                  <ToggleGroupItem value="no" className="flex-1">
                    {t.ewcNo}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="yes" className="flex-1">
                    {t.ewcYes}
                  </ToggleGroupItem>
                </ToggleGroup>
                <FieldDescription>{t.ewcHint}</FieldDescription>
              </Field>

              {/* Separate-mode locale tabs */}
              {contentMode === "translated" ? (
                <Tabs value={activeLocale} onValueChange={(value) => setActiveLocale(value as Locale)}>
                  <TabsList>
                    <TabsTrigger value="en">{t.english}</TabsTrigger>
                    <TabsTrigger value="ar">{t.arabic}</TabsTrigger>
                  </TabsList>
                  <TabsContent value="en" />
                  <TabsContent value="ar" />
                </Tabs>
              ) : null}

              {/* Title */}
              <Field data-invalid={current.title.length > NEWS_TITLE_MAX_LENGTH}>
                <FieldLabel htmlFor="news-title">{t.titleLabel}</FieldLabel>
                <Input
                  id="news-title"
                  value={current.title}
                  maxLength={NEWS_TITLE_MAX_LENGTH}
                  aria-invalid={current.title.length > NEWS_TITLE_MAX_LENGTH}
                  dir="auto"
                  onChange={(event) => updateTranslation(editLocale, { title: event.target.value })}
                  placeholder={t.titlePlaceholder}
                  className="bidi-plaintext h-auto py-2 text-xl font-semibold"
                />
                <div className="flex justify-end">
                  <span className="text-xs text-muted-foreground">
                    {counterText(current.title.length, NEWS_TITLE_MAX_LENGTH)}
                  </span>
                </div>
              </Field>

              {/* Summary */}
              <Field data-invalid={current.summary.length > NEWS_SUMMARY_MAX_LENGTH}>
                <FieldLabel htmlFor="news-summary">{t.summaryLabel}</FieldLabel>
                <Textarea
                  id="news-summary"
                  value={current.summary}
                  maxLength={NEWS_SUMMARY_MAX_LENGTH}
                  aria-invalid={current.summary.length > NEWS_SUMMARY_MAX_LENGTH}
                  dir="auto"
                  onChange={(event) => updateTranslation(editLocale, { summary: event.target.value })}
                  placeholder={t.summaryPlaceholder}
                  className="bidi-plaintext resize-none"
                  rows={2}
                />
                <div className="flex justify-end">
                  <span className="text-xs text-muted-foreground">
                    {counterText(current.summary.length, NEWS_SUMMARY_MAX_LENGTH)}
                  </span>
                </div>
              </Field>

              {/* Article body: label, toolbar, then the writing area */}
              <Field data-invalid={current.body.length > NEWS_BODY_MAX_LENGTH}>
                <FieldLabel htmlFor="news-body">{t.bodyLabel}</FieldLabel>
                <div className="flex flex-wrap items-center gap-1 rounded-md border border-border bg-muted/40 p-1">
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
                  <Separator orientation="vertical" className="mx-1 h-6" />
                  <div className="flex flex-wrap items-center gap-1">
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

                {/* Borderless body */}
                <Textarea
                  id="news-body"
                  ref={textareaRef}
                  value={current.body}
                  maxLength={NEWS_BODY_MAX_LENGTH}
                  aria-invalid={current.body.length > NEWS_BODY_MAX_LENGTH}
                  dir="auto"
                  className={cn(
                    "bidi-plaintext article-copy min-h-[50vh] resize-y text-base leading-7",
                    bodyDragActive && "bg-primary/5 ring-2 ring-primary",
                  )}
                  placeholder={t.bodyPlaceholder}
                  onChange={(event) => updateTranslation(editLocale, { body: event.target.value })}
                  onSelect={rememberSelection}
                  onKeyUp={rememberSelection}
                  onClick={rememberSelection}
                  onPaste={onBodyPaste}
                  onDragOver={(event) => {
                    if (Array.from(event.dataTransfer.types).includes("Files")) {
                      event.preventDefault();
                      setBodyDragActive(true);
                    }
                  }}
                  onDragLeave={() => setBodyDragActive(false)}
                  onDrop={onBodyDrop}
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    {counterText(current.body.length, NEWS_BODY_MAX_LENGTH)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {words.toLocaleString(locale === "ar" ? "ar-SA" : "en-US")} {t.wordCount}
                  </span>
                </div>
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>

        <Card className={mobileView === "edit" ? "hidden lg:flex" : undefined}>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Badge variant="outline">
                <EyeIcon data-icon="inline-start" />
                {t.livePreview}
              </Badge>
              <Badge variant={status === "published" ? "default" : status === "scheduled" ? "outline" : "secondary"}>
                {status === "published" ? t.published : status === "scheduled" ? scheduleCopy.status : t.draft}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <article
              lang={editLocale}
              dir={isRtl ? "rtl" : "ltr"}
              className="flex flex-col gap-4"
            >
              {safeCover && coverPlacement === "top" ? (
                // eslint-disable-next-line @next/next/no-img-element -- external/admin URL, validated http(s)
                <img
                  src={safeCover}
                  alt=""
                  className="aspect-[5/2] w-full rounded-lg border border-border object-cover"
                />
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                {game ? <Badge variant="secondary">{localizeText(game.title, editLocale)}</Badge> : null}
                <Badge variant="outline">{contentMode === "shared" ? t.shared : LOCALE_LABELS[editLocale]}</Badge>
              </div>
              <h1 dir="auto" className="bidi-plaintext text-2xl font-semibold leading-tight">
                {current.title || t.untitled}
              </h1>
              {current.summary.trim() ? (
                <p dir="auto" className="bidi-plaintext article-copy text-muted-foreground">
                  {current.summary}
                </p>
              ) : null}
              {current.body.trim() ? (
                <PostBody markdown={current.body} />
              ) : (
                <p className="text-sm text-muted-foreground">{t.previewEmpty}</p>
              )}
              {safeCover && coverPlacement === "bottom" ? (
                // eslint-disable-next-line @next/next/no-img-element -- external/admin URL, validated http(s)
                <img
                  src={safeCover}
                  alt=""
                  className="aspect-[5/2] w-full rounded-lg border border-border object-cover"
                />
              ) : null}
            </article>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-lg">
              <MessageCircleIcon className="size-4 text-primary" />
              {crossPostCopy.title}
            </CardTitle>
            <Badge variant={status === "published" ? "default" : status === "scheduled" ? "outline" : "secondary"}>
              {websiteStatus}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="min-w-0 space-y-3" aria-labelledby="cross-post-website">
              <div>
                <p id="cross-post-website" className="text-sm font-medium">
                  {crossPostCopy.website}
                </p>
                <p className="text-sm text-muted-foreground">{crossPostCopy.status}: {websiteStatus}</p>
              </div>
              {crossPostPreview.canonicalUrl ? (
                <div className="flex flex-wrap gap-2">
                  <Input
                    value={crossPostPreview.canonicalUrl}
                    readOnly
                    dir="ltr"
                    aria-label={crossPostCopy.canonicalUrl}
                    className="min-w-0 flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    title={copiedCrossPostValue === "url" ? crossPostCopy.copied : crossPostCopy.canonicalUrl}
                    aria-label={copiedCrossPostValue === "url" ? crossPostCopy.copied : crossPostCopy.canonicalUrl}
                    onClick={() => void copyCrossPostValue("url", crossPostPreview.canonicalUrl!)}
                  >
                    {copiedCrossPostValue === "url" ? <CheckIcon /> : <CopyIcon />}
                  </Button>
                  {status === "published" ? (
                    <Button
                      render={
                        <a
                          href={crossPostPreview.canonicalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        />
                      }
                      nativeButton={false}
                      variant="outline"
                      size="icon-sm"
                      title={crossPostCopy.openWebsite}
                      aria-label={crossPostCopy.openWebsite}
                    >
                      <ExternalLinkIcon />
                    </Button>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{crossPostCopy.noCanonicalUrl}</p>
              )}
            </section>

            <section className="min-w-0 space-y-3" aria-labelledby="cross-post-x">
              <p id="cross-post-x" className="text-sm font-medium">
                {crossPostCopy.xDraft}
              </p>
              <Field>
                <FieldLabel htmlFor="cross-post-hashtags" className="text-xs text-muted-foreground">
                  {crossPostCopy.hashtags}
                </FieldLabel>
                <Input
                  id="cross-post-hashtags"
                  value={xHashtags}
                  onChange={(event) => setXHashtags(event.target.value)}
                  placeholder={crossPostCopy.hashtagsPlaceholder}
                  dir="ltr"
                />
              </Field>
              <Textarea
                value={xDraft}
                onChange={(event) =>
                  setXDraftOverride({ source: crossPostPreview.socialText, value: event.target.value })
                }
                rows={4}
                dir="auto"
                aria-label={crossPostCopy.xDraft}
                placeholder={crossPostCopy.noXDraft}
                className="resize-y"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={!xDraft}
                  onClick={() => void copyCrossPostValue("x", xDraft)}
                >
                  {copiedCrossPostValue === "x" ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
                  <span aria-live="polite">
                    {copiedCrossPostValue === "x" ? crossPostCopy.copied : crossPostCopy.copyDraft}
                  </span>
                </Button>
                {xIntentUrl ? (
                  <Button
                    render={<a href={xIntentUrl} target="_blank" rel="noopener noreferrer" />}
                    nativeButton={false}
                    variant="outline"
                  >
                    <ExternalLinkIcon data-icon="inline-start" />
                    {crossPostCopy.openX}
                  </Button>
                ) : (
                  <Button type="button" variant="outline" disabled>
                    <ExternalLinkIcon data-icon="inline-start" />
                    {crossPostCopy.openX}
                  </Button>
                )}
              </div>
            </section>
          </div>

          <section className="min-w-0 space-y-3" aria-labelledby="cross-post-discord">
            <p id="cross-post-discord" className="text-sm font-medium">
              {crossPostCopy.discord}
            </p>
            <article className="overflow-hidden rounded-md border border-[#202225] bg-[#2b2d31] text-[#f2f3f5]">
              <div className="flex min-w-0 gap-3 border-l-4 border-[#5865f2] p-4">
                <div className="min-w-0 flex-1 space-y-2">
                  {discordPreview.byline ? (
                    <div className="flex items-center gap-2 text-xs text-[#dbdee1]">
                      {discordPreview.authorIconUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- safe http(s) URL from the shared Discord payload builder
                        <img src={discordPreview.authorIconUrl} alt="" className="size-5 rounded-full object-cover" />
                      ) : null}
                      <span>{discordPreview.byline}</span>
                    </div>
                  ) : null}
                  {discordPreview.url ? (
                    <a
                      href={discordPreview.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block break-words font-semibold text-[#00a8fc] hover:underline"
                    >
                      {discordPreview.title}
                    </a>
                  ) : (
                    <h3 className="break-words font-semibold">{discordPreview.title}</h3>
                  )}
                  {discordPreview.description ? (
                    <p className="whitespace-pre-wrap break-words text-sm leading-5 text-[#dbdee1]">
                      {discordPreview.description}
                    </p>
                  ) : null}
                  {discordPreview.footer || discordPreview.timestamp !== null ? (
                    <p className="text-xs text-[#b5bac1]">
                      {[discordPreview.footer, discordPreview.timestamp !== null
                        ? new Intl.DateTimeFormat(locale === "ar" ? "ar-SA" : "en-US", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          }).format(discordPreview.timestamp)
                        : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  ) : null}
                  {discordPreview.url ? (
                    <a
                      href={discordPreview.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-8 items-center rounded-sm bg-[#5865f2] px-3 text-sm font-medium text-white hover:bg-[#4752c4]"
                    >
                      {discordPreview.readMoreLabel || crossPostCopy.readMore}
                    </a>
                  ) : null}
                </div>
                {discordPreview.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- safe http(s) URL from the shared Discord payload builder
                  <img
                    src={discordPreview.imageUrl}
                    alt=""
                    className="hidden aspect-square size-24 rounded object-cover sm:block"
                  />
                ) : null}
              </div>
            </article>
          </section>
        </CardContent>
      </Card>

      {/* Sticky action bar: the form is tall, so the save/publish controls and any
          save error stay visible without scrolling to the bottom. */}
      <div className="sticky bottom-3 z-20 flex w-fit max-w-full flex-col gap-2 rounded-xl border bg-card/95 p-2 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/85">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>{t.couldNotSave}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {notice ? (
          <Alert>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => persist("draft", "draft")}
            disabled={!canSave || busy !== null}
            variant="outline"
          >
            {busy === "draft" ? (
              <Loader2Icon data-icon="inline-start" className="animate-spin" />
            ) : (
              <SaveIcon data-icon="inline-start" />
            )}
            {mode === "edit" && status === "published" ? t.saveAsDraft : t.saveDraft}
          </Button>
          <Button onClick={() => persist("published", "publish")} disabled={!canPublish || busy !== null}>
            {busy === "publish" ? (
              <Loader2Icon data-icon="inline-start" className="animate-spin" />
            ) : (
              <SendIcon data-icon="inline-start" />
            )}
            {mode === "edit" && status === "published" ? t.updatePublished : t.publish}
          </Button>
          <Button
            onClick={() => persist("scheduled", "schedule")}
            disabled={!canSchedule || busy !== null}
            variant="outline"
          >
            {busy === "schedule" ? (
              <Loader2Icon data-icon="inline-start" className="animate-spin" />
            ) : (
              <CalendarClockIcon data-icon="inline-start" />
            )}
            {status === "scheduled" ? scheduleCopy.update : scheduleCopy.action}
          </Button>
          {mode === "edit" && status === "published" ? (
            <Button onClick={() => persist("draft", "unpublish")} disabled={busy !== null} variant="outline">
              <EyeOffIcon data-icon="inline-start" />
              {t.unpublish}
            </Button>
          ) : null}
          {isDirty && busy === null ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span aria-hidden className="size-1.5 rounded-full bg-amber-500" />
              {t.unsavedChanges}
            </span>
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
                {t.delete}
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <ImageCropDialog
        open={cropOpen}
        file={cropFile}
        locale={locale}
        copy={cropCopy}
        defaultAspect={bodyCropPendingRef.current ? "16:9" : "5:2"}
        onApply={onCropApply}
        onCancel={() => {
          setCropOpen(false);
          bodyCropPendingRef.current = false;
        }}
      />

      {/* Crop-or-upload-as-is choice for body images (replaces window.confirm). */}
      <ConfirmDialog
        open={cropChoiceFile !== null}
        onOpenChange={(open) => {
          if (!open) setCropChoiceFile(null);
        }}
        title={t.cropBeforeUpload}
        description={t.cropBeforeUploadBody}
        cancelLabel={t.confirmCancel}
        actions={
          cropChoiceFile
            ? [
                {
                  label: t.cropBeforeUploadAsIs,
                  variant: "outline",
                  onClick: () => uploadBodyAsIs(cropChoiceFile),
                },
                {
                  label: t.cropBeforeUploadCrop,
                  onClick: () => startBodyCrop(cropChoiceFile),
                },
              ]
            : []
        }
      />

      {/* Shared-mode discard confirm (replaces window.confirm). */}
      <ConfirmDialog
        open={discardConfirmOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDiscardConfirmOpen(false);
            pendingPersistRef.current = null;
          }
        }}
        title={t.discardTitle}
        description={t.sharedDiscardConfirm}
        cancelLabel={t.confirmCancel}
        actions={[
          {
            label: t.discardConfirmAction,
            onClick: () => {
              const pending = pendingPersistRef.current;
              pendingPersistRef.current = null;
              setDiscardConfirmOpen(false);
              if (pending) void persistConfirmed(pending.targetStatus, pending.action);
            },
          },
        ]}
      />

      {/* Delete confirm (replaces window.confirm). */}
      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title={t.deleteTitle}
        description={t.deleteConfirm}
        cancelLabel={t.confirmCancel}
        actions={[
          {
            label: t.deleteConfirmAction,
            variant: "destructive",
            onClick: () => void removeConfirmed(),
          },
        ]}
      />
    </div>
  );
}
