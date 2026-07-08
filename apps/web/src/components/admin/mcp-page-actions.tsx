"use client";

import { useCallback, useMemo, useState } from "react";
import { CheckIcon, ChevronDownIcon, CopyIcon, FileTextIcon, LinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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

export function McpPageActions({ markdown }: { markdown: string }) {
  const [copied, setCopied] = useState<"page" | "markdown" | "endpoint" | null>(null);
  const endpoint = useMemo(() => {
    if (typeof window === "undefined") return "/api/mcp";
    return new URL("/api/mcp", window.location.origin).toString();
  }, []);

  const copyValue = useCallback(async (kind: NonNullable<typeof copied>, value: string) => {
    await writeClipboard(value);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1600);
  }, []);

  return (
    <div className="flex w-full items-stretch gap-1 sm:w-auto">
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
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onClick={() => copyValue("markdown", markdown)}>
            {copied === "markdown" ? <CheckIcon /> : <FileTextIcon />}
            {copied === "markdown" ? "Copied Markdown" : "Copy Markdown"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => copyValue("endpoint", endpoint)}>
            {copied === "endpoint" ? <CheckIcon /> : <LinkIcon />}
            {copied === "endpoint" ? "Copied MCP URL" : "Copy MCP URL"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
