import { all, get, run } from './client.js';

export const PARTNER_INTERESTS = ['open_source_partner', 'prediction_partner', 'event_prize_later', 'other'];
export const PARTNER_INQUIRY_STATUSES = ['new', 'contacted', 'approved', 'declined', 'converted'];
export const PARTNER_STATUSES = ['active', 'inactive'];
export const PARTNER_CAMPAIGN_KINDS = ['homepage', 'footer', 'predictions', 'leaderboard', 'tournament'];
export const PARTNER_CAMPAIGN_STATUSES = ['draft', 'active', 'paused', 'ended'];
export const PARTNER_PAYMENT_METHODS = ['github_sponsors', 'bank_transfer', 'paypal', 'other', 'waived'];
export const PARTNER_PAYMENT_STATUSES = ['unpaid', 'pending', 'paid'];

function nowText() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function changes(result) {
  return result?.changes ?? result?.rowCount ?? 0;
}

function clean(value, max = 1000) {
  return String(value ?? '').trim().slice(0, max);
}

function nullable(value, max = 1000) {
  const trimmed = clean(value, max);
  return trimmed || null;
}

function nullableInt(value) {
  if (value == null || value === '') return null;
  const n = Math.trunc(Number(value));
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function ensureOneOf(value, allowed, fallback = null) {
  const raw = clean(value, 80);
  if (allowed.includes(raw)) return raw;
  if (fallback !== null) return fallback;
  throw new Error(`Invalid value: ${raw || '(empty)'}`);
}

function hydrateInquiry(row) {
  if (!row) return null;
  return {
    id: row.id,
    organizationName: row.organization_name,
    contactName: row.contact_name,
    email: row.email,
    websiteUrl: row.website_url || null,
    interest: row.interest,
    message: row.message || '',
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function hydratePartner(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    logoUrl: row.logo_url || null,
    websiteUrl: row.website_url || null,
    summary: row.summary || '',
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function partnerFromCampaignRow(row) {
  if (!row || row.partner_name == null) return null;
  return {
    id: row.partner_id,
    slug: row.partner_slug,
    name: row.partner_name,
    logoUrl: row.partner_logo_url || null,
    websiteUrl: row.partner_website_url || null,
    summary: row.partner_summary || '',
    status: row.partner_status,
    createdAt: row.partner_created_at,
    updatedAt: row.partner_updated_at,
  };
}

function hydrateCampaign(row) {
  if (!row) return null;
  return {
    id: row.id,
    partnerId: row.partner_id,
    kind: row.kind,
    target: row.target || '',
    title: row.title || '',
    note: row.note || '',
    startAt: row.start_at ?? null,
    endAt: row.end_at ?? null,
    status: row.status,
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    paymentReference: row.payment_reference || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    partner: partnerFromCampaignRow(row),
  };
}

const CAMPAIGN_SELECT = `
  SELECT
    c.*,
    p.slug AS partner_slug,
    p.name AS partner_name,
    p.logo_url AS partner_logo_url,
    p.website_url AS partner_website_url,
    p.summary AS partner_summary,
    p.status AS partner_status,
    p.created_at AS partner_created_at,
    p.updated_at AS partner_updated_at
  FROM partner_campaigns c
  JOIN partners p ON p.id = c.partner_id
`;

export async function createPartnerInquiry({
  organizationName,
  contactName,
  email,
  websiteUrl = null,
  interest,
  message = '',
}) {
  const now = nowText();
  const row = await get(
    `INSERT INTO partner_inquiries
       (organization_name, contact_name, email, website_url, interest, message, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'new', $7, $7)
     RETURNING *`,
    [
      clean(organizationName, 160),
      clean(contactName, 120),
      clean(email, 254).toLowerCase(),
      nullable(websiteUrl, 512),
      ensureOneOf(interest, PARTNER_INTERESTS),
      clean(message, 2000),
      now,
    ],
  );
  return hydrateInquiry(row);
}

export async function listPartnerInquiries({ status = null, limit = 100, offset = 0 } = {}) {
  const params = [];
  const where = [];
  if (status) {
    params.push(ensureOneOf(status, PARTNER_INQUIRY_STATUSES));
    where.push(`status = $${params.length}`);
  }
  params.push(Math.min(250, Math.max(1, Math.trunc(Number(limit) || 100))));
  const limitRef = `$${params.length}`;
  params.push(Math.max(0, Math.trunc(Number(offset) || 0)));
  const offsetRef = `$${params.length}`;
  const rows = await all(
    `SELECT * FROM partner_inquiries ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY created_at DESC, id DESC
     LIMIT ${limitRef} OFFSET ${offsetRef}`,
    params,
  );
  return rows.map(hydrateInquiry);
}

export async function getPartnerInquiry(id) {
  return hydrateInquiry(await get('SELECT * FROM partner_inquiries WHERE id = $1', [Number(id)]));
}

export async function updatePartnerInquiryStatus(id, status) {
  const cleanStatus = ensureOneOf(status, PARTNER_INQUIRY_STATUSES);
  const info = await run(
    'UPDATE partner_inquiries SET status = $1, updated_at = $2 WHERE id = $3',
    [cleanStatus, nowText(), Number(id)],
  );
  if (!changes(info)) return null;
  return getPartnerInquiry(id);
}

export async function createPartner({ slug, name, logoUrl = null, websiteUrl = null, summary = '', status = 'active' }) {
  const now = nowText();
  const row = await get(
    `INSERT INTO partners (slug, name, logo_url, website_url, summary, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
     RETURNING *`,
    [
      clean(slug, 80),
      clean(name, 160),
      nullable(logoUrl, 512),
      nullable(websiteUrl, 512),
      clean(summary, 600),
      ensureOneOf(status, PARTNER_STATUSES, 'active'),
      now,
    ],
  );
  return hydratePartner(row);
}

export async function getPartner(idOrSlug) {
  const raw = String(idOrSlug ?? '').trim();
  const row = /^\d+$/.test(raw)
    ? await get('SELECT * FROM partners WHERE id = $1', [Number(raw)])
    : await get('SELECT * FROM partners WHERE slug = $1', [raw]);
  return hydratePartner(row);
}

export async function listPartners({ activeOnly = false } = {}) {
  const rows = await all(
    `SELECT * FROM partners ${activeOnly ? "WHERE status = 'active'" : ''}
     ORDER BY status ASC, name ASC, id ASC`,
  );
  return rows.map(hydratePartner);
}

export async function updatePartner(id, patch = {}) {
  const sets = [];
  const params = [];
  const push = (col, value) => {
    params.push(value);
    sets.push(`${col} = $${params.length}`);
  };
  if (patch.slug !== undefined) push('slug', clean(patch.slug, 80));
  if (patch.name !== undefined) push('name', clean(patch.name, 160));
  if (patch.logoUrl !== undefined) push('logo_url', nullable(patch.logoUrl, 512));
  if (patch.websiteUrl !== undefined) push('website_url', nullable(patch.websiteUrl, 512));
  if (patch.summary !== undefined) push('summary', clean(patch.summary, 600));
  if (patch.status !== undefined) push('status', ensureOneOf(patch.status, PARTNER_STATUSES));
  if (!sets.length) return getPartner(id);
  push('updated_at', nowText());
  params.push(Number(id));
  const info = await run(`UPDATE partners SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
  if (!changes(info)) return null;
  return getPartner(id);
}

export async function deletePartner(id) {
  const info = await run('DELETE FROM partners WHERE id = $1', [Number(id)]);
  return { deleted: changes(info) };
}

export async function createPartnerCampaign({
  partnerId,
  kind,
  target = '',
  title = '',
  note = '',
  startAt = null,
  endAt = null,
  status = 'draft',
  paymentMethod = 'github_sponsors',
  paymentStatus = 'unpaid',
  paymentReference = null,
}) {
  const now = nowText();
  const row = await get(
    `INSERT INTO partner_campaigns
       (partner_id, kind, target, title, note, start_at, end_at, status, payment_method, payment_status,
        payment_reference, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
     RETURNING id`,
    [
      Number(partnerId),
      ensureOneOf(kind, PARTNER_CAMPAIGN_KINDS),
      clean(target, 120),
      clean(title, 160),
      clean(note, 600),
      nullableInt(startAt),
      nullableInt(endAt),
      ensureOneOf(status, PARTNER_CAMPAIGN_STATUSES, 'draft'),
      ensureOneOf(paymentMethod, PARTNER_PAYMENT_METHODS, 'github_sponsors'),
      ensureOneOf(paymentStatus, PARTNER_PAYMENT_STATUSES, 'unpaid'),
      nullable(paymentReference, 240),
      now,
    ],
  );
  return getPartnerCampaign(row.id);
}

export async function getPartnerCampaign(id) {
  return hydrateCampaign(
    await get(`${CAMPAIGN_SELECT} WHERE c.id = $1`, [Number(id)]),
  );
}

export async function listPartnerCampaigns({ kind = null, partnerId = null } = {}) {
  const where = [];
  const params = [];
  if (kind) {
    params.push(ensureOneOf(kind, PARTNER_CAMPAIGN_KINDS));
    where.push(`c.kind = $${params.length}`);
  }
  if (partnerId) {
    params.push(Number(partnerId));
    where.push(`c.partner_id = $${params.length}`);
  }
  const rows = await all(
    `${CAMPAIGN_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY c.created_at DESC, c.id DESC`,
    params,
  );
  return rows.map(hydrateCampaign);
}

export async function listActivePartnerCampaigns({ kind, target = '', now = Math.floor(Date.now() / 1000), limit = 1 }) {
  const cleanKind = ensureOneOf(kind, PARTNER_CAMPAIGN_KINDS);
  const cleanTarget = clean(target, 120);
  const params = [cleanKind];
  const where = [
    'c.kind = $1',
    "c.status = 'active'",
    "p.status = 'active'",
    "(c.payment_status = 'paid' OR c.payment_method = 'waived')",
  ];
  if (cleanTarget) {
    params.push(cleanTarget);
    where.push(`(c.target = '' OR c.target = $${params.length})`);
  } else {
    where.push("c.target = ''");
  }
  params.push(Number(now));
  where.push(`(c.start_at IS NULL OR c.start_at <= $${params.length})`);
  params.push(Number(now));
  where.push(`(c.end_at IS NULL OR c.end_at >= $${params.length})`);
  params.push(Math.min(12, Math.max(1, Math.trunc(Number(limit) || 1))));
  const rows = await all(
    `${CAMPAIGN_SELECT}
     WHERE ${where.join(' AND ')}
     ORDER BY COALESCE(c.start_at, 0) DESC, c.id DESC
     LIMIT $${params.length}`,
    params,
  );
  return rows.map(hydrateCampaign);
}

export async function updatePartnerCampaign(id, patch = {}) {
  const sets = [];
  const params = [];
  const push = (col, value) => {
    params.push(value);
    sets.push(`${col} = $${params.length}`);
  };
  if (patch.partnerId !== undefined) push('partner_id', Number(patch.partnerId));
  if (patch.kind !== undefined) push('kind', ensureOneOf(patch.kind, PARTNER_CAMPAIGN_KINDS));
  if (patch.target !== undefined) push('target', clean(patch.target, 120));
  if (patch.title !== undefined) push('title', clean(patch.title, 160));
  if (patch.note !== undefined) push('note', clean(patch.note, 600));
  if (patch.startAt !== undefined) push('start_at', nullableInt(patch.startAt));
  if (patch.endAt !== undefined) push('end_at', nullableInt(patch.endAt));
  if (patch.status !== undefined) push('status', ensureOneOf(patch.status, PARTNER_CAMPAIGN_STATUSES));
  if (patch.paymentMethod !== undefined) {
    push('payment_method', ensureOneOf(patch.paymentMethod, PARTNER_PAYMENT_METHODS));
  }
  if (patch.paymentStatus !== undefined) {
    push('payment_status', ensureOneOf(patch.paymentStatus, PARTNER_PAYMENT_STATUSES));
  }
  if (patch.paymentReference !== undefined) {
    push('payment_reference', nullable(patch.paymentReference, 240));
  }
  if (!sets.length) return getPartnerCampaign(id);
  push('updated_at', nowText());
  params.push(Number(id));
  const info = await run(`UPDATE partner_campaigns SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
  if (!changes(info)) return null;
  return getPartnerCampaign(id);
}

export async function deletePartnerCampaign(id) {
  const info = await run('DELETE FROM partner_campaigns WHERE id = $1', [Number(id)]);
  return { deleted: changes(info) };
}
