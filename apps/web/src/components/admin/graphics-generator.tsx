"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import Image from "next/image";
import {
  ArrowDownLeftIcon,
  ArrowDownRightIcon,
  ArrowUpLeftIcon,
  ArrowUpRightIcon,
  CheckIcon,
  DownloadIcon,
  ExpandIcon,
  Grid3X3Icon,
  ImageIcon,
  LoaderCircleIcon,
  MaximizeIcon,
  MinusIcon,
  MoveIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  SparklesIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  DEFAULT_GRAPHICS_RENDER_OPTIONS,
  GRAPHICS_ALIGNMENTS,
  GRAPHICS_BRAND_PLACEMENTS,
  GRAPHICS_EXPORT_SCALES,
  GRAPHICS_FORMATS,
  GRAPHICS_LANGUAGES,
  GRAPHICS_STYLES,
  GRAPHICS_TEMPLATES,
  graphicsFormatDimensions,
  graphicsOptionsForTemplate,
  initialGraphicsSelection,
  isGraphicsTemplateId,
  type GraphicsAlignmentId,
  type GraphicsBrandPlacement,
  type GraphicsExportScale,
  type GraphicsFormatId,
  type GraphicsGeneratorData,
  type GraphicsLanguageId,
  type GraphicsRenderOptions,
  type GraphicsStyleId,
  type GraphicsTemplateId,
} from "@/lib/graphics-generator-model";

type RecentGeneration = {
  id: string;
  url: string;
  title: string;
  meta: string;
  createdAt: number;
  template: GraphicsTemplateId;
  resourceId: number;
  options: GraphicsRenderOptions;
};

const STYLE_SWATCHES: Record<GraphicsStyleId, string> = {
  "ewc-teal": "from-[#071412] to-[#134e4a]",
  midnight: "from-[#0b1026] to-[#1e3a8a]",
  carbon: "from-[#111113] to-[#2b2b30]",
  slate: "from-[#1c2226] to-[#3a444b]",
  light: "from-[#e9eceb] to-white",
};

const BRAND_ICONS = {
  "top-left": ArrowUpLeftIcon,
  "top-right": ArrowUpRightIcon,
  "bottom-left": ArrowDownLeftIcon,
  "bottom-right": ArrowDownRightIcon,
  custom: MoveIcon,
} satisfies Record<GraphicsBrandPlacement, typeof MoveIcon>;

function statusCopy(status: "live" | "final" | "soon" | undefined) {
  if (status === "live") return { label: "LIVE", className: "border-red-400/20 bg-red-400/10 text-red-300", dot: "bg-red-400 shadow-[0_0_8px_rgba(248,113,113,.65)]" };
  if (status === "final") return { label: "FINAL", className: "border-teal-400/20 bg-teal-400/10 text-teal-300", dot: "bg-teal-400" };
  return { label: "SOON", className: "border-border bg-muted/40 text-muted-foreground", dot: "bg-muted-foreground/60" };
}

function formatAspectClass(format: GraphicsFormatId) {
  if (format === "1:1") return "aspect-square";
  if (format === "9:16") return "aspect-[9/16]";
  if (format === "4:5") return "aspect-[4/5]";
  return "aspect-video";
}

function formatIconStyle(format: GraphicsFormatId) {
  if (format === "1:1") return { width: 16, height: 16 };
  if (format === "9:16") return { width: 10, height: 18 };
  if (format === "4:5") return { width: 13, height: 17 };
  return { width: 20, height: 12 };
}

