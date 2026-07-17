"use client";

import {
  Gamepad2Icon,
  NewspaperIcon,
  SearchIcon,
  SwordsIcon,
  TrophyIcon,
  type LucideIcon,
  UserRoundIcon,
  UsersIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { copy, type Locale } from "@/lib/i18n";
import { trackProductEvent } from "@/lib/product-analytics";
import {
  PUBLIC_SEARCH_KINDS,
  type PublicSearchKind,
  type PublicSearchResponse,
  type PublicSearchResult,
} from "@/lib/public-search-types";

const KIND_ICONS: Record<PublicSearchKind, LucideIcon> = {
  game: Gamepad2Icon,
  tournament: TrophyIcon,
  match: SwordsIcon,
  team: UsersIcon,
  player: UserRoundIcon,
  news: NewspaperIcon,
};

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true'], [role='textbox']"));
}

function canSearch(value: string) {
  return [...value.trim()].length >= 2;
}

function isPublicSearchResponse(value: unknown): value is PublicSearchResponse {
  if (!value || typeof value !== "object") return false;
  const results = (value as { results?: unknown }).results;
  if (!results || typeof results !== "object") return false;
  return PUBLIC_SEARCH_KINDS.every((kind) => Array.isArray((results as Record<string, unknown>)[kind]));
}

function safeResultHref(value: string) {
  return value.startsWith("/") && !value.startsWith("//") && !/[?#]/u.test(value) ? value : null;
}

export function GlobalSearch({
  locale,
  mobile = false,
  onResultOpen,
}: {
  locale: Locale;
  mobile?: boolean;
  onResultOpen?: () => void;
}) {
  const router = useRouter();
  const strings = copy[locale].common.search;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState<PublicSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const resultCount = useMemo(
    () => PUBLIC_SEARCH_KINDS.reduce((total, kind) => total + (response?.results[kind].length ?? 0), 0),
    [response],
  );

  function setDialogOpen(next: boolean) {
    setOpen(next);
    if (!next) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableTarget(event.target)) return;
      const isCommand = (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "k";
      const isSlash = !event.ctrlKey && !event.metaKey && !event.altKey && event.key === "/";
      if (!open && (isCommand || isSlash)) {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      window.requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open || !canSearch(query)) {
      return undefined;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(false);
      try {
        const params = new URLSearchParams({ q: query, locale });
        const result = await fetch(`/api/search?${params.toString()}`, { signal: controller.signal });
        if (!result.ok) throw new Error("Search request failed.");
        const data: unknown = await result.json();
        if (!isPublicSearchResponse(data)) throw new Error("Invalid search response.");
        setResponse(data);
      } catch (requestError) {
        if ((requestError as { name?: string }).name !== "AbortError") {
          setResponse(null);
          setError(true);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [locale, open, query]);

  function handleQueryChange(value: string) {
    setQuery(value);
    if (!canSearch(value)) {
      setResponse(null);
      setLoading(false);
      setError(false);
    }
  }

  function openResult(result: PublicSearchResult) {
    const href = safeResultHref(result.href);
    if (!href) return;
    setOpen(false);
    router.push(href);
    trackProductEvent("site_search_result_open");
    onResultOpen?.();
  }

  const searching = loading && open && canSearch(query);
  const status = error
    ? strings.error
    : searching
      ? strings.loading
      : canSearch(query) && response
        ? resultCount ? strings.resultCount(resultCount) : strings.empty
        : strings.hint;

  return (
    <>
      <Button
        ref={triggerRef}
        variant={mobile ? "outline" : "ghost"}
        size="sm"
        className={mobile ? "w-full justify-start" : "hidden size-9 px-0 lg:inline-flex"}
        aria-label={strings.trigger}
        title={strings.trigger}
        onClick={() => setDialogOpen(true)}
      >
        <SearchIcon />
        {mobile ? <span>{strings.trigger}</span> : null}
      </Button>

      <CommandDialog
        open={open}
        onOpenChange={setDialogOpen}
        title={strings.title}
        description={strings.description}
        className="top-[12vh] w-[calc(100vw-2rem)] max-w-xl translate-y-0 sm:top-1/3"
      >
        <Command shouldFilter={false}>
          <CommandInput
            ref={inputRef}
            value={query}
            onValueChange={handleQueryChange}
            placeholder={strings.placeholder}
            aria-label={strings.title}
          />
          <p role="status" aria-live="polite" className="sr-only">
            {status}
          </p>
          <CommandList className="max-h-[min(60vh,28rem)]">
            {searching ? <div className="px-3 py-6 text-center text-sm text-muted-foreground">{strings.loading}</div> : null}
            {error ? <div role="alert" className="px-3 py-6 text-center text-sm text-destructive">{strings.error}</div> : null}
            {!searching && !error && canSearch(query) && response && resultCount === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">{strings.empty}</div>
            ) : null}
            {!searching && !error && response
              ? PUBLIC_SEARCH_KINDS.map((kind) => {
                  const results = response.results[kind];
                  if (!results.length) return null;
                  const Icon = KIND_ICONS[kind];
                  return (
                    <CommandGroup key={kind} heading={strings.groups[kind]}>
                      {results.map((result) => (
                        <CommandItem
                          key={`${result.kind}-${result.id}`}
                          value={`${result.kind}-${result.id}`}
                          onSelect={() => openResult(result)}
                          className="min-h-12 items-start py-2"
                        >
                          <Icon className="mt-0.5 text-muted-foreground" />
                          <span className="min-w-0 flex-1">
                            <bdi dir="auto" className="block truncate font-medium">{result.title}</bdi>
                            {result.subtitle ? (
                              <bdi dir="auto" className="block truncate text-xs text-muted-foreground">{result.subtitle}</bdi>
                            ) : null}
                          </span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  );
                })
              : null}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
