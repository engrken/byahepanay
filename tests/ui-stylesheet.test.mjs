import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const css = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8');

test('tracker stylesheet retains the complete application layout', () => {
  for (const selector of [
    '.app-shell',
    '.topbar',
    '.page-content',
    '.card',
    '.arrival-card',
    '.trip-card',
    '.timeline-card',
    '.bottom-bar',
    '.action-button',
    '.modal-backdrop',
  ]) {
    assert.ok(css.includes(selector), `Missing core UI selector: ${selector}`);
  }
});

test('tracker stylesheet includes the new navigation and admin trip review UI', () => {
  for (const selector of [
    '.site-menu',
    '.ops-trip-review',
    '.ops-trip-review-meta',
    '.ops-inactive-action',
  ]) {
    assert.ok(css.includes(selector), `Missing release UI selector: ${selector}`);
  }
});
