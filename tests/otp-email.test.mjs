import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createEmailOtpCode, hashEmailAddress, hashEmailOtp, isEmailOtpConfigured, maskEmailAddress, normalizeEmailAddress,
} from '../src/lib/reporter-verification.ts';

const SECRET = 'unit-test-secret-with-at-least-thirty-two-characters';

test('normalizes valid email addresses consistently', () => {
  assert.equal(normalizeEmailAddress('  Rider.Example+one@Example.COM '), 'rider.example+one@example.com');
  assert.equal(normalizeEmailAddress('name@sub.example.ph'), 'name@sub.example.ph');
});

test('rejects malformed email addresses and whitespace', () => {
  for (const value of ['', 'name', 'name@', '@example.com', 'name@example', 'two@@example.com', 'name @example.com', 'name@example..com']) {
    assert.equal(normalizeEmailAddress(value), null, value);
  }
});

test('masks email addresses before storage or display', () => {
  assert.equal(maskEmailAddress('ken@example.com'), 'k***@example.com');
  assert.equal(maskEmailAddress('ab@example.com'), 'a***@example.com');
});

test('email identity and OTP hashes are keyed and deterministic', () => {
  process.env.SPOTTER_SESSION_SECRET = SECRET;
  const emailHash = hashEmailAddress('ken@example.com');
  assert.equal(emailHash, hashEmailAddress('ken@example.com'));
  assert.notEqual(emailHash, hashEmailAddress('other@example.com'));
  assert.equal(hashEmailOtp(emailHash, '123456'), hashEmailOtp(emailHash, '123456'));
  assert.notEqual(hashEmailOtp(emailHash, '123456'), hashEmailOtp(emailHash, '123457'));
  process.env.SPOTTER_SESSION_SECRET = SECRET + '-different';
  assert.notEqual(emailHash, hashEmailAddress('ken@example.com'));
});

test('generated OTPs are six numeric digits', () => {
  for (let i = 0; i < 100; i++) assert.match(createEmailOtpCode(), /^\d{6}$/);
});
