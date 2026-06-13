"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2Icon } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export type CropCopy = {
  title: string;
  description: string;
  zoom: string;
  aspect: string;
  free: string;
  cancel: string;
  apply: string;
  applying: string;
};

type AspectKey = "5:2" | "16:9" | "1:1" | "free";

const ASPECTS: { key: AspectKey; ratio: number }[] = [
  { key: "5:2", ratio: 5 / 2 },
  { key: "16:9", ratio: 16 / 9 },
  { key: "1:1", ratio: 1 },
  // "free" keeps a 5:2 frame but is offered as a distinct choice for parity with X.
  { key: "free", ratio: 5 / 2 },
];

// Fixed render viewport width in CSS px. The crop window height follows the aspect.
const VIEWPORT_W = 480;
const MAX_BYTES = 8 * 1024 * 1024; // mirror the server cap client-side

// Clamp pan offset so the crop window stays fully covered by the drawn image.
function clampOffset(
  next: { x: number; y: number },
  drawW: number,
  drawH: number,
  winW: number,
  winH: number,
) {
  const maxX = Math.max(0, (drawW - winW) / 2);
  const maxY = Math.max(0, (drawH - winH) / 2);
  return {
    x: Math.min(maxX, Math.max(-maxX, next.x)),
    y: Math.min(maxY, Math.max(-maxY, next.y)),
  };
}

// Inner editor. Mounted with key={file identity} so its state initializes fresh per file
// without reset effects (which the lint config forbids inside useEffect).
function CropEditor({
  file,
  locale,
  copy,
  defaultAspect,
  onApply,
  onCancel,
}: {
  file: File;
  locale: Locale;
  copy: CropCopy;
  defaultAspect: AspectKey;
  onApply: (file: File) => void;
  onCancel: () => void;
}) {
  const [aspect, setAspect] = useState<AspectKey>(defaultAspect);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  // Load the source image. Subscribing to the load event and setting state from the
  // callback is the allowed effect pattern (no synchronous setState in the effect body).
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => setImg(image);
    image.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const ratio = ASPECTS.find((a) => a.key === aspect)?.ratio ?? 5 / 2;
  const winW = VIEWPORT_W;
  const winH = Math.round(VIEWPORT_W / ratio);
  const baseScale = img
    ? Math.max(winW / img.naturalWidth, winH / img.naturalHeight)
    : 1;
  const drawW = img ? img.naturalWidth * baseScale * zoom : 0;
  const drawH = img ? img.naturalHeight * baseScale * zoom : 0;
  // Clamp at render time so changing zoom/aspect never escapes the frame.
  const clamped = clampOffset(offset, drawW, drawH, winW, winH);

  function onPointerDown(event: React.PointerEvent) {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, ox: clamped.x, oy: clamped.y };
  }
  function onPointerMove(event: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    setOffset(
      clampOffset(
        { x: drag.ox + (event.clientX - drag.x), y: drag.oy + (event.clientY - drag.y) },
        drawW,
        drawH,
        winW,
        winH,
      ),
    );
  }
  function onPointerUp(event: React.PointerEvent) {
    dragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // capture may already be released
    }
  }

  async function apply() {
    if (!img) return;
    const effScale = baseScale * zoom;
    const outW = Math.round(winW / effScale);
    const outH = Math.round(winH / effScale);
    // Centre of the crop window in source-image coordinates.
    const srcCx = img.naturalWidth / 2 - clamped.x / effScale;
    const srcCy = img.naturalHeight / 2 - clamped.y / effScale;
    const sx = srcCx - outW / 2;
    const sy = srcCy - outH / 2;

    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      onApply(file);
      return;
    }
    ctx.drawImage(img, sx, sy, outW, outH, 0, 0, outW, outH);

    const isPng = file.type === "image/png";
    const mime = isPng ? "image/png" : "image/jpeg";
    const ext = isPng ? "png" : "jpg";
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), mime, isPng ? undefined : 0.9),
    );
    // Fall back to the original file if encode fails or the crop exceeds the cap; the
    // server cap still guards the upload itself.
    if (!blob || blob.size > MAX_BYTES) {
      onApply(file);
      return;
    }
    const baseName = file.name.replace(/\.[^.]+$/, "") || "cover";
    onApply(new File([blob], `${baseName}-crop.${ext}`, { type: mime }));
  }

  return (
    <>
      <div className="flex flex-col gap-4">
        <div
          className="relative mx-auto overflow-hidden rounded-lg border border-border bg-muted/40"
          style={{ width: winW, height: winH, touchAction: "none" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {img ? (
            // eslint-disable-next-line @next/next/no-img-element -- in-memory crop preview
            <img
              src={img.src}
              alt=""
              draggable={false}
              className="pointer-events-none absolute start-1/2 top-1/2 max-w-none cursor-grab select-none"
              style={{
                width: drawW,
                height: drawH,
                transform: `translate(calc(-50% + ${clamped.x}px), calc(-50% + ${clamped.y}px))`,
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Loader2Icon className="size-5 animate-spin" />
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">{copy.aspect}</span>
          <ToggleGroup
            value={[aspect]}
            onValueChange={(value) => {
              const next = value.at(-1);
              if (next) setAspect(next as AspectKey);
            }}
            spacing={1}
            variant="outline"
            dir={locale === "ar" ? "rtl" : "ltr"}
          >
            {ASPECTS.map((item) => (
              <ToggleGroupItem key={item.key} value={item.key} className="flex-1">
                {item.key === "free" ? copy.free : item.key}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">{copy.zoom}</span>
          <Slider
            value={zoom}
            min={1}
            max={3}
            step={0.01}
            onValueChange={(value) => setZoom(typeof value === "number" ? value : value[0])}
          />
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {copy.cancel}
        </Button>
        <Button type="button" onClick={apply} disabled={!img}>
          {copy.apply}
        </Button>
      </DialogFooter>
    </>
  );
}

export function ImageCropDialog({
  open,
  file,
  locale,
  copy,
  defaultAspect = "5:2",
  onApply,
  onCancel,
}: {
  open: boolean;
  file: File | null;
  locale: Locale;
  copy: CropCopy;
  defaultAspect?: AspectKey;
  onApply: (file: File) => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        {open && file ? (
          <CropEditor
            // Remount per file so internal state initializes fresh without reset effects.
            key={`${file.name}:${file.size}:${file.lastModified}`}
            file={file}
            locale={locale}
            copy={copy}
            defaultAspect={defaultAspect}
            onApply={onApply}
            onCancel={onCancel}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
