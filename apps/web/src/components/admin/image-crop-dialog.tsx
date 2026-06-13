"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2Icon } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import {
  centeredRatioRect,
  clampRect,
  fitRect,
  resizeRect,
  type CropHandle,
  type Rect,
} from "@/lib/crop-geometry";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export type CropCopy = {
  title: string;
  description: string;
  zoom: string;
  aspect: string;
  free: string;
  freeHint: string;
  cancel: string;
  apply: string;
  applying: string;
};

type AspectKey = "5:2" | "16:9" | "1:1" | "free";

// ratio = width / height; 0 means free (independent width & height).
const ASPECTS: { key: AspectKey; ratio: number }[] = [
  { key: "5:2", ratio: 5 / 2 },
  { key: "16:9", ratio: 16 / 9 },
  { key: "1:1", ratio: 1 },
  { key: "free", ratio: 0 },
];

// Fixed crop STAGE size in CSS px. The source image is drawn object-contain inside it;
// the crop rectangle lives in stage coordinates. Responsive: the wrapper measures its
// real width on small screens (see CropEditor) so pointer math stays accurate.
const STAGE_W = 520;
const STAGE_H = 360;
const MAX_BYTES = 8 * 1024 * 1024; // mirror the server cap client-side

function ratioFor(aspect: AspectKey): number {
  return ASPECTS.find((a) => a.key === aspect)?.ratio ?? 0;
}

