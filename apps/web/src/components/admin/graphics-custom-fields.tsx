"use client";

import { useRef, useState } from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ImagePlusIcon,
  LoaderCircleIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type {
  CustomGraphicsInputMap,
  CustomMatchGraphicInput,
  CustomNewsGraphicInput,
  CustomStandingsEntry,
  CustomStandingsGraphicInput,
  GraphicsTemplateId,
} from "@/lib/graphics-generator-model";

type Props = {
  template: GraphicsTemplateId;
  values: CustomGraphicsInputMap;
  onChange: (values: CustomGraphicsInputMap) => void;
  uploadAsset: (file: File) => Promise<string>;
};

function LogoUpload({
  label,
  value,
  onChange,
  uploadAsset,
}: {
  label: string;
  value: string | null;
  onChange: (url: string | null) => void;
  uploadAsset: (file: File) => Promise<string>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function upload(file: File) {
    setUploading(true);
    try {
      onChange(await uploadAsset(file));
    } catch {
      // The parent exposes the upload error beside the editor controls.
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex items-center gap-2">
      {value ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={value} alt="" className="size-9 shrink-0 object-contain" />
      ) : (
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground">
          <ImagePlusIcon className="size-4" />
        </span>
      )}
      <Input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => inputRef.current?.click()}>
        {uploading ? <LoaderCircleIcon className="animate-spin" /> : <ImagePlusIcon />}
        {value ? `Replace ${label}` : `Add ${label}`}
      </Button>
      {value ? <Button type="button" variant="ghost" size="icon-sm" onClick={() => onChange(null)} aria-label={`Remove ${label}`}><XIcon /></Button> : null}
    </div>
  );
}

function MatchFields({ value, onChange, uploadAsset }: {
  value: CustomMatchGraphicInput;
  onChange: (value: CustomMatchGraphicInput) => void;
  uploadAsset: (file: File) => Promise<string>;
}) {
  const patch = (next: Partial<CustomMatchGraphicInput>) => onChange({ ...value, ...next });
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field><FieldLabel>Tournament or event</FieldLabel><Input value={value.tournament} maxLength={260} onChange={(event) => patch({ tournament: event.target.value })} /></Field>
        <Field><FieldLabel>Game</FieldLabel><Input value={value.game} maxLength={80} onChange={(event) => patch({ game: event.target.value })} /></Field>
      </div>
      {(["A", "B"] as const).map((side) => {
        const teamKey = side === "A" ? "teamA" : "teamB";
        const logoKey = side === "A" ? "logoA" : "logoB";
        return (
          <div key={side} className="grid gap-3 rounded-lg border border-border bg-background/45 p-3">
            <Field><FieldLabel>Team {side}</FieldLabel><Input value={value[teamKey]} maxLength={80} onChange={(event) => patch({ [teamKey]: event.target.value })} /></Field>
            <LogoUpload label={`team ${side} logo`} value={value[logoKey]} onChange={(url) => patch({ [logoKey]: url })} uploadAsset={uploadAsset} />
          </div>
        );
      })}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel>Score display</FieldLabel>
          <ToggleGroup value={[value.scoreMode]} onValueChange={(values) => values[0] && patch({ scoreMode: values[0] as "versus" | "score", scoreA: values[0] === "score" ? value.scoreA ?? 0 : null, scoreB: values[0] === "score" ? value.scoreB ?? 0 : null })} variant="outline" spacing={0} className="grid grid-cols-2">
            <ToggleGroupItem value="versus">VS</ToggleGroupItem>
            <ToggleGroupItem value="score">Score</ToggleGroupItem>
          </ToggleGroup>
        </Field>
        <Field>
          <FieldLabel>Status</FieldLabel>
          <Select value={value.status} onValueChange={(status) => status && patch({ status: status as CustomMatchGraphicInput["status"] })}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="upcoming">Upcoming</SelectItem><SelectItem value="live">Live</SelectItem><SelectItem value="finished">Final</SelectItem></SelectContent>
          </Select>
        </Field>
      </div>
      {value.scoreMode === "score" ? (
        <div className="grid grid-cols-2 gap-3">
          <Field><FieldLabel>Team A score</FieldLabel><Input type="number" min={0} max={999} value={value.scoreA ?? 0} onChange={(event) => patch({ scoreA: Number(event.target.value) })} /></Field>
          <Field><FieldLabel>Team B score</FieldLabel><Input type="number" min={0} max={999} value={value.scoreB ?? 0} onChange={(event) => patch({ scoreB: Number(event.target.value) })} /></Field>
        </div>
      ) : null}
    </div>
  );
}

