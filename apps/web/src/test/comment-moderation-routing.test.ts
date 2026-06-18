/**
 * Routing matrix for moderationFor(): how a comment's text maps to
 * status / flagReason / autoApproveAt. The severity tiers are:
 *   hard profanity -> pending, never auto-approve
 *   review term OR external link -> pending, auto-approve on a timer
 *   clean -> visible
 */
import { describe, expect, test } from "vitest";
import { moderationFor } from "@/lib/comments";

const nowSec = () => Math.floor(Date.now() / 1000);

describe("moderationFor — severity routing", () => {
  test("clean comment -> visible, no flag, no timer", () => {
    const r = moderationFor("great game, well played by both teams");
    expect(r.status).toBe("visible");
    expect(r.flagReason).toBeNull();
    expect(r.autoApproveAt).toBeNull();
  });

  test("hard profanity -> pending, NEVER auto-approves", () => {
    const r = moderationFor("this is shit");
    expect(r.status).toBe("pending");
    expect(r.autoApproveAt).toBeNull();
    expect(r.flagReason).toMatchObject({ profanity: expect.arrayContaining(["shit"]) });
  });

  test("external link only -> pending, auto-approvable on a timer", () => {
    const r = moderationFor("join here https://sketchy.example/x");
    expect(r.status).toBe("pending");
    expect(typeof r.autoApproveAt).toBe("number");
    expect(r.autoApproveAt!).toBeGreaterThan(nowSec());
    expect(r.flagReason).toMatchObject({ links: ["sketchy.example"] });
    // a link-only flag must not masquerade as profanity
    expect(r.flagReason).not.toHaveProperty("profanity");
  });

  test("review term only -> pending, auto-approvable on a timer (not profanity)", () => {
    const r = moderationFor("you are an idiot");
    expect(r.status).toBe("pending");
    expect(typeof r.autoApproveAt).toBe("number");
    expect(r.autoApproveAt!).toBeGreaterThan(nowSec());
    expect(r.flagReason).toMatchObject({ reviewTerms: expect.arrayContaining(["idiot"]) });
    expect(r.flagReason).not.toHaveProperty("profanity");
  });

  test("hard profanity + review term -> hard profanity behavior wins", () => {
    const r = moderationFor("you stupid shit");
    expect(r.status).toBe("pending");
    expect(r.autoApproveAt).toBeNull(); // never auto-approve, the hard-tier rule
    expect(r.flagReason).toMatchObject({ profanity: expect.arrayContaining(["shit"]) });
  });

  test("review term + external link -> pending, timer, both reasons recorded", () => {
    const r = moderationFor("idiot, see https://sketchy.example");
    expect(r.status).toBe("pending");
    expect(typeof r.autoApproveAt).toBe("number");
    expect(r.flagReason).toMatchObject({
      reviewTerms: expect.arrayContaining(["idiot"]),
      links: ["sketchy.example"],
    });
  });
});
