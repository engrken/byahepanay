import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requireReporterIdentity } from '../src/lib/reporter-verification.ts';

test('contribution guard rejects a session without verified email when enforcement is enabled', async () => {
  const previous = process.env.REQUIRE_EMAIL_VERIFICATION;
  process.env.REQUIRE_EMAIL_VERIFICATION = 'true';
  const sql = async () => [];
  const result = await requireReporterIdentity(sql, '00000000-0000-4000-8000-000000000001');
  assert.deepEqual(result, { reporterId: null, required: true, allowed: false });
  if (previous === undefined) delete process.env.REQUIRE_EMAIL_VERIFICATION;
  else process.env.REQUIRE_EMAIL_VERIFICATION = previous;
});

test('contribution guard permits verified email and local mode when enforcement is disabled', async () => {
  const previous = process.env.REQUIRE_EMAIL_VERIFICATION;
  process.env.REQUIRE_EMAIL_VERIFICATION = 'true';
  const verifiedSql = async () => [{ reporter_id: '00000000-0000-4000-8000-000000000099' }];
  const verified = await requireReporterIdentity(verifiedSql, '00000000-0000-4000-8000-000000000001');
  assert.deepEqual(verified, { reporterId: '00000000-0000-4000-8000-000000000099', required: true, allowed: true });

  process.env.REQUIRE_EMAIL_VERIFICATION = 'false';
  const anonymous = await requireReporterIdentity(async () => [], '00000000-0000-4000-8000-000000000002');
  assert.deepEqual(anonymous, { reporterId: null, required: false, allowed: true });

  if (previous === undefined) delete process.env.REQUIRE_EMAIL_VERIFICATION;
  else process.env.REQUIRE_EMAIL_VERIFICATION = previous;
});
