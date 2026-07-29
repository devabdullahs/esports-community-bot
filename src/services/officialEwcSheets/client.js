import { JWT } from 'google-auth-library';

const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const MAX_RESPONSE_BYTES = 12 * 1024 * 1024;
const MAX_WORKBOOKS = 60;
const MAX_ROWS = 1_200;
const MAX_COLUMNS = 84;
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

async function readJson(response) {
  if (!response.ok) {
    const error = new Error(`Official tournament feed request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) {
    throw new Error('Official tournament feed response exceeded the configured safety limit.');
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
    throw new Error('Official tournament feed response exceeded the configured safety limit.');
  }
  return JSON.parse(text);
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

export function createOfficialSheetsClient(credentials) {
  const auth = authClient(credentials);

  async function fetchJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      return await readJson(
        await auth.fetch(url, {
          signal: controller.signal,
          headers: { accept: 'application/json' },
        }),
      );
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    listWorkbooks(folderId) {
      return serialize(async () => {
        const safeFolderId = resourceId(folderId, 'official feed folder');
        const files = [];
        let pageToken = '';
        do {
          const params = new URLSearchParams({
            q: `'${safeFolderId}' in parents and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`,
            fields: 'nextPageToken,files(id,name,modifiedTime)',
            orderBy: 'name',
            pageSize: '100',
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

    readWorkbook(workbookId) {
      return serialize(async () => {
        const safeWorkbookId = resourceId(workbookId, 'official feed workbook');
        const metadataParams = new URLSearchParams({
          fields: 'sheets(properties(sheetId,title,hidden,gridProperties(rowCount,columnCount)))',
        });
        const metadata = await fetchJson(`${SHEETS_BASE}/${safeWorkbookId}?${metadataParams}`);
        const sheets = (metadata.sheets || [])
          .map((sheet) => sheet?.properties)
          .filter(
            (properties) =>
              properties &&
              !properties.hidden &&
              ALLOWED_TABS.has(String(properties.title || '')),
          );
        if (!sheets.length) throw new Error('Official tournament workbook has no supported visible tabs.');

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
