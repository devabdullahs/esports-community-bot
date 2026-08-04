import { JWT } from 'google-auth-library';

const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const MAX_RESPONSE_BYTES = 12 * 1024 * 1024;
const MAX_WORKBOOKS = 60;
const MAX_ROWS = 1_200;
const MAX_COLUMNS = 84;
const DEFAULT_RANGE_CACHE_TTL_MS = 15 * 60 * 1_000;
const DEFAULT_REQUEST_GAP_MS = 150;
const DEFAULT_RETRY_ATTEMPTS = 2;
const GOOGLE_RESOURCE_ID = /^[A-Za-z0-9_-]{10,200}$/;
const ALLOWED_TABS = new Set([
  'Tournament Information',
  'Schedule',
  'Qualification Details',
  'Participant Information',
  'Participant Rosters',
  'Visualization',
  'League Table',
  'Knockout Bracket',
  'Match Results',
  'Drafts',
  'MATCH INFO MASTER',
  // Rainbow Six publishes its map veto per series format, one tab each.
  'BO1_VETOS',
  'BO3_VETOS',
  'BO5_VETO',
]);

let queueTail = Promise.resolve();

function serialize(task) {
  const job = queueTail.catch(() => {}).then(task);
  queueTail = job;
  return job;
}

function quotedRange(title, rowCount, columnCount) {
  const escaped = String(title).replaceAll("'", "''");
  const rows = Math.min(MAX_ROWS, Math.max(1, Number(rowCount) || MAX_ROWS));
  const columns = Math.min(MAX_COLUMNS, Math.max(1, Number(columnCount) || MAX_COLUMNS));
  let label = '';
  let value = columns;
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return `'${escaped}'!A1:${label}${rows}`;
}

function responseHeader(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  const entry = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  );
  return entry?.[1] ?? null;
}

function safeStatus(value) {
  const status = Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}

function requestError(status = null) {
  const error = new Error(
    status
      ? `Official tournament feed request failed (${status}).`
      : 'Official tournament feed request failed.',
  );
  if (status) error.status = status;
  return error;
}

function readJson(response) {
  const status = safeStatus(response?.status);
  if (!status || status < 200 || status >= 300) {
    const error = requestError(status);
    error.retryAfter = responseHeader(response?.headers, 'retry-after');
    throw error;
  }

  const length = Number(responseHeader(response.headers, 'content-length'));
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) {
    throw new Error('Official tournament feed response exceeded the configured safety limit.');
  }

  let text;
  let data;
  try {
    if (typeof response.data === 'string') {
      text = response.data;
      data = JSON.parse(text);
    } else if (response.data && typeof response.data === 'object') {
      data = response.data;
      text = JSON.stringify(data);
    } else {
      throw new TypeError('Unexpected response payload.');
    }
    if (typeof text !== 'string') throw new TypeError('Unexpected response payload.');
  } catch {
    throw new Error('Official tournament feed returned an invalid response.');
  }

  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
    throw new Error('Official tournament feed response exceeded the configured safety limit.');
  }
  return data;
}

function authClient({ clientEmail, privateKey }) {
  return new JWT({
    email: clientEmail,
    key: String(privateKey || '').replaceAll('\\n', '\n'),
    scopes: [
      'https://www.googleapis.com/auth/drive.metadata.readonly',
      'https://www.googleapis.com/auth/spreadsheets.readonly',
    ],
  });
}

function resourceId(value, label) {
  const id = String(value || '').trim();
  if (!GOOGLE_RESOURCE_ID.test(id)) {
    throw new Error(`Invalid ${label} configuration.`);
  }
  return id;
}

