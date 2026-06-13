// Pure geometry helpers for the image crop dialog. Kept framework-free so they can
// be unit-tested in isolation (see src/test/crop-geometry.test.ts). All coordinates
// are PHYSICAL pixels in stage space (top-left origin, x grows right, y grows down) —
// the crop stage forces dir="ltr" so this math is identical regardless of page locale.

export type Rect = { x: number; y: number; width: number; height: number };

// Resize handles: 4 corners + 4 edges. "move" drags the whole rectangle.
export type CropHandle =
  | "move"
  | "nw"
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w";

// Smallest crop rectangle in stage px so a handle can't be collapsed to nothing.
export const MIN_CROP_SIZE = 24;

// Fit a source image (natW × natH) into a stage (stageW × stageH) with object-contain
// semantics: the largest centered rectangle that fits, preserving aspect ratio. Returns
// the drawn image rectangle in stage coords plus the scale (stage px per source px).
export function fitRect(
  natW: number,
  natH: number,
  stageW: number,
  stageH: number,
): Rect & { scale: number } {
  if (natW <= 0 || natH <= 0) {
    return { x: 0, y: 0, width: stageW, height: stageH, scale: 1 };
  }
  const scale = Math.min(stageW / natW, stageH / natH);
  const width = natW * scale;
  const height = natH * scale;
  return {
    x: (stageW - width) / 2,
    y: (stageH - height) / 2,
    width,
    height,
    scale,
  };
}

// Clamp a rectangle so it stays fully inside `bounds`. Position is clamped first; if the
// rectangle is larger than the bounds in a dimension it is shrunk to fit (then re-pinned).
export function clampRect(rect: Rect, bounds: Rect): Rect {
  let { width, height } = rect;
  width = Math.min(width, bounds.width);
  height = Math.min(height, bounds.height);
  const minX = bounds.x;
  const minY = bounds.y;
  const maxX = bounds.x + bounds.width - width;
  const maxY = bounds.y + bounds.height - height;
  const x = Math.min(Math.max(rect.x, minX), Math.max(minX, maxX));
  const y = Math.min(Math.max(rect.y, minY), Math.max(minY, maxY));
  return { x, y, width, height };
}

// Build the largest rectangle of the given aspect ratio (w/h) that fits inside `bounds`,
// centered. ratio<=0 ("free") returns the full bounds. Used when a fixed preset is picked.
export function centeredRatioRect(bounds: Rect, ratio: number): Rect {
  if (ratio <= 0) {
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  }
  let width = bounds.width;
  let height = width / ratio;
  if (height > bounds.height) {
    height = bounds.height;
    width = height * ratio;
  }
  return {
    x: bounds.x + (bounds.width - width) / 2,
    y: bounds.y + (bounds.height - height) / 2,
    width,
    height,
  };
}

// Apply a drag delta (dx, dy in stage px) to `start` for the given handle, optionally
// locking to `ratio` (w/h; <=0 means free). Returns a rectangle clamped inside `bounds`.
// Edge/corner resizing keeps the opposite edge/corner anchored. Ratio-locked resizing
// derives the dependent dimension from the dominant axis of the active handle.
export function resizeRect(
  start: Rect,
  handle: CropHandle,
  dx: number,
  dy: number,
  bounds: Rect,
  ratio: number,
): Rect {
  if (handle === "move") {
    return clampRect({ ...start, x: start.x + dx, y: start.y + dy }, bounds);
  }

  // Fixed edges (anchors) for each handle. left/top fixed unless this handle moves them.
  const movesLeft = handle === "nw" || handle === "w" || handle === "sw";
  const movesRight = handle === "ne" || handle === "e" || handle === "se";
  const movesTop = handle === "nw" || handle === "n" || handle === "ne";
  const movesBottom = handle === "sw" || handle === "s" || handle === "se";

  let left = start.x;
  let right = start.x + start.width;
  let top = start.y;
  let bottom = start.y + start.height;

  if (movesLeft) left = start.x + dx;
  if (movesRight) right = start.x + start.width + dx;
  if (movesTop) top = start.y + dy;
  if (movesBottom) bottom = start.y + start.height + dy;

  // Normalize so width/height stay positive (allow crossing past the anchor).
  let x = Math.min(left, right);
  let y = Math.min(top, bottom);
  let width = Math.abs(right - left);
  let height = Math.abs(bottom - top);

  width = Math.max(width, MIN_CROP_SIZE);
  height = Math.max(height, MIN_CROP_SIZE);

  if (ratio <= 0) {
    // Free mode: width and height move independently. Clamp each side into bounds.
    return clampRect({ x, y, width, height }, bounds);
  }

  // --- Ratio-locked resize -------------------------------------------------
  // Strategy: pick a fixed ANCHOR point that the active handle pivots around, compute the
  // desired width from the drag, derive height = width/ratio, then uniformly scale both
  // down until the rectangle (grown from the anchor in the handle's direction) fits the
  // bounds. Uniform scaling preserves the aspect ratio — a per-axis clamp would not.
  const horizontal = movesLeft || movesRight;
  const vertical = movesTop || movesBottom;

  // Anchor X: the edge NOT being moved horizontally. For pure-vertical handles the
  // rectangle grows symmetrically about its horizontal center.
  const cx = start.x + start.width / 2;
  const anchorX = movesRight ? start.x : movesLeft ? start.x + start.width : cx;
  const cy = start.y + start.height / 2;
  const anchorY = movesBottom ? start.y : movesTop ? start.y + start.height : cy;
  // Direction the rectangle extends from the anchor: +1 grows toward larger coords.
  const dirX = movesRight ? 1 : movesLeft ? -1 : 0; // 0 → symmetric
  const dirY = movesBottom ? 1 : movesTop ? -1 : 0;

  // Desired width: drive from whichever axis the handle moves (corners use the larger).
  if (horizontal && !vertical) {
    height = width / ratio;
  } else if (vertical && !horizontal) {
    width = height * ratio;
  } else if (width / ratio >= height) {
    height = width / ratio;
  } else {
    width = height * ratio;
  }
  width = Math.max(width, MIN_CROP_SIZE);
  height = width / ratio;

  // Space available from the anchor toward each bound edge (full span when symmetric).
  const availW =
    dirX > 0
      ? bounds.x + bounds.width - anchorX
      : dirX < 0
        ? anchorX - bounds.x
        : bounds.width;
  const availH =
    dirY > 0
      ? bounds.y + bounds.height - anchorY
      : dirY < 0
        ? anchorY - bounds.y
        : bounds.height;
  // Uniformly scale down so width≤availW and height≤availH while keeping the ratio.
  const scaleDown = Math.min(1, availW / width, availH / height);
  width = Math.max(MIN_CROP_SIZE, width * scaleDown);
  height = width / ratio;

  // Position the rectangle relative to the anchor and the extension direction.
  x = dirX > 0 ? anchorX : dirX < 0 ? anchorX - width : anchorX - width / 2;
  y = dirY > 0 ? anchorY : dirY < 0 ? anchorY - height : anchorY - height / 2;

  return clampRect({ x, y, width, height }, bounds);
}
