import test from 'node:test';
import assert from 'node:assert/strict';
import { normalisePrefs, ACCENT_KEYS } from '../src/prefs.js';

test('amber maps to orange', () => assert.equal(normalisePrefs({ accent: 'amber' }).accent, 'orange'));
test('orange is the default accent', () => assert.equal(normalisePrefs({}).accent, 'orange'));
test('accent keys', () => assert.deepEqual(ACCENT_KEYS, ['orange', 'blue', 'teal', 'rose']));
test('unknown theme falls back to dark', () => assert.equal(normalisePrefs({ theme: 'neon' }).theme, 'dark'));
