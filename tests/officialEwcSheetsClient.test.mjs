import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createOfficialSheetsClient,
  officialSheetsLimits,
} from '../src/services/officialEwcSheets/client.js';

const folderId = 'folder_1234567890';

function clientWith(fetch, options = {}) {
  return createOfficialSheetsClient(
    { clientEmail: '', privateKey: '' },
    { auth: { fetch }, requestGapMs: 0, retryAttempts: 0, ...options },
  );
}

test('official sheets client reuses workbook ranges during live polling', async () => {
  const requestedUrls = [];
  const client = clientWith(async (url) => {
    requestedUrls.push(url);
    if (url.includes('/values:batchGet?')) {
      return { status: 200, headers: {}, data: { valueRanges: [{ values: [['ok']] }] } };
    }
    return {
      status: 200,
      headers: {},
      data: {
        sheets: [{
          properties: {
            title: 'Match Results',
            hidden: false,
            gridProperties: { rowCount: 10, columnCount: 4 },
          },
        }],
      },
    };
  });

  await client.readWorkbook('workbook_1234567890');
  await client.readWorkbook('workbook_1234567890');

  assert.equal(requestedUrls.filter((url) => !url.includes('/values:batchGet?')).length, 1);
  assert.equal(requestedUrls.filter((url) => url.includes('/values:batchGet?')).length, 2);
});

test('official sheets client reads Gaxios response data without using Fetch response methods', async () => {
  let requestedUrl = '';
  const client = clientWith(async (url) => {
    requestedUrl = url;
    return {
      status: 200,
      headers: { 'content-length': '128' },
      data: {
        files: [
          {
            id: 'workbook_1234567890',
            name: 'VALORANT - World Championship',
            modifiedTime: '2026-07-30T12:00:00.000Z',
          },
        ],
      },
    };
  });

  assert.deepEqual(await client.listWorkbooks(folderId), [
    {
      id: 'workbook_1234567890',
      name: 'VALORANT - World Championship',
      modifiedTime: '2026-07-30T12:00:00.000Z',
    },
  ]);
  const params = new URL(requestedUrl).searchParams;
  assert.equal(params.get('includeItemsFromAllDrives'), 'true');
  assert.equal(params.get('supportsAllDrives'), 'true');
});

test('official sheets client can check one workbook modification without listing the folder', async () => {
  let requestedUrl = '';
  const client = clientWith(async (url) => {
    requestedUrl = url;
    return {
      status: 200,
      headers: {},
      data: {
        id: 'workbook_1234567890',
        name: 'VALORANT - World Championship',
        modifiedTime: '2026-08-01T12:00:00.000Z',
      },
    };
  });

  assert.deepEqual(await client.getWorkbookMetadata('workbook_1234567890'), {
    id: 'workbook_1234567890',
    name: 'VALORANT - World Championship',
    modifiedTime: '2026-08-01T12:00:00.000Z',
  });
  const url = new URL(requestedUrl);
  assert.equal(url.pathname, '/drive/v3/files/workbook_1234567890');
  assert.equal(url.searchParams.get('fields'), 'id,name,modifiedTime');
});

test('official sheets client sanitizes provider failures before they reach callers', async () => {
  const privateIdentifier = 'private-folder-should-not-leak';
  const client = clientWith(async () => {
    const error = new Error(
      `body used already for: https://www.googleapis.com/drive/v3/files?q=${privateIdentifier}`,
    );
    error.response = { status: 403 };
    throw error;
  });

  await assert.rejects(
    client.listWorkbooks(folderId),
    (error) => {
      assert.equal(error.message, 'Official tournament feed request failed (403).');
      assert.equal(error.message.includes(privateIdentifier), false);
      assert.equal(error.message.includes('googleapis.com'), false);
      return true;
    },
  );
});

test('official sheets client rejects oversized Gaxios responses before parsing data', async () => {
  const client = clientWith(async () => ({
    status: 200,
    headers: {
      'content-length': String(officialSheetsLimits.maxResponseBytes + 1),
    },
    data: { files: [] },
  }));

  await assert.rejects(
    client.listWorkbooks(folderId),
    /Official tournament feed response exceeded the configured safety limit\./,
  );
});

test('official sheets client rejects malformed provider payloads with a fixed error', async () => {
  const client = clientWith(async () => ({
    status: 200,
    headers: {},
    data: null,
  }));

  await assert.rejects(
    client.listWorkbooks(folderId),
    /Official tournament feed returned an invalid response\./,
  );
});
