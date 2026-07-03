import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'partners-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';

const { closeDb } = await import('../src/db/index.js');
const {
  createPartner,
  createPartnerCampaign,
  createPartnerInquiry,
  getPartner,
  listActivePartnerCampaigns,
  listPartnerCampaigns,
  listPartnerInquiries,
  updatePartner,
  updatePartnerCampaign,
  updatePartnerInquiryStatus,
} = await import('../src/db/partners.js');

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('partner inquiries are created, listed newest-first, and status-updated', async () => {
  const inquiry = await createPartnerInquiry({
    organizationName: 'Moon Arena',
    contactName: 'Abdullah',
    email: 'PARTNERS@EXAMPLE.COM',
    websiteUrl: 'https://example.com',
    interest: 'open_source_partner',
    message: 'We want to support hosting.',
  });

  assert.equal(inquiry.organizationName, 'Moon Arena');
  assert.equal(inquiry.email, 'partners@example.com');
  assert.equal(inquiry.status, 'new');

  const listed = await listPartnerInquiries();
  assert.equal(listed[0].id, inquiry.id);

  const updated = await updatePartnerInquiryStatus(inquiry.id, 'contacted');
  assert.equal(updated.status, 'contacted');
});

test('partners support create, update, and lookup by id or slug', async () => {
  const partner = await createPartner({
    slug: 'moon-arena',
    name: 'Moon Arena',
    logoUrl: 'https://example.com/logo.png',
    websiteUrl: 'https://example.com',
    summary: 'Community venue',
  });

  assert.equal((await getPartner(partner.id)).slug, 'moon-arena');
  assert.equal((await getPartner('moon-arena')).name, 'Moon Arena');

  const updated = await updatePartner(partner.id, { status: 'inactive', summary: 'Updated summary' });
  assert.equal(updated.status, 'inactive');
  assert.equal(updated.summary, 'Updated summary');
});

test('active campaign listing requires active partner, active campaign, current dates, and paid or waived payment', async () => {
  const partner = await createPartner({
    slug: 'paid-partner',
    name: 'Paid Partner',
    websiteUrl: 'https://paid.example',
  });
  const now = 2_000_000_000;

  await createPartnerCampaign({
    partnerId: partner.id,
    kind: 'homepage',
    status: 'active',
    paymentStatus: 'unpaid',
    startAt: now - 10,
    endAt: now + 10,
  });
  assert.equal((await listActivePartnerCampaigns({ kind: 'homepage', now })).length, 0, 'unpaid campaign hidden');

  const paid = await createPartnerCampaign({
    partnerId: partner.id,
    kind: 'homepage',
    status: 'active',
    paymentStatus: 'paid',
    startAt: now - 10,
    endAt: now + 10,
    title: 'Presented by Paid Partner',
  });
  assert.deepEqual(
    (await listActivePartnerCampaigns({ kind: 'homepage', now })).map((c) => c.id),
    [paid.id],
  );

  await createPartnerCampaign({
    partnerId: partner.id,
    kind: 'homepage',
    status: 'active',
    paymentMethod: 'waived',
    paymentStatus: 'unpaid',
    startAt: now - 10,
    endAt: now + 10,
  });
  assert.equal((await listActivePartnerCampaigns({ kind: 'homepage', now, limit: 2 })).length, 2, 'waived payment renders');

  await createPartnerCampaign({
    partnerId: partner.id,
    kind: 'homepage',
    status: 'active',
    paymentStatus: 'paid',
    startAt: now + 100,
  });
  assert.equal((await listActivePartnerCampaigns({ kind: 'homepage', now, limit: 10 })).length, 2, 'future campaign hidden');

  await updatePartner(partner.id, { status: 'inactive' });
  assert.equal((await listActivePartnerCampaigns({ kind: 'homepage', now, limit: 10 })).length, 0, 'inactive partner hides campaigns');
});

test('targeted campaigns match exact target plus global fallback', async () => {
  const partner = await createPartner({ slug: 'target-partner', name: 'Target Partner' });
  const now = 2_100_000_000;
  const global = await createPartnerCampaign({
    partnerId: partner.id,
    kind: 'leaderboard',
    status: 'active',
    paymentStatus: 'paid',
  });
  const specific = await createPartnerCampaign({
    partnerId: partner.id,
    kind: 'leaderboard',
    target: 'season:2026',
    status: 'active',
    paymentStatus: 'paid',
  });
  await createPartnerCampaign({
    partnerId: partner.id,
    kind: 'leaderboard',
    target: 'season:2027',
    status: 'active',
    paymentStatus: 'paid',
  });

  const targeted = await listActivePartnerCampaigns({
    kind: 'leaderboard',
    target: 'season:2026',
    now,
    limit: 10,
  });
  assert.deepEqual(new Set(targeted.map((c) => c.id)), new Set([global.id, specific.id]));

  const edited = await updatePartnerCampaign(specific.id, { status: 'paused' });
  assert.equal(edited.status, 'paused');
  assert.equal((await listPartnerCampaigns({ kind: 'leaderboard' })).length >= 3, true);
});
