import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { anonymous, gamesAdmin, superAdmin } from "./access";

vi.mock("@/lib/admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin")>();
  return { ...actual, getAdminAccess: vi.fn() };
});

import { getAdminAccess } from "@/lib/admin";
const mockAccess = vi.mocked(getAdminAccess);

import { POST as inquiryPOST } from "@/app/api/partners/inquiries/route";
import { POST as partnersPOST } from "@/app/api/admin/partners/route";
import { POST as campaignsPOST } from "@/app/api/admin/partners/campaigns/route";
import { PATCH as inquiryStatusPATCH } from "@/app/api/admin/partners/inquiries/[id]/route";
import { PartnerPlacement } from "@/components/partners/partner-placement";

function req(path: string, body: unknown, ip = "203.0.113.10") {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost",
      Host: "localhost",
      "cf-connecting-ip": ip,
    },
    body: JSON.stringify(body),
  });
}

function ctx(params: Record<string, string>) {
  return { params: Promise.resolve(params) };
}

const validInquiry = {
  organizationName: "Moon Arena",
  contactName: "Partner Lead",
  email: "partner@example.com",
  websiteUrl: "https://example.com",
  interest: "open_source_partner",
  message: "We want to support the project.",
};

describe("partner public inquiry route", () => {
  test("rejects cross-origin submission before validation", async () => {
    const res = await inquiryPOST(
      new Request("http://localhost/api/partners/inquiries", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://evil.example",
          Host: "localhost",
        },
        body: JSON.stringify(validInquiry),
      }),
    );
    expect(res.status).toBe(403);
  });

  test("validates and creates an inquiry", async () => {
    const res = await inquiryPOST(req("/api/partners/inquiries", validInquiry, "203.0.113.11"));
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; inquiryId: number };
    expect(body.ok).toBe(true);
    expect(body.inquiryId).toBeGreaterThan(0);
  });

  test("rate-limits repeated public inquiries by client IP", async () => {
    const ip = "203.0.113.12";
    for (let i = 0; i < 3; i += 1) {
      const res = await inquiryPOST(req("/api/partners/inquiries", { ...validInquiry, email: `rl-${i}@example.com` }, ip));
      expect(res.status).toBe(200);
    }
    const blocked = await inquiryPOST(req("/api/partners/inquiries", { ...validInquiry, email: "rl-4@example.com" }, ip));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
  });
});

describe("partner admin routes", () => {
  test("partner creation is super-admin only", async () => {
    mockAccess.mockResolvedValue(gamesAdmin(["valorant"]));
    const res = await partnersPOST(req("/api/admin/partners", {
      slug: "scoped-denied",
      name: "Scoped Denied",
      status: "active",
    }));
    expect(res.status).toBe(403);
  });

  test("super admin can create partner and campaign, with audit rows", async () => {
    mockAccess.mockResolvedValue(superAdmin());
    const slug = `route-partner-${Date.now()}`;
    const partnerRes = await partnersPOST(req("/api/admin/partners", {
      slug,
      name: "Route Partner",
      logoUrl: "https://example.com/logo.png",
      websiteUrl: "https://example.com",
      summary: "Supports hosting",
      status: "active",
    }));
    expect(partnerRes.status).toBe(200);
    const partner = await partnerRes.json() as { id: number; slug: string };
    expect(partner.slug).toBe(slug);

    const campaignRes = await campaignsPOST(req("/api/admin/partners/campaigns", {
      partnerId: partner.id,
      kind: "leaderboard",
      target: "season:2099",
      title: "Presented by Route Partner",
      status: "active",
      paymentMethod: "github_sponsors",
      paymentStatus: "paid",
    }));
    expect(campaignRes.status).toBe(200);

    const { listAdminAuditLog } = await import("@bot/db/ewcAdminAuditLog.js") as {
      listAdminAuditLog: () => Promise<Array<{ action: string; target: string | null }>>;
    };
    await new Promise((resolve) => setImmediate(resolve));
    const audit = await listAdminAuditLog();
    expect(audit.some((row) => row.action === "partner.create" && row.target === slug)).toBe(true);
    expect(audit.some((row) => row.action === "partner.campaign.create")).toBe(true);
  });

  test("super admin can update inquiry status and write audit", async () => {
    mockAccess.mockResolvedValue(superAdmin());
    const { createPartnerInquiry } = await import("@bot/db/partners.js") as {
      createPartnerInquiry: (input: unknown) => Promise<{ id: number }>;
    };
    const inquiry = await createPartnerInquiry(validInquiry);
    const res = await inquiryStatusPATCH(
      req(`/api/admin/partners/inquiries/${inquiry.id}`, { status: "contacted" }),
      ctx({ id: String(inquiry.id) }),
    );
    expect(res.status).toBe(200);
    expect((await res.json() as { status: string }).status).toBe("contacted");
  });

  test("anonymous admin write is 401", async () => {
    mockAccess.mockResolvedValue(anonymous());
    const res = await partnersPOST(req("/api/admin/partners", { slug: "anon", name: "Anon" }));
    expect(res.status).toBe(401);
  });
});

describe("partner placement rendering", () => {
  test("renders nothing without an active paid campaign", async () => {
    const node = await PartnerPlacement({ kind: "tournament", target: "tournament:999999", locale: "en" });
    expect(node).toBeNull();
  });

  test("renders a labeled sponsored link for an eligible campaign", async () => {
    const { createPartner, createPartnerCampaign } = await import("@bot/db/partners.js") as {
      createPartner: (input: unknown) => Promise<{ id: number }>;
      createPartnerCampaign: (input: unknown) => Promise<unknown>;
    };
    const partner = await createPartner({
      slug: `render-partner-${Date.now()}`,
      name: "Render Partner",
      websiteUrl: "https://render.example",
      summary: "Helps cover hosting",
    });
    await createPartnerCampaign({
      partnerId: partner.id,
      kind: "leaderboard",
      target: "season:2098",
      status: "active",
      paymentStatus: "paid",
      title: "Presented by Render Partner",
    });

    const node = await PartnerPlacement({ kind: "leaderboard", target: "season:2098", locale: "en" });
    const html = renderToStaticMarkup(node);
    expect(html).toContain("Presented by");
    expect(html).toContain("Render Partner");
    expect(html).toContain('rel="sponsored nofollow noopener noreferrer"');
  });
});