export function GraphicsGenerator({ data }: { data: GraphicsGeneratorData }) {
  const [template, setTemplate] = useState<GraphicsTemplateId>("match-result");
  const [resourceId, setResourceId] = useState<number | null>(() => initialGraphicsSelection(data, "match-result"));
  const [query, setQuery] = useState("");
  const [format, setFormat] = useState<GraphicsFormatId>(DEFAULT_GRAPHICS_RENDER_OPTIONS.format);
  const [language, setLanguage] = useState<GraphicsLanguageId>(DEFAULT_GRAPHICS_RENDER_OPTIONS.language);
  const [alignment, setAlignment] = useState<GraphicsAlignmentId>(DEFAULT_GRAPHICS_RENDER_OPTIONS.alignment);
  const [style, setStyle] = useState<GraphicsStyleId>(DEFAULT_GRAPHICS_RENDER_OPTIONS.style);
  const [scale, setScale] = useState<GraphicsExportScale>(DEFAULT_GRAPHICS_RENDER_OPTIONS.scale);
  const [brandPlacement, setBrandPlacement] = useState<GraphicsBrandPlacement>(DEFAULT_GRAPHICS_RENDER_OPTIONS.brandPlacement);
  const [brandX, setBrandX] = useState(DEFAULT_GRAPHICS_RENDER_OPTIONS.brandX);
  const [brandY, setBrandY] = useState(DEFAULT_GRAPHICS_RENDER_OPTIONS.brandY);
  const [brandSize, setBrandSize] = useState(DEFAULT_GRAPHICS_RENDER_OPTIONS.brandSize);
  const [brandMediaSlug, setBrandMediaSlug] = useState<string | null>(DEFAULT_GRAPHICS_RENDER_OPTIONS.brandMediaSlug);
  const [zoom, setZoom] = useState(100);
  const [safeArea, setSafeArea] = useState(true);
  const [showGrid, setShowGrid] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [generatedSignature, setGeneratedSignature] = useState("");
  const [recent, setRecent] = useState<RecentGeneration[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [renderedAt, setRenderedAt] = useState<number | null>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const objectUrls = useRef(new Set<string>());

  const options = useMemo(() => graphicsOptionsForTemplate(data, template), [data, template]);
  const selectedOption = useMemo(() => options.find((option) => option.id === resourceId) ?? null, [options, resourceId]);
  const filteredOptions = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return options;
    return options.filter((option) => `${option.label} ${option.detail}`.toLocaleLowerCase().includes(needle));
  }, [options, query]);
  const dimensions = graphicsFormatDimensions(format);
  const selectedBrand = useMemo(
    () => data.brands.find((brand) => brand.slug === brandMediaSlug) ?? null,
    [brandMediaSlug, data.brands],
  );
  const renderOptions = useMemo<GraphicsRenderOptions>(() => ({
    format, language, alignment, style, scale, brandPlacement, brandX, brandY, brandSize, brandMediaSlug,
  }), [alignment, brandMediaSlug, brandPlacement, brandSize, brandX, brandY, format, language, scale, style]);
  const currentSignature = resourceId ? JSON.stringify({ template, resourceId, ...renderOptions }) : "";
  const previewStale = Boolean(previewUrl && generatedSignature !== currentSignature);
  const canConfigureBrand = data.brands.length > 0 || selectedOption?.owner.kind === "media";

  useEffect(() => () => {
    for (const url of objectUrls.current) URL.revokeObjectURL(url);
  }, []);

  function selectTemplate(value: string | null) {
    if (!isGraphicsTemplateId(value)) return;
    const nextId = initialGraphicsSelection(data, value);
    const nextOption = graphicsOptionsForTemplate(data, value).find((option) => option.id === nextId);
    setTemplate(value);
    setResourceId(nextId);
    setBrandMediaSlug(nextOption?.owner.kind === "media" && data.brands.some((brand) => brand.slug === nextOption.owner.slug)
      ? nextOption.owner.slug
      : null);
    setQuery("");
    setError(null);
  }

  function selectResource(option: (typeof options)[number]) {
    setResourceId(option.id);
    if (option.owner.kind === "media") {
      setBrandMediaSlug(data.brands.some((brand) => brand.slug === option.owner.slug) ? option.owner.slug : null);
    }
  }

  function applyRecent(item: RecentGeneration) {
    setTemplate(item.template);
    setResourceId(item.resourceId);
    setFormat(item.options.format);
    setLanguage(item.options.language);
    setAlignment(item.options.alignment);
    setStyle(item.options.style);
    setScale(item.options.scale);
    setBrandPlacement(item.options.brandPlacement);
    setBrandX(item.options.brandX);
    setBrandY(item.options.brandY);
    setBrandSize(item.options.brandSize);
    setBrandMediaSlug(item.options.brandMediaSlug);
    setPreviewUrl(item.url);
    setGeneratedSignature(JSON.stringify({ template: item.template, resourceId: item.resourceId, ...item.options }));
    setRenderedAt(item.createdAt);
  }

  async function generatePreview() {
    if (resourceId === null) return;
    setRendering(true);
    setError(null);
    const signature = JSON.stringify({ template, resourceId, ...renderOptions });
    try {
      const response = await fetch("/api/admin/graphics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: signature,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || "Unable to generate graphic");
      }
      const image = await response.blob();
      const url = URL.createObjectURL(image);
      objectUrls.current.add(url);
      const createdAt = Date.now();
      setPreviewUrl(url);
      setGeneratedSignature(signature);
      setRenderedAt(createdAt);
      setRecent((items) => [{
        id: `${createdAt}-${resourceId}`,
        url,
        title: selectedOption?.label || "Generated graphic",
        meta: `${GRAPHICS_TEMPLATES.find((item) => item.id === template)?.label} - ${dimensions.label}`,
        createdAt,
        template,
        resourceId,
        options: renderOptions,
      }, ...items].slice(0, 4));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to generate graphic");
    } finally {
      setRendering(false);
    }
  }

  function download(url = previewUrl) {
    if (!url) return;
    const link = document.createElement("a");
    link.href = url;
    link.download = `graphics-${template}-${format.replace(":", "x")}-${scale}x.png`;
    link.click();
  }

  async function toggleFullscreen() {
    if (!workspaceRef.current) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await workspaceRef.current.requestFullscreen();
  }

  function moveBrand(event: ReactPointerEvent<HTMLElement>) {
    if (brandPlacement !== "custom") return;
    const frame = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!frame) return;
    const x = Math.min(95, Math.max(5, ((event.clientX - frame.left) / frame.width) * 100));
    const y = Math.min(95, Math.max(5, ((event.clientY - frame.top) / frame.height) * 100));
    setBrandX(Math.round(x * 10) / 10);
    setBrandY(Math.round(y * 10) / 10);
  }

  return (
    <TooltipProvider>
      <div ref={workspaceRef} className="overflow-hidden rounded-lg border border-border bg-background shadow-sm xl:grid xl:min-h-[760px] xl:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-b border-border bg-card/45 xl:border-b-0 xl:border-e">
          <div className="grid gap-6 p-4 xl:max-h-[calc(100vh-15rem)] xl:overflow-y-auto xl:p-5">
            <div>
              <h2 className="text-lg font-semibold">Graphics generator</h2>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">Create broadcast-ready graphics from stored match and editorial data.</p>
            </div>

            <Field>
              <FieldLabel>Template</FieldLabel>
              <Tabs value={template} onValueChange={selectTemplate}>
                <TabsList className="grid w-full grid-cols-3">
                  {GRAPHICS_TEMPLATES.map((item) => <TabsTrigger key={item.id} value={item.id} className="px-2 text-xs">{item.label}</TabsTrigger>)}
                </TabsList>
              </Tabs>
            </Field>

            <section className="grid gap-2" aria-labelledby="graphics-source-label">
              <div className="flex items-center justify-between gap-3">
                <FieldLabel id="graphics-source-label">Source</FieldLabel>
                <span className="font-mono text-[11px] text-muted-foreground">{options.length} available</span>
              </div>
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search sources" className="ps-9" />
              </div>
              <div className="max-h-60 overflow-y-auto rounded-lg border border-border bg-background/50 p-1" role="listbox" aria-label="Graphics sources">
                {filteredOptions.map((option) => {
                  const status = statusCopy(option.status);
                  return (
                    <button
                      key={option.id}
                      type="button"
                      role="option"
                      aria-selected={resourceId === option.id}
                      onClick={() => selectResource(option)}
                      className={cn("flex min-h-10 w-full items-center gap-2 rounded-md border border-transparent px-2 text-start text-sm transition-colors hover:bg-muted/70", resourceId === option.id && "border-primary/35 bg-primary/10")}
                    >
                      <span className={cn("size-2 shrink-0 rounded-full", status.dot)} />
                      <span className="w-7 shrink-0 font-mono text-[11px] text-muted-foreground">{option.id}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{option.label}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">{option.detail}</span>
                      </span>
                      <Badge variant="outline" className={cn("h-5 px-1.5 font-mono text-[9px]", status.className)}>{status.label}</Badge>
                    </button>
                  );
                })}
                {filteredOptions.length === 0 ? <p className="px-3 py-8 text-center text-sm text-muted-foreground">No matching sources.</p> : null}
              </div>
            </section>

            <Field>
              <FieldLabel>Format</FieldLabel>
              <ToggleGroup value={[format]} onValueChange={(values) => values[0] && setFormat(values[0] as GraphicsFormatId)} className="grid w-full grid-cols-4 gap-1.5">
                {GRAPHICS_FORMATS.map((item) => (
                  <Tooltip key={item.id}>
                    <TooltipTrigger render={<span className="block" />}>
                      <ToggleGroupItem value={item.id} variant="outline" className="h-auto w-full flex-col gap-1 py-2 data-pressed:border-primary/40 data-pressed:bg-primary/10">
                        <span className="rounded-sm border-2 border-current" style={formatIconStyle(item.id)} />
                        <span className="text-[11px] font-medium">{item.label}</span>
                        <span className="font-mono text-[9px] text-muted-foreground">{item.width}x{item.height}</span>
                      </ToggleGroupItem>
                    </TooltipTrigger>
                    <TooltipContent>{item.hint}</TooltipContent>
                  </Tooltip>
                ))}
              </ToggleGroup>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel>Language</FieldLabel>
                <ToggleGroup value={[language]} onValueChange={(values) => values[0] && setLanguage(values[0] as GraphicsLanguageId)} variant="outline" spacing={0} className="grid w-full grid-cols-3">
                  {GRAPHICS_LANGUAGES.map((item) => <ToggleGroupItem key={item} value={item} className="w-full px-2 text-xs uppercase">{item === "ar" ? "Arabic" : item}</ToggleGroupItem>)}
                </ToggleGroup>
              </Field>
              <Field>
                <FieldLabel>Alignment</FieldLabel>
                <Select value={alignment} onValueChange={(value) => value && setAlignment(value as GraphicsAlignmentId)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {GRAPHICS_ALIGNMENTS.map((item) => <SelectItem key={item} value={item}><span className="capitalize">{item}</span></SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <Field>
              <div className="flex items-center justify-between gap-2"><FieldLabel>Visual style</FieldLabel><span className="text-xs font-medium text-primary">{GRAPHICS_STYLES.find((item) => item.id === style)?.label}</span></div>
              <div className="grid grid-cols-5 gap-1.5">
                {GRAPHICS_STYLES.map((item) => (
                  <Tooltip key={item.id}>
                    <TooltipTrigger render={<button type="button" aria-pressed={style === item.id} onClick={() => setStyle(item.id)} className={cn("relative h-12 rounded-lg border bg-gradient-to-br transition-all", STYLE_SWATCHES[item.id], style === item.id ? "border-primary ring-1 ring-primary" : "border-border hover:border-muted-foreground")} />}>
                      {style === item.id ? <span className="absolute inset-0 flex items-center justify-center"><span className="flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground"><CheckIcon className="size-3" /></span></span> : null}
                    </TooltipTrigger>
                    <TooltipContent>{item.label}</TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </Field>

            {canConfigureBrand ? (
              <section className="grid gap-3 rounded-lg border border-border bg-background/45 p-3">
                <div className="flex items-start gap-3">
                  {selectedBrand ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={selectedBrand.logoUrl} alt="" className="size-10 shrink-0 rounded-md border border-border bg-muted/30 object-contain p-1" />
                  ) : null}
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Media branding</p>
                    <p className="text-xs text-muted-foreground">Choose an authorized channel logo, then use a corner preset or drag it anywhere inside the preview.</p>
                  </div>
                </div>
                {data.brands.length ? (
                  <>
                    <Select value={brandMediaSlug ?? "none"} onValueChange={(value) => setBrandMediaSlug(value && value !== "none" ? value : null)}>
                      <SelectTrigger className="w-full"><SelectValue placeholder="No media logo" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No media logo</SelectItem>
                        {data.brands.map((brand) => <SelectItem key={brand.slug} value={brand.slug}>{brand.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {selectedBrand ? (
                      <>
                    <ToggleGroup value={[brandPlacement]} onValueChange={(values) => values[0] && setBrandPlacement(values[0] as GraphicsBrandPlacement)} variant="outline" spacing={0} className="grid w-full grid-cols-5">
                      {GRAPHICS_BRAND_PLACEMENTS.map((item) => {
                        const Icon = BRAND_ICONS[item];
                        return <ToggleGroupItem key={item} value={item} className="w-full px-2" aria-label={item}><Icon /></ToggleGroupItem>;
                      })}
                    </ToggleGroup>
                    {brandPlacement === "custom" ? (
                      <div className="grid gap-3">
                        <label className="grid grid-cols-[48px_1fr_34px] items-center gap-2 text-xs"><span>X</span><Slider value={brandX} min={5} max={95} onValueChange={(value) => typeof value === "number" && setBrandX(value)} /><span className="text-end font-mono">{brandX}%</span></label>
                        <label className="grid grid-cols-[48px_1fr_34px] items-center gap-2 text-xs"><span>Y</span><Slider value={brandY} min={5} max={95} onValueChange={(value) => typeof value === "number" && setBrandY(value)} /><span className="text-end font-mono">{brandY}%</span></label>
                      </div>
                    ) : null}
                    <label className="grid grid-cols-[48px_1fr_34px] items-center gap-2 text-xs"><span>Size</span><Slider value={brandSize} min={5} max={24} onValueChange={(value) => typeof value === "number" && setBrandSize(value)} /><span className="text-end font-mono">{brandSize}%</span></label>
                      </>
                    ) : null}
                  </>
                ) : <p className="text-xs text-muted-foreground">Add a logo to this media channel to enable branding.</p>}
              </section>
            ) : null}

            {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
          </div>

          <div className="mt-auto grid gap-2 border-t border-border p-4 xl:p-5">
            <Button disabled={resourceId === null || rendering} onClick={() => void generatePreview()} className="w-full">
              {rendering ? <LoaderCircleIcon className="animate-spin" data-icon="inline-start" /> : <SparklesIcon data-icon="inline-start" />}
              {rendering ? "Generating..." : "Generate preview"}
            </Button>
            <div className="grid grid-cols-[1fr_72px] gap-2">
              <Button variant="outline" disabled={!previewUrl} onClick={() => download()}><DownloadIcon data-icon="inline-start" />Download PNG</Button>
              <Select value={String(scale)} onValueChange={(value) => value && setScale(Number(value) as GraphicsExportScale)}>
                <SelectTrigger className="w-full font-mono"><SelectValue /></SelectTrigger>
                <SelectContent>{GRAPHICS_EXPORT_SCALES.map((item) => <SelectItem key={item} value={String(item)}>{item}x</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
        </aside>

        <section className="flex min-h-[620px] min-w-0 flex-col bg-background">
          <div className="flex min-h-13 items-center gap-2 overflow-x-auto border-b border-border px-3 py-2">
            <div className="flex shrink-0 items-center rounded-lg border border-border bg-card">
              <Button variant="ghost" size="icon-sm" onClick={() => setZoom((value) => Math.max(30, value - 10))} aria-label="Zoom out"><MinusIcon /></Button>
              <span className="w-14 text-center font-mono text-xs">{zoom}%</span>
              <Button variant="ghost" size="icon-sm" onClick={() => setZoom((value) => Math.min(200, value + 10))} aria-label="Zoom in"><PlusIcon /></Button>
            </div>
            <Button variant="outline" size="sm" onClick={() => setZoom(100)}><MaximizeIcon data-icon="inline-start" />Fit</Button>
            <span className="mx-1 h-6 w-px shrink-0 bg-border" />
            <label className="flex h-8 shrink-0 items-center gap-2 rounded-lg border border-border bg-card px-2.5 text-xs"><span>Safe area</span><Switch checked={safeArea} onCheckedChange={setSafeArea} size="sm" /></label>
            <Button variant={showGrid ? "secondary" : "outline"} size="sm" onClick={() => setShowGrid((value) => !value)}><Grid3X3Icon data-icon="inline-start" />Grid</Button>
            <div className="ms-auto flex shrink-0 items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">{dimensions.width}x{dimensions.height}</span>
              <Button variant="outline" size="sm" disabled={resourceId === null || rendering} onClick={() => void generatePreview()}><RefreshCwIcon data-icon="inline-start" className={cn(rendering && "animate-spin")} />Refresh</Button>
              <Button variant="outline" size="icon-sm" onClick={() => void toggleFullscreen()} aria-label="Toggle fullscreen"><ExpandIcon /></Button>
            </div>
          </div>

          <div className="relative flex min-h-[470px] flex-1 items-center justify-center overflow-auto bg-[radial-gradient(ellipse_at_50%_0%,color-mix(in_oklab,var(--muted)_25%,transparent),transparent_62%)] p-5 sm:p-8">
            <div className={cn("relative max-h-[68vh] w-full max-w-[940px] overflow-hidden rounded-lg border border-border bg-card shadow-2xl transition-[aspect-ratio,transform]", formatAspectClass(format), (format === "9:16" || format === "4:5") && "w-auto max-w-none")} style={{ transform: `scale(${zoom / 100})`, height: format === "9:16" ? "min(68vh,760px)" : format === "4:5" ? "min(68vh,700px)" : undefined }}>
              {previewUrl ? <Image src={previewUrl} alt="Generated social graphic" fill unoptimized className="object-contain" /> : <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground"><ImageIcon className="size-8" /><p className="text-sm">Generate a preview to see the final graphic.</p></div>}
              {previewStale ? <div className="absolute inset-x-3 top-3 z-20 rounded-md border border-amber-400/25 bg-background/90 px-3 py-2 text-center text-xs text-amber-300 backdrop-blur">Controls changed. Refresh the preview before download.</div> : null}
              {safeArea ? <div className="pointer-events-none absolute inset-[4%] z-10 border border-dashed border-teal-400/45"><span className="absolute -bottom-px start-0 bg-teal-950/80 px-1.5 py-0.5 font-mono text-[8px] text-teal-300">SAFE AREA</span></div> : null}
              {showGrid ? <div className="pointer-events-none absolute inset-0 z-10 opacity-40" style={{ backgroundImage: "linear-gradient(to right, rgba(45,212,191,.22) 1px, transparent 1px), linear-gradient(to bottom, rgba(45,212,191,.22) 1px, transparent 1px)", backgroundSize: "8.333% 16.666%" }} /> : null}
              {selectedBrand && brandPlacement === "custom" ? (
                <button
                  type="button"
                  aria-label="Drag media logo position"
                  title="Drag to position the media logo"
                  onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture(event.pointerId);
                    moveBrand(event);
                  }}
                  onPointerMove={(event) => {
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) moveBrand(event);
                  }}
                  className="absolute z-30 flex touch-none items-center justify-center rounded-lg border border-dashed border-primary bg-primary/10 text-primary shadow-sm backdrop-blur-sm"
                  style={{
                    left: `${brandX}%`,
                    top: `${brandY}%`,
                    width: `${brandSize * 1.3}%`,
                    maxWidth: "28%",
                    aspectRatio: "1",
                    transform: "translate(-50%, -50%)",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={selectedBrand.logoUrl} alt="" className="size-[72%] object-contain" draggable={false} />
                  <span className="absolute -bottom-2 -end-2 flex size-6 items-center justify-center rounded-full border border-primary bg-background shadow"><MoveIcon className="size-3.5" aria-hidden="true" /></span>
                </button>
              ) : null}
            </div>
          </div>

          <div className="flex min-h-8 flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-4 py-2 font-mono text-[11px] text-muted-foreground">
            <span className="flex items-center gap-2"><span className={cn("size-1.5 rounded-full", rendering ? "animate-pulse bg-amber-400" : "bg-teal-400")} />{rendering ? "Rendering..." : renderedAt ? `Rendered ${new Date(renderedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Ready"}</span>
            <span>{dimensions.width * scale}x{dimensions.height * scale} @ {scale}x export</span>
            <span className="ms-auto">{selectedOption ? `source #${selectedOption.id} - ${selectedOption.detail}` : "No source selected"}</span>
          </div>

          <div className="border-t border-border bg-card/35 p-4">
            <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold">Recent generations</h3><span className="text-xs text-muted-foreground">This session</span></div>
            {recent.length ? <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-4">{recent.map((item) => (
              <button key={item.id} type="button" onClick={() => applyRecent(item)} className="group flex min-w-0 items-center gap-3 rounded-lg border border-border bg-background/65 p-2 text-start transition-colors hover:border-muted-foreground">
                <span className="relative block aspect-video w-24 shrink-0 overflow-hidden rounded-md border border-border"><Image src={item.url} alt="" fill unoptimized className="object-cover" /></span>
                <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{item.title}</span><span className="block truncate text-[11px] text-muted-foreground">{item.meta}</span><span className="font-mono text-[10px] text-muted-foreground">{new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></span>
                <Button render={<span />} nativeButton={false} variant="ghost" size="icon-xs" onClick={(event) => { event.stopPropagation(); download(item.url); }} aria-label="Download recent graphic"><DownloadIcon /></Button>
              </button>
            ))}</div> : <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-border py-6 text-sm text-muted-foreground"><ImageIcon className="size-4" />Generated previews will appear here.</div>}
          </div>
        </section>
      </div>
    </TooltipProvider>
  );
}
