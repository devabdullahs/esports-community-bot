"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  BookOpenIcon,
  BotIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleDotDashedIcon,
  CopyIcon,
  FileTextIcon,
  LinkIcon,
  SparklesIcon,
  WandSparklesIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Locale } from "@/lib/i18n";
import { buildMcpAssistantUrl } from "@/lib/mcp-assistant-links";

async function writeClipboard(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    const el = document.createElement("textarea");
    el.value = value;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.left = "-9999px";
    document.body.appendChild(el);
    el.select();
    try {
      document.execCommand("copy");
    } finally {
      document.body.removeChild(el);
    }
  }
}

const COPY = {
  en: {
    docs: "Docs",
    copied: "Copied",
    copyPage: "Copy Page",
    moreActions: "More MCP copy actions",
    viewMarkdown: "View as Markdown",
    copyMcpUrl: "Copy MCP URL",
    copiedMcpUrl: "Copied MCP URL",
    openV0: "Open in v0",
    openChatGpt: "Open in ChatGPT",
    openClaude: "Open in Claude",
    openScira: "Open in Scira",
  },
  ar: {
    docs: "الشرح",
    copied: "تم النسخ",
    copyPage: "نسخ الصفحة",
    moreActions: "خيارات MCP إضافية",
    viewMarkdown: "عرض كـ Markdown",
    copyMcpUrl: "نسخ رابط MCP",
    copiedMcpUrl: "تم نسخ رابط MCP",
    openV0: "فتح في v0",
    openChatGpt: "فتح في ChatGPT",
    openClaude: "فتح في Claude",
    openScira: "فتح في Scira",
  },
} satisfies Record<Locale, Record<string, string>>;

export function McpPageActions({
  markdown = "",
  docsHref = "/docs/admin-mcp",
  locale = "en",
  variant = "docs",
  showDocsLink = true,
}: {
  markdown?: string;
  docsHref?: string;
  locale?: Locale;
  variant?: "keys" | "docs";
  showDocsLink?: boolean;
}) {
  const [copied, setCopied] = useState<"page" | "endpoint" | null>(null);
  const text = COPY[locale];
  const endpoint = useMemo(() => {
    if (typeof window === "undefined") return "/api/mcp";
    return new URL("/api/mcp", window.location.origin).toString();
  }, []);
  const docsUrl = useMemo(() => {
    if (typeof window === "undefined") return docsHref;
    return new URL(docsHref, window.location.origin).toString();
  }, [docsHref]);

  const copyValue = useCallback(async (kind: NonNullable<typeof copied>, value: string) => {
    await writeClipboard(value);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1600);
  }, []);

  const viewMarkdown = useCallback(() => {
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }, [markdown]);

  const openAssistant = useCallback(
    (url: string) => {
      window.open(buildMcpAssistantUrl(url, docsUrl, locale), "_blank", "noopener,noreferrer");
    },
    [docsUrl, locale],
  );

  if (variant === "keys") {
    return showDocsLink ? (
      <Button
        render={<Link href={docsHref} />}
        nativeButton={false}
        variant="outline"
        size="sm"
      >
        <BookOpenIcon data-icon="inline-start" />
        {text.docs}
      </Button>
    ) : null;
  }

  return (
    <div className="flex w-full items-stretch gap-1 sm:w-auto">
      {showDocsLink ? (
        <Button
          render={<Link href={docsHref} />}
          nativeButton={false}
          variant="outline"
          size="sm"
          className="flex-1 sm:flex-none"
        >
          <BookOpenIcon data-icon="inline-start" />
          {text.docs}
        </Button>
      ) : null}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="flex-1 sm:flex-none"
        onClick={() => copyValue("page", markdown)}
      >
        {copied === "page" ? (
          <CheckIcon data-icon="inline-start" />
        ) : (
          <CopyIcon data-icon="inline-start" />
        )}
        <span aria-live="polite">{copied === "page" ? text.copied : text.copyPage}</span>
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label={text.moreActions}
            />
          }
        >
          <ChevronDownIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={viewMarkdown}>
              <FileTextIcon />
              {text.viewMarkdown}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => copyValue("endpoint", endpoint)}>
              {copied === "endpoint" ? <CheckIcon /> : <LinkIcon />}
              {copied === "endpoint" ? text.copiedMcpUrl : text.copyMcpUrl}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => openAssistant("https://v0.dev/")}>
              <SparklesIcon />
              {text.openV0}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openAssistant("https://chatgpt.com/")}>
              <BotIcon />
              {text.openChatGpt}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openAssistant("https://claude.ai/new")}>
              <WandSparklesIcon />
              {text.openClaude}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openAssistant("https://scira.ai/")}>
              <CircleDotDashedIcon />
              {text.openScira}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
