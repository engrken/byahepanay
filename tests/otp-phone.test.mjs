import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizePhilippineMobileNumber, maskPhoneNumber } from '../src/lib/reporter-verification.ts';
test('normalizes Philippine 09 and +639 mobile formats',()=>{assert.equal(normalizePhilippineMobileNumber('09171234567'),'+639171234567');assert.equal(normalizePhilippineMobileNumber('+63 917 123 4567'),'+639171234567');});
test('rejects invalid and non-Philippine phone inputs',()=>{assert.equal(normalizePhilippineMobileNumber('12345'),null);assert.equal(normalizePhilippineMobileNumber('+14155552671'),null);});
test('masks phone numbers before storage or display',()=>{assert.equal(maskPhoneNumber('+639171234567'),'+63 ••• ••• 4567');});
