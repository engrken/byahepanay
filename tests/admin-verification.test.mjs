import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashEmailAddress } from '../src/lib/reporter-verification.ts';
import { getDeveloperAdminEmailHash, isDeveloperAdmin } from '../src/lib/admin-verification.ts';

const SECRET = 'unit-test-secret-with-at-least-thirty-two-characters';

test('developer-admin allowlist is normalized and stored as a keyed hash', () => {
  const savedSecret = process.env.SPOTTER_SESSION_SECRET;
  const savedEmail = process.env.DEVELOPER_ADMIN_EMAIL;
  process.env.SPOTTER_SESSION_SECRET = SECRET;
  process.env.DEVELOPER_ADMIN_EMAIL = ' Kent.BSECE@GMAIL.COM ';
  assert.equal(getDeveloperAdminEmailHash(), hashEmailAddress('kent.bsece@gmail.com'));
  process.env.DEVELOPER_ADMIN_EMAIL = 'not-an-email';
  assert.equal(getDeveloperAdminEmailHash(), null);
  process.env.DEVELOPER_ADMIN_EMAIL = savedEmail ?? '';
  if (savedSecret === undefined) delete process.env.SPOTTER_SESSION_SECRET;
  else process.env.SPOTTER_SESSION_SECRET = savedSecret;
  if (savedEmail === undefined) delete process.env.DEVELOPER_ADMIN_EMAIL;
  else process.env.DEVELOPER_ADMIN_EMAIL = savedEmail;
});

test('developer-admin access requires a linked email-verified identity', async () => {
  const savedSecret = process.env.SPOTTER_SESSION_SECRET;
  const savedEmail = process.env.DEVELOPER_ADMIN_EMAIL;
  process.env.SPOTTER_SESSION_SECRET = SECRET;
  process.env.DEVELOPER_ADMIN_EMAIL = 'admin@example.com';

  let queryText = '';
  let queryValues = [];
  let mockRows = [{ ok: 1 }];
  const sql = async (strings, ...values) => {
    queryText = strings.join('?');
    queryValues = values;
    return mockRows;
  };

  assert.equal(await isDeveloperAdmin(sql, '00000000-0000-4000-8000-000000000001'), true);
  assert.match(queryText, /spotter_reporter_links/);
  assert.match(queryText, /reporter_identities/);
  assert.match(queryText, /email_hash/);
  assert.match(queryText, /verification_method = 'email'/);
  assert.equal(queryValues.includes(hashEmailAddress('admin@example.com')), true);

  mockRows = [];
  assert.equal(await isDeveloperAdmin(sql, '00000000-0000-4000-8000-000000000002'), false);

  if (savedSecret === undefined) delete process.env.SPOTTER_SESSION_SECRET;
  else process.env.SPOTTER_SESSION_SECRET = savedSecret;
  if (savedEmail === undefined) delete process.env.DEVELOPER_ADMIN_EMAIL;
  else process.env.DEVELOPER_ADMIN_EMAIL = savedEmail;
});