export function createOfficialSheetsClient(credentials, options = {}) {
  const auth = options.auth || authClient(credentials);
  const sleep = options.sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const now = options.now || (() => Date.now());
  const rangeCacheTtlMs = Math.max(1_000, Number(options.rangeCacheTtlMs) || DEFAULT_RANGE_CACHE_TTL_MS);
  const requestGapMs = Number.isFinite(Number(options.requestGapMs))
    ? Math.max(0, Number(options.requestGapMs))
    : DEFAULT_REQUEST_GAP_MS;
  const retryAttempts = Number.isFinite(Number(options.retryAttempts))
    ? Math.max(0, Number(options.retryAttempts))
    : DEFAULT_RETRY_ATTEMPTS;
  const rangeCache = new Map();
  let nextRequestAt = 0;
  let backoffUntil = 0;

  function retryDelay(error, attempt) {
    const raw = String(error?.retryAfter || '').trim();
    if (raw) {
      const seconds = Number(raw);
      if (Number.isFinite(seconds) && seconds >= 0) return Math.min(30_000, seconds * 1_000);
      const retryAt = Date.parse(raw);
      if (Number.isFinite(retryAt)) return Math.min(30_000, Math.max(0, retryAt - now()));
    }
    return Math.min(30_000, 1_000 * (2 ** attempt));
  }

  function retryable(error) {
    return error?.status === 403 || error?.status === 429 || error?.status >= 500;
  }

  async function fetchJson(url) {
    for (let attempt = 0; attempt <= retryAttempts; attempt += 1) {
      const waitMs = Math.max(0, nextRequestAt - now(), backoffUntil - now());
      if (waitMs) await sleep(waitMs);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20_000);
      try {
        const data = await readJson(
          await auth.fetch(url, {
            signal: controller.signal,
            headers: { accept: 'application/json' },
          }),
        );
        backoffUntil = 0;
        return data;
      } catch (error) {
        let safeError = error;
        if (controller.signal.aborted) {
          safeError = new Error('Official tournament feed request timed out.');
        } else if (!String(error?.message || '').startsWith('Official tournament feed ')) {
          safeError = requestError(safeStatus(error?.status ?? error?.response?.status));
        }
        if (attempt >= retryAttempts || !retryable(safeError)) throw safeError;
        backoffUntil = now() + retryDelay(safeError, attempt);
      } finally {
        clearTimeout(timer);
        nextRequestAt = Math.max(nextRequestAt, now() + requestGapMs);
      }
    }
    throw requestError();
  }

  async function workbookRanges(workbookId) {
    const cached = rangeCache.get(workbookId);
    if (cached && cached.expiresAt > now()) return cached.sheets;

    const metadataParams = new URLSearchParams({
      fields: 'sheets(properties(sheetId,title,hidden,gridProperties(rowCount,columnCount)))',
    });
    const metadata = await fetchJson(`${SHEETS_BASE}/${workbookId}?${metadataParams}`);
    const sheets = (metadata.sheets || [])
      .map((sheet) => sheet?.properties)
      .filter(
        (properties) =>
          properties &&
          !properties.hidden &&
          ALLOWED_TABS.has(String(properties.title || '')),
      );
    if (!sheets.length) throw new Error('Official tournament workbook has no supported visible tabs.');
    rangeCache.set(workbookId, { sheets, expiresAt: now() + rangeCacheTtlMs });
    return sheets;
  }

  return {
    getWorkbookMetadata(workbookId) {
      return serialize(async () => {
        const safeWorkbookId = resourceId(workbookId, 'official feed workbook');
        const params = new URLSearchParams({
          fields: 'id,name,modifiedTime',
          supportsAllDrives: 'true',
        });
        const file = await fetchJson(`${DRIVE_BASE}/files/${safeWorkbookId}?${params}`);
        if (!file?.id || !file?.name) {
          throw new Error('Official tournament feed returned incomplete workbook metadata.');
        }
        return {
          id: String(file.id),
          name: String(file.name),
          modifiedTime: String(file.modifiedTime || ''),
        };
      });
    },

    listWorkbooks(folderId) {
      return serialize(async () => {
        const safeFolderId = resourceId(folderId, 'official feed folder');
        const files = [];
        let pageToken = '';
        do {
          const params = new URLSearchParams({
            q: `'${safeFolderId}' in parents and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`,
            fields: 'nextPageToken,files(id,name,modifiedTime)',
            includeItemsFromAllDrives: 'true',
            orderBy: 'name',
            pageSize: '100',
            supportsAllDrives: 'true',
          });
          if (pageToken) params.set('pageToken', pageToken);
          const data = await fetchJson(`${DRIVE_BASE}/files?${params}`);
          for (const file of data.files || []) {
            if (files.length >= MAX_WORKBOOKS) break;
            if (file?.id && file?.name) {
              files.push({
                id: String(file.id),
                name: String(file.name),
                modifiedTime: String(file.modifiedTime || ''),
              });
            }
          }
          pageToken = files.length < MAX_WORKBOOKS ? String(data.nextPageToken || '') : '';
        } while (pageToken);
        return files;
      });
    },

    readWorkbook(workbookId, { tabTitles = null } = {}) {
      return serialize(async () => {
        const safeWorkbookId = resourceId(workbookId, 'official feed workbook');
        const availableSheets = await workbookRanges(safeWorkbookId);
        const requestedTitles = Array.isArray(tabTitles)
          ? new Set(tabTitles.map((title) => String(title || '').trim()).filter(Boolean))
          : null;
        const sheets = requestedTitles
          ? availableSheets.filter((sheet) => requestedTitles.has(String(sheet.title || '')))
          : availableSheets;
        if (!sheets.length) {
          throw new Error('Official tournament workbook has no requested visible tabs.');
        }

        const params = new URLSearchParams({
          majorDimension: 'ROWS',
          valueRenderOption: 'UNFORMATTED_VALUE',
          dateTimeRenderOption: 'SERIAL_NUMBER',
        });
        for (const sheet of sheets) {
          params.append(
            'ranges',
            quotedRange(
              sheet.title,
              sheet.gridProperties?.rowCount,
              sheet.gridProperties?.columnCount,
            ),
          );
        }
        const data = await fetchJson(
          `${SHEETS_BASE}/${safeWorkbookId}/values:batchGet?${params}`,
        );
        const tabs = {};
        for (let index = 0; index < sheets.length; index += 1) {
          tabs[sheets[index].title] = (data.valueRanges?.[index]?.values || []).slice(0, MAX_ROWS);
        }
        return tabs;
      });
    },
  };
}

export const officialSheetsLimits = Object.freeze({
  maxResponseBytes: MAX_RESPONSE_BYTES,
  maxWorkbooks: MAX_WORKBOOKS,
  maxRows: MAX_ROWS,
  maxColumns: MAX_COLUMNS,
});
