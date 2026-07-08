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

export function McpPageActions({
  markdown = "",
  variant = "docs",
  showDocsLink = true,
}: {
  markdown?: string;
  variant?: "keys" | "docs";
  showDocsLink?: boolean;
}) {
  const [copied, setCopied] = useState<"page" | "endpoint" | "assistant" | null>(null);
  const endpoint = useMemo(() => {
    if (typeof window === "undefined") return "/api/mcp";
    return new URL("/api/mcp", window.location.origin).toString();
  }, []);

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
    async (url: string) => {
      const opened = window.open(url, "_blank", "noopener,noreferrer");
      await writeClipboard(
        `Use this Admin MCP documentation and help me configure or use the Esports Community MCP server:\n\n${markdown}`,
      );
      setCopied("assistant");
      if (!opened) window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => setCopied(null), 1600);
    },
    [markdown],
  );

  if (variant === "keys") {
    return showDocsLink ? (
      <Button
        render={<Link href="/admin/mcp/docs" />}
        nativeButton={false}
        variant="outline"
        size="sm"
      >
        <BookOpenIcon data-icon="inline-start" />
        Docs
      </Button>
    ) : null;
  }

  return (
    <div className="flex w-full items-stretch gap-1 sm:w-auto">
      {showDocsLink ? (
        <Button
          render={<Link href="/admin/mcp/docs" />}
          nativeButton={false}
          variant="outline"
          size="sm"
          className="flex-1 sm:flex-none"
        >
          <BookOpenIcon data-icon="inline-start" />
          Docs
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
        <span aria-live="polite">{copied === "page" ? "Copied" : "Copy Page"}</span>
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label="More MCP copy actions"
            />
          }
        >
          <ChevronDownIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={viewMarkdown}>
              <FileTextIcon />
              View as Markdown
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => copyValue("endpoint", endpoint)}>
              {copied === "endpoint" ? <CheckIcon /> : <LinkIcon />}
              {copied === "endpoint" ? "Copied MCP URL" : "Copy MCP URL"}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => openAssistant("https://v0.dev/chat")}>
              <SparklesIcon />
              {copied === "assistant" ? "Copied context" : "Open in v0"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openAssistant("https://chatgpt.com/")}>
              <BotIcon />
              Open in ChatGPT
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openAssistant("https://claude.ai/new")}>
              <WandSparklesIcon />
              Open in Claude
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openAssistant("https://scira.ai/")}>
              <CircleDotDashedIcon />
              Open in Scira
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