function StandingsFields({ value, onChange, uploadAsset }: {
  value: CustomStandingsGraphicInput;
  onChange: (value: CustomStandingsGraphicInput) => void;
  uploadAsset: (file: File) => Promise<string>;
}) {
  function updateEntry(index: number, next: Partial<CustomStandingsEntry>) {
    onChange({ ...value, entries: value.entries.map((entry, candidate) => candidate === index ? { ...entry, ...next } : entry) });
  }
  function moveEntry(index: number, offset: number) {
    const target = index + offset;
    if (target < 0 || target >= value.entries.length) return;
    const entries = [...value.entries];
    [entries[index], entries[target]] = [entries[target], entries[index]];
    onChange({ ...value, entries });
  }
  return (
    <div className="grid gap-4">
      <Field><FieldLabel>Tournament or event</FieldLabel><Input value={value.tournament} maxLength={260} onChange={(event) => onChange({ ...value, tournament: event.target.value })} /></Field>
      <Field><FieldLabel>Table title</FieldLabel><Input value={value.section} maxLength={100} placeholder="Final standings or Battle Royale points" onChange={(event) => onChange({ ...value, section: event.target.value })} /></Field>
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-3"><FieldLabel>Rows</FieldLabel><span className="text-xs text-muted-foreground">{value.entries.length}/12</span></div>
        {value.entries.map((entry, index) => (
          <div key={index} className="grid gap-2 rounded-lg border border-border bg-background/45 p-3">
            <div className="grid grid-cols-[64px_minmax(0,1fr)_90px] gap-2">
              <Field><FieldLabel>Rank</FieldLabel><Input type="number" min={1} max={999} value={entry.rank} onChange={(event) => updateEntry(index, { rank: Number(event.target.value) })} /></Field>
              <Field><FieldLabel>Team</FieldLabel><Input value={entry.team} maxLength={80} onChange={(event) => updateEntry(index, { team: event.target.value })} /></Field>
              <Field><FieldLabel>Points</FieldLabel><Input value={entry.points} maxLength={32} onChange={(event) => updateEntry(index, { points: event.target.value })} /></Field>
            </div>
            <Field><FieldLabel>Extra stat (optional)</FieldLabel><Input value={entry.extra} maxLength={32} placeholder="Kills, record, or placement" onChange={(event) => updateEntry(index, { extra: event.target.value })} /></Field>
            <div className="flex flex-wrap items-center gap-1.5">
              <LogoUpload label="logo" value={entry.logo} onChange={(logo) => updateEntry(index, { logo })} uploadAsset={uploadAsset} />
              <span className="flex-1" />
              <Button type="button" variant="ghost" size="icon-sm" disabled={index === 0} onClick={() => moveEntry(index, -1)} aria-label="Move row up"><ArrowUpIcon /></Button>
              <Button type="button" variant="ghost" size="icon-sm" disabled={index === value.entries.length - 1} onClick={() => moveEntry(index, 1)} aria-label="Move row down"><ArrowDownIcon /></Button>
              <Button type="button" variant="ghost" size="icon-sm" disabled={value.entries.length === 1} onClick={() => onChange({ ...value, entries: value.entries.filter((_, candidate) => candidate !== index) })} aria-label="Remove row"><Trash2Icon /></Button>
            </div>
          </div>
        ))}
        <Button type="button" variant="outline" disabled={value.entries.length >= 12} onClick={() => onChange({ ...value, entries: [...value.entries, { rank: value.entries.length + 1, team: `Team ${value.entries.length + 1}`, logo: null, points: "0", extra: "" }] })}>
          <PlusIcon />Add row
        </Button>
      </div>
    </div>
  );
}

function NewsFields({ value, onChange }: { value: CustomNewsGraphicInput; onChange: (value: CustomNewsGraphicInput) => void }) {
  return (
    <div className="grid gap-3">
      <Field><FieldLabel>Category or publisher</FieldLabel><Input value={value.owner} maxLength={80} onChange={(event) => onChange({ ...value, owner: event.target.value })} /></Field>
      <Field><FieldLabel>Headline</FieldLabel><Textarea value={value.title} maxLength={220} rows={3} onChange={(event) => onChange({ ...value, title: event.target.value })} /></Field>
      <Field><FieldLabel>Summary</FieldLabel><Textarea value={value.summary} maxLength={360} rows={4} onChange={(event) => onChange({ ...value, summary: event.target.value })} /></Field>
    </div>
  );
}

export function GraphicsCustomFields({ template, values, onChange, uploadAsset }: Props) {
  if (template === "match-result") {
    return <MatchFields value={values[template]} onChange={(value) => onChange({ ...values, [template]: value })} uploadAsset={uploadAsset} />;
  }
  if (template === "standings") {
    return <StandingsFields value={values[template]} onChange={(value) => onChange({ ...values, [template]: value })} uploadAsset={uploadAsset} />;
  }
  return <NewsFields value={values[template]} onChange={(value) => onChange({ ...values, [template]: value })} />;
}
