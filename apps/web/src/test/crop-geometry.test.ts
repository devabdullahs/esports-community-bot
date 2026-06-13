import { describe, expect, test } from "vitest";
import {
  centeredRatioRect,
  clampRect,
  fitRect,
  MIN_CROP_SIZE,
  resizeRect,
  type Rect,
} from "@/lib/crop-geometry";

describe("fitRect — object-contain fit", () => {
  test("wide image fits to stage width, centered vertically", () => {
    // 1000x250 (4:1) into a 500x360 stage → scale 0.5, drawn 500x125 centered.
    const fit = fitRect(1000, 250, 500, 360);
    expect(fit.scale).toBeCloseTo(0.5);
    expect(fit.width).toBeCloseTo(500);
    expect(fit.height).toBeCloseTo(125);
    expect(fit.x).toBeCloseTo(0);
    expect(fit.y).toBeCloseTo((360 - 125) / 2);
  });

  test("tall image fits to stage height, centered horizontally", () => {
    // 200x800 into 500x360 → scale 0.45, drawn 90x360, centered horizontally.
    const fit = fitRect(200, 800, 500, 360);
    expect(fit.scale).toBeCloseTo(0.45);
    expect(fit.height).toBeCloseTo(360);
    expect(fit.width).toBeCloseTo(90);
    expect(fit.x).toBeCloseTo((500 - 90) / 2);
    expect(fit.y).toBeCloseTo(0);
  });

  test("degenerate dimensions fall back to full stage", () => {
    const fit = fitRect(0, 0, 500, 360);
    expect(fit).toMatchObject({ x: 0, y: 0, width: 500, height: 360, scale: 1 });
  });
});

describe("clampRect — keep rectangle inside bounds", () => {
  const bounds: Rect = { x: 10, y: 20, width: 200, height: 100 };

  test("pushes a rectangle back inside when it overflows right/bottom", () => {
    const r = clampRect({ x: 180, y: 90, width: 60, height: 40 }, bounds);
    expect(r.x).toBe(10 + 200 - 60);
    expect(r.y).toBe(20 + 100 - 40);
    expect(r.width).toBe(60);
    expect(r.height).toBe(40);
  });

  test("pins to the top-left edge when it overflows left/top", () => {
    const r = clampRect({ x: -50, y: -50, width: 30, height: 30 }, bounds);
    expect(r.x).toBe(10);
    expect(r.y).toBe(20);
  });

  test("shrinks an oversized rectangle to the bounds", () => {
    const r = clampRect({ x: 0, y: 0, width: 999, height: 999 }, bounds);
    expect(r.width).toBe(200);
    expect(r.height).toBe(100);
    expect(r.x).toBe(10);
    expect(r.y).toBe(20);
  });
});

describe("centeredRatioRect — snap to an aspect inside bounds", () => {
  const bounds: Rect = { x: 0, y: 0, width: 500, height: 360 };

  test("5:2 is width-limited inside a near-square stage", () => {
    const r = centeredRatioRect(bounds, 5 / 2);
    expect(r.width).toBeCloseTo(500);
    expect(r.height).toBeCloseTo(200);
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBeCloseTo((360 - 200) / 2);
  });

  test("1:1 is height-limited and centered horizontally", () => {
    const r = centeredRatioRect(bounds, 1);
    expect(r.width).toBeCloseTo(360);
    expect(r.height).toBeCloseTo(360);
    expect(r.x).toBeCloseTo((500 - 360) / 2);
    expect(r.y).toBeCloseTo(0);
  });

  test("free (ratio<=0) returns the whole bounds", () => {
    const r = centeredRatioRect(bounds, 0);
    expect(r).toMatchObject(bounds);
  });
});

describe("resizeRect — move", () => {
  const bounds: Rect = { x: 0, y: 0, width: 400, height: 300 };
  const start: Rect = { x: 50, y: 40, width: 100, height: 80 };

  test("move translates and clamps inside bounds", () => {
    const r = resizeRect(start, "move", 20, -10, bounds, 0);
    expect(r).toMatchObject({ x: 70, y: 30, width: 100, height: 80 });
  });

  test("move clamps at the right/bottom edge", () => {
    const r = resizeRect(start, "move", 1000, 1000, bounds, 0);
    expect(r.x).toBe(400 - 100);
    expect(r.y).toBe(300 - 80);
  });
});

describe("resizeRect — FREE mode resizes width & height independently", () => {
  const bounds: Rect = { x: 0, y: 0, width: 400, height: 300 };
  const start: Rect = { x: 100, y: 100, width: 100, height: 100 };

  test("east edge changes only width", () => {
    const r = resizeRect(start, "e", 40, 0, bounds, 0);
    expect(r.width).toBe(140);
    expect(r.height).toBe(100); // unchanged — this is the BUG-1 fix
    expect(r.x).toBe(100);
  });

  test("south edge changes only height", () => {
    const r = resizeRect(start, "s", 0, 25, bounds, 0);
    expect(r.height).toBe(125);
    expect(r.width).toBe(100);
  });

  test("corner changes both dimensions independently", () => {
    const r = resizeRect(start, "se", 30, 70, bounds, 0);
    expect(r.width).toBe(130);
    expect(r.height).toBe(170);
  });

  test("north-west handle moves the top-left and keeps bottom-right anchored", () => {
    const r = resizeRect(start, "nw", -20, -30, bounds, 0);
    expect(r.x).toBe(80);
    expect(r.y).toBe(70);
    // bottom-right stays put at (200, 200)
    expect(r.x + r.width).toBe(200);
    expect(r.y + r.height).toBe(200);
  });

  test("cannot shrink below MIN_CROP_SIZE", () => {
    // East edge dragged inward by 90 (rect is 100 wide) would leave 10px → clamped to min.
    const r = resizeRect(start, "e", -90, 0, bounds, 0);
    expect(r.width).toBe(MIN_CROP_SIZE);
  });
});

describe("resizeRect — ratio lock keeps aspect", () => {
  const bounds: Rect = { x: 0, y: 0, width: 400, height: 400 };
  const start: Rect = { x: 100, y: 100, width: 100, height: 50 }; // already 2:1

  test("east edge in 2:1 derives height from width", () => {
    const r = resizeRect(start, "e", 40, 0, bounds, 2);
    expect(r.width).toBe(140);
    expect(r.height).toBeCloseTo(70);
  });

  test("south edge in 2:1 derives width from height", () => {
    const r = resizeRect(start, "s", 0, 30, bounds, 2);
    expect(r.height).toBe(80);
    expect(r.width).toBeCloseTo(160);
  });

  test("ratio-locked result stays inside bounds", () => {
    const r = resizeRect(start, "se", 9999, 0, bounds, 2);
    expect(r.x + r.width).toBeLessThanOrEqual(400.0001);
    expect(r.y + r.height).toBeLessThanOrEqual(400.0001);
    expect(r.width / r.height).toBeCloseTo(2);
  });
});
