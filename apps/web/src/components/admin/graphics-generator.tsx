"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { DownloadIcon, ImageIcon, LoaderCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  GRAPHICS_TEMPLATES,
  graphicsOptionsForTemplate,
  initialGraphicsSelection,
  isGraphicsTemplateId,
  type GraphicsGeneratorData,
  type GraphicsTemplateId,
} from "@/lib/graphics-generator-model";

export function GraphicsGenerator({ data }: { data: GraphicsGeneratorData }) {
  const [template, setTemplate] = useState<GraphicsTemplateId>("match-result");
  const [resourceId, setResourceId] = useState<number | null>(() =>
    initialGraphicsSelection(data, "match-result"),
  );
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const options = useMemo(() => graphicsOptionsForTemplate(data, template), [data, template]);
  const selectedOption = useMemo(
    () => options.find((option) => option.id === resourceId) ?? null,
    [options, resourceId],
  );

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function selectTemplate(value: string | null) {
    if (!isGraphicsTemplateId(value)) return;
    setTemplate(value);
    setResourceId(initialGraphicsSelection(data, value));
    setError(null);
  }

  async function generatePreview() {
    if (resourceId === null) return;
    setRendering(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/graphics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template, resourceId }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || "Unable to generate graphic");
      }
      const image = await response.blob();
      setPreviewUrl(URL.createObjectURL(image));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to generate graphic");
    } finally {
      setRendering(false);
    }
  }

  function download() {
    if (!previewUrl) return;
    const link = document.createElement("a");
    link.href = previewUrl;
    link.download = `graphics-${template}.png`;
    link.click();
  }

  return (
    <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <Card className="min-w-0 border-border/70 bg-card/70 shadow-sm">
        <CardHeader className="p-5 sm:p-6">
          <CardTitle className="text-lg">Graphics</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 px-5 pb-5 pt-0 sm:px-6 sm:pb-6">
          <Tabs value={template} onValueChange={selectTemplate}>
            <TabsList className="w-full">
              {GRAPHICS_TEMPLATES.map((item) => (
                <TabsTrigger key={item.id} value={item.id} className="min-w-0 text-xs sm:text-sm">
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <Field>
            <FieldLabel htmlFor="graphics-source">Source</FieldLabel>
            <Combobox
              items={options}
              value={selectedOption}
              onValueChange={(option) => setResourceId(option?.id ?? null)}
              itemToStringLabel={(option) => option.label}
              itemToStringValue={(option) => String(option.id)}
              isItemEqualToValue={(option, value) => option.id === value.id}
              autoHighlight
            >
              <ComboboxInput
                id="graphics-source"
                className="w-full"
                placeholder="Search sources"
                showClear
              />
              <ComboboxContent>
                <ComboboxEmpty>No matching sources.</ComboboxEmpty>
                <ComboboxList>
                  {(option) => (
                    <ComboboxItem key={option.id} value={option}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{option.label}</span>
                        <span className="block truncate text-xs text-muted-foreground">{option.detail}</span>
                      </span>
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          </Field>

          {options.length === 0 ? (
            <p className="text-sm text-muted-foreground">No eligible sources are available.</p>
          ) : null}
          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}

          <div className="flex flex-wrap gap-2">
            <Button disabled={resourceId === null || rendering} onClick={generatePreview}>
              {rendering ? <LoaderCircleIcon className="animate-spin" data-icon="inline-start" /> : <ImageIcon data-icon="inline-start" />}
              Generate preview
            </Button>
            <Button variant="outline" disabled={!previewUrl} onClick={download}>
              <DownloadIcon data-icon="inline-start" />
              Download PNG
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="min-w-0 border-border/70 bg-card/70 shadow-sm">
        <CardHeader className="p-5 sm:p-6">
          <CardTitle className="text-lg">Preview</CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-5 pt-0 sm:px-6 sm:pb-6">
          {previewUrl ? (
            <Image
              src={previewUrl}
              alt="Generated social graphic"
              width={1600}
              height={900}
              unoptimized
              className="aspect-video w-full border border-border object-contain"
            />
          ) : (
            <div className="flex aspect-video items-center justify-center border border-dashed border-border text-sm text-muted-foreground">
              <ImageIcon className="size-5" aria-hidden="true" />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
