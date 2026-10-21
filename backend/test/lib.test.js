// Pure helpers: no database, no app.
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../src/lib/slug.js';
import { baseUrl, clampPct } from '../src/integrations/http.js';
import { fetchWithTimeout } from '../src/lib/fetchWithTimeout.js';
import { sessionTimezone, pgOptions } from '../src/lib/pgTimezone.js';

describe('slugify', () => {
  it('lowercases, folds accents, collapses runs of non-alphanumerics to one dash', () => {
    assert.equal(slugify('Sci-Fi & Fantasy'), 'sci-fi-fantasy');
    assert.equal(slugify('  Café   Reads  '), 'cafe-reads');
    assert.equal(slugify('To_Read 2024!'), 'to-read-2024');
  });
  it('never returns an empty slug', () => {
    assert.equal(slugify('日本語'), 'shelf');
    assert.equal(slugify('!!!'), 'shelf');
    assert.equal(slugify(null), 'shelf');
  });
  it('is stable across the formats the old importer / UI produced for plain names', () => {
    // old importer: name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')
    for (const name of ['Favourites', 'Sci-Fi', 'Book Club 2023']) {
      assert.equal(slugify(name), name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
    }
  });
});

describe('integration http helpers', () => {
  it('baseUrl strips trailing slashes and tolerates a missing url', () => {
    assert.equal(baseUrl({ serverUrl: 'http://x.lan:8083/' }), 'http://x.lan:8083');
    assert.equal(baseUrl({ serverUrl: 'http://x.lan:8083//' }), 'http://x.lan:8083');
    assert.equal(baseUrl({}), '');
    assert.equal(baseUrl(undefined), '');
  });
  it('clampPct keeps progress within 0-100 and rejects non-numbers', () => {
    assert.equal(clampPct(42.4), 42);
    assert.equal(clampPct(100.4), 100);
    assert.equal(clampPct(250), 100);
    assert.equal(clampPct(-3), 0);
    assert.equal(clampPct('55'), 55);
    for (const bad of [null, undefined, '', NaN, Infinity, 'abc']) assert.equal(clampPct(bad), null);
  });
});

describe('fetchWithTimeout', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  it('aborts a request that outlasts the timeout', async () => {
    globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
    await assert.rejects(fetchWithTimeout('http://slow.example/', { timeoutMs: 20 }), { name: 'AbortError' });
  });

  it('passes init (headers) through and returns the response', async () => {
    let seen;
    globalThis.fetch = async (url, init) => { seen = { url, init }; return new Response('ok'); };
    const res = await fetchWithTimeout('http://fast.example/x', { headers: { 'X-Test': '1' } });
    assert.equal(await res.text(), 'ok');
    assert.equal(seen.init.headers['X-Test'], '1');
    assert.ok(seen.init.signal instanceof AbortSignal);
    assert.equal(seen.init.timeoutMs, undefined, 'timeoutMs is ours, not fetch\'s');
  });
});

describe('session time zone', () => {
  it('defaults to UTC and honours PG_TIMEZONE', () => {
    assert.equal(sessionTimezone({}), 'UTC');
    assert.equal(sessionTimezone({ PG_TIMEZONE: '  ' }), 'UTC');
    assert.equal(sessionTimezone({ PG_TIMEZONE: 'Europe/Berlin' }), 'Europe/Berlin');
    assert.equal(pgOptions({}), '-c timezone=UTC');
    assert.equal(pgOptions({ PG_TIMEZONE: 'America/Argentina/Buenos_Aires' }), '-c timezone=America/Argentina/Buenos_Aires');
  });
  it('rejects values that could smuggle extra libpq options', () => {
    const warn = console.warn; console.warn = () => {};
    try {
      assert.equal(sessionTimezone({ PG_TIMEZONE: 'UTC -c statement_timeout=1' }), 'UTC');
      assert.equal(sessionTimezone({ PG_TIMEZONE: "x';drop" }), 'UTC');
    } finally { console.warn = warn; }
  });
});
