"use client";

import { useId, useMemo, useState } from "react";
import { CheckIcon, ChevronsUpDownIcon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type ScopeOption = { slug: string; label: string };

// Searchable multi-select for game/media scopes (plan 075): Command inside a
// Popover, selected entries as removable badges, bulk select-visible/clear.
export function McpScopePicker({
  label,
  description,
  options,
  selected,
  onToggle,
  onSelectVisible,
  onClear,
  placeholder,
  searchPlaceholder,
  emptyLabel,
  selectVisibleLabel,
  clearLabel,
  selectedCountLabel,
  removeLabel,
  disabled = false,
}: {
  label: string;
  description?: string;
  options: ScopeOption[];
  selected: string[];
  onToggle: (slug: string) => void;
  onSelectVisible: (slugs: string[]) => void;
  onClear: () => void;
  placeholder: string;
  searchPlaceholder: string;
  emptyLabel: string;
  selectVisibleLabel: string;
  clearLabel: string;
  selectedCountLabel: (count: number) => string;
  removeLabel: (label: string) => string;
  disabled?: boolean;
}) {
  const triggerId = useId();
  const descriptionId = `${triggerId}-description`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (option) => option.label.toLowerCase().includes(q) || option.slug.toLowerCase().includes(q),
    );
  }, [options, query]);
  const selectedOptions = options.filter((option) => selectedSet.has(option.slug));

  return (
    <Field data-disabled={disabled || options.length === 0}>
      <FieldLabel htmlFor={triggerId}>{label}</FieldLabel>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              id={triggerId}
              type="button"
              variant="outline"
              disabled={disabled || options.length === 0}
              aria-expanded={open}
              aria-describedby={description ? descriptionId : undefined}
              className="w-full justify-between font-normal"
            />
          }
        >
          <span className={cn("truncate", selected.length === 0 && "text-muted-foreground")}>
            {selected.length > 0 ? selectedCountLabel(selected.length) : placeholder}
          </span>
          <ChevronsUpDownIcon className="shrink-0 opacity-50" data-icon="inline-end" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(90vw,20rem)] p-0">
          <Command shouldFilter={false}>
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder={searchPlaceholder}
            />
            <CommandList>
              <CommandEmpty>{emptyLabel}</CommandEmpty>
              <CommandGroup>
                {visible.map((option) => {
                  const on = selectedSet.has(option.slug);
                  return (
                    <CommandItem
                      key={option.slug}
                      value={option.slug}
                      onSelect={() => onToggle(option.slug)}
                      aria-selected={on}
                    >
                      <CheckIcon className={cn(on ? "opacity-100" : "opacity-0")} />
                      <span className="min-w-0 flex-1 truncate">{option.label}</span>
                      <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                        {option.slug}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
            <div className="flex items-center justify-between gap-2 border-t border-border p-2 text-xs">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={visible.length === 0}
                onClick={() => onSelectVisible(visible.map((option) => option.slug))}
              >
                {selectVisibleLabel}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={selected.length === 0}
                onClick={onClear}
              >
                {clearLabel}
              </Button>
            </div>
          </Command>
        </PopoverContent>
      </Popover>
      {selectedOptions.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selectedOptions.map((option) => (
            <Badge key={option.slug} variant="secondary" className="gap-1 pe-1">
              <span className="max-w-40 truncate">{option.label}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => onToggle(option.slug)}
                aria-label={removeLabel(option.label)}
              >
                <XIcon />
              </Button>
            </Badge>
          ))}
        </div>
      ) : null}
      {description ? <FieldDescription id={descriptionId}>{description}</FieldDescription> : null}
    </Field>
  );
}