// The 8 resize handles + their CSS placement (within the rectangle) and cursor.
const HANDLES: {
  key: Exclude<CropHandle, "move">;
  style: React.CSSProperties;
  cursor: string;
}[] = [
  { key: "nw", style: { left: 0, top: 0 }, cursor: "nwse-resize" },
  { key: "n", style: { left: "50%", top: 0 }, cursor: "ns-resize" },
  { key: "ne", style: { left: "100%", top: 0 }, cursor: "nesw-resize" },
  { key: "e", style: { left: "100%", top: "50%" }, cursor: "ew-resize" },
  { key: "se", style: { left: "100%", top: "100%" }, cursor: "nwse-resize" },
  { key: "s", style: { left: "50%", top: "100%" }, cursor: "ns-resize" },
  { key: "sw", style: { left: 0, top: "100%" }, cursor: "nesw-resize" },
  { key: "w", style: { left: 0, top: "50%" }, cursor: "ew-resize" },
];

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
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [stageW, setStageW] = useState(STAGE_W);
  // Crop rectangle in stage coords. null until the image loads and we seed it.
  const [rect, setRect] = useState<Rect | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  // Active pointer drag: which handle, the pointer origin, and the rectangle at grab time.
  const dragRef = useRef<{ handle: CropHandle; px: number; py: number; start: Rect } | null>(
    null,
  );

  const stageH = STAGE_H;

  // Load the source image. Subscribing to the load event and seeding the rectangle from
  // the callback is the allowed effect pattern (no synchronous setState in the effect body).
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const w = stageRef.current?.clientWidth || STAGE_W;
      setStageW(w);
      setImg(image);
      const fit = fitRect(image.naturalWidth, image.naturalHeight, w, stageH);
      const bounds: Rect = { x: fit.x, y: fit.y, width: fit.width, height: fit.height };
      setRect(centeredRatioRect(bounds, ratioFor(defaultAspect)));
    };
    image.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file, defaultAspect, stageH]);

  // The fitted draw rect (image position/size in the stage) + the contain scale.
  const fit = img
    ? fitRect(img.naturalWidth, img.naturalHeight, stageW, stageH)
    : { x: 0, y: 0, width: stageW, height: stageH, scale: 1 };
  const imageBounds: Rect = { x: fit.x, y: fit.y, width: fit.width, height: fit.height };

  function selectAspect(next: AspectKey) {
    setAspect(next);
    // Snap the current rectangle to the new ratio, centered & clamped inside the image.
    setRect((prev) => {
      const base = prev ?? imageBounds;
      const r = ratioFor(next);
      if (r <= 0) return clampRect(base, imageBounds); // free: keep current rectangle
      return centeredRatioRect(imageBounds, r);
    });
  }

  function onHandleDown(handle: CropHandle, event: React.PointerEvent) {
    if (!rect) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { handle, px: event.clientX, py: event.clientY, start: rect };
  }
  function onStageMove(event: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.px;
    const dy = event.clientY - drag.py;
    setRect(resizeRect(drag.start, drag.handle, dx, dy, imageBounds, ratioFor(aspect)));
  }
  function onStageUp(event: React.PointerEvent) {
    dragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // capture may already be released
    }
  }

  async function apply() {
    if (!img || !rect) return;
    // Map the rectangle from stage coords → source natural pixels (divide by contain scale).
    const sx = Math.round((rect.x - fit.x) / fit.scale);
    const sy = Math.round((rect.y - fit.y) / fit.scale);
    const sw = Math.max(1, Math.round(rect.width / fit.scale));
    const sh = Math.max(1, Math.round(rect.height / fit.scale));
    const outW = sw;
    const outH = sh;

    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      onApply(file);
      return;
    }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);

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
        {/* dir="ltr" forces ALL pointer math + handle positioning to be physical and
            identical regardless of page locale. The crop area is a pixel canvas, not
            document flow, so the RTL document direction must not affect it. */}
        <div
          ref={stageRef}
          dir="ltr"
          className="relative mx-auto max-w-full touch-none overflow-hidden rounded-lg border border-border bg-muted/40"
          style={{ width: stageW, height: stageH, touchAction: "none" }}
          onPointerMove={onStageMove}
          onPointerUp={onStageUp}
          onPointerCancel={onStageUp}
        >
          {img ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- in-memory crop preview */}
              <img
                src={img.src}
                alt=""
                draggable={false}
                className="pointer-events-none absolute select-none"
                style={{
                  left: fit.x,
                  top: fit.y,
                  width: fit.width,
                  height: fit.height,
                  maxWidth: "none",
                }}
              />
              {rect ? (
                <>
                  {/* Dark scrim with a transparent hole over the crop rectangle. */}
                  <div
                    className="pointer-events-none absolute inset-0 bg-black/50"
                    style={{
                      clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${rect.x}px ${rect.y}px, ${rect.x}px ${rect.y + rect.height}px, ${rect.x + rect.width}px ${rect.y + rect.height}px, ${rect.x + rect.width}px ${rect.y}px, ${rect.x}px ${rect.y}px)`,
                    }}
                  />
                  {/* The crop rectangle: drag interior to MOVE, 8 handles to RESIZE. */}
                  <div
                    className="absolute cursor-move ring-2 ring-white/90 ring-inset"
                    style={{
                      left: rect.x,
                      top: rect.y,
                      width: rect.width,
                      height: rect.height,
                      boxShadow: "0 0 0 1px rgba(0,0,0,0.4)",
                    }}
                    onPointerDown={(event) => onHandleDown("move", event)}
                  >
                    {/* Rule-of-thirds guides */}
                    <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
                      {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                        <div key={i} className="border border-white/20" />
                      ))}
                    </div>
                    {HANDLES.map((h) => (
                      <button
                        key={h.key}
                        type="button"
                        aria-label={`${copy.aspect} ${h.key}`}
                        className="absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/30 bg-white shadow"
                        style={{ ...h.style, cursor: h.cursor }}
                        onPointerDown={(event) => onHandleDown(h.key, event)}
                      />
                    ))}
                  </div>
                </>
              ) : null}
            </>
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
              if (next) selectAspect(next as AspectKey);
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
          {aspect === "free" ? (
            <span className="text-xs text-muted-foreground">{copy.freeHint}</span>
          ) : null}
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {copy.cancel}
        </Button>
        <Button type="button" onClick={apply} disabled={!img || !rect}>
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
