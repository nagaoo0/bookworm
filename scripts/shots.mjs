// Screenshot and layout-check harness.
//   node scripts/shots.mjs [--out shots/<label>] [--only home,library,...] [--themes dark,light]
//                          [--all-accents] [--seed full|empty|shelves] [--check]
// Boots the API (embedded DB) and vite itself, seeds, captures, then stops both.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { seed } from './shots-seed.mjs';

// require (not import) so playwright resolves through NODE_PATH as well as node_modules
const { chromium } = createRequire(import.meta.url)('playwright');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'http://localhost:3000';
const APP = 'http://localhost:5173';
const ACCENTS = ['amber', 'blue', 'teal', 'rose'];
const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 390, height: 844 }];
const SLUGS = ['home', 'library', 'book', 'discover', 'community', 'profile', 'stats', 'settings', 'auth', 'public'];

// ── args ──
function parseArgs(argv) {
  const opts = { out: 'shots/latest', only: null, themes: ['dark', 'light'], allAccents: false, seed: 'full', check: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--out') opts.out = next();
    else if (a === '--only') opts.only = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--themes') opts.themes = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--seed') opts.seed = next();
    else if (a === '--all-accents') opts.allAccents = true;
    else if (a === '--check') opts.check = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  const bad = (opts.only ?? []).filter((s) => !SLUGS.includes(s));
  if (bad.length) throw new Error(`unknown --only slug: ${bad.join(', ')} (valid: ${SLUGS.join(', ')})`);
  if (!['full', 'empty', 'shelves'].includes(opts.seed)) throw new Error(`unknown --seed: ${opts.seed}`);
  return opts;
}

// ── servers ──
const children = [];
function start(cmd, args, cwd, env = {}) {
  const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: 'ignore', detached: true });
  children.push(child);
  return child;
}
function stopAll() {
  for (const c of children) {
    try { process.kill(-c.pid, 'SIGKILL'); } catch { /* already gone */ }
  }
  children.length = 0;
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { stopAll(); process.exit(130); });
process.on('exit', stopAll);

async function waitFor(url, label, ms = 90000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for ${label} at ${url}`);
}

async function assertPortFree(url, label) {
  try {
    await fetch(url);
  } catch { return; }
  throw new Error(`${label} (${url}) is already running; stop it first`);
}

// ── captures ──
// each: slug (--only group), name (file prefix), hash, auth (signed in?)
function buildCaptures(ctx) {
  return [
    { slug: 'home', name: 'home', hash: '#home', auth: true, accents: true },
    { slug: 'library', name: 'library', hash: '#library', auth: true },
    { slug: 'library', name: 'library-list', hash: '#library', auth: true, list: true },
    { slug: 'book', name: 'book', hash: `#book/${ctx.readingBookId}`, auth: true },
    { slug: 'discover', name: 'discover', hash: '#discover', auth: true },
    { slug: 'community', name: 'community-feed', hash: '#community/feed', auth: true },
    { slug: 'profile', name: 'profile', hash: '#u/mihajlo', auth: true },
    { slug: 'stats', name: 'stats-overview', hash: '#stats/overview', auth: true },
    { slug: 'settings', name: 'settings-appearance', hash: '#settings/appearance', auth: true, accents: true },
    { slug: 'auth', name: 'signedout-auth', hash: '#auth', auth: false },
    { slug: 'public', name: 'signedout-book', hash: `#book/${ctx.readingBookId}`, auth: false },
    { slug: 'public', name: 'signedout-profile', hash: '#u/mihajlo', auth: false },
  ];
}

async function openPage(browser, { viewport, theme, accent, list, cookie }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  if (cookie) {
    const [name, value] = cookie.split('=');
    await context.addCookies([{ name, value, url: APP }]);
  }
  const prefs = { theme, accent, ...(list ? { libraryView: 'list' } : {}) };
  await context.addInitScript((p) => {
    try { localStorage.setItem('bw_prefs', JSON.stringify(p)); } catch { /* ignore */ }
  }, prefs);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const url = m.location().url ?? '';
    // cover hosts failing to load is not an app error
    if (url && !url.startsWith(APP)) return;
    errors.push(m.text());
  });
  return { context, page, errors };
}

async function settle(page) {
  await page.waitForLoadState('load');
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(600);
}

async function go(page, hash) {
  await page.goto(`${APP}/${hash}`);
  await settle(page);
}

const fileName = (c, width, theme, accent) => `${c.name}-${width}-${theme}${accent ? `-${accent}` : ''}.png`;

// ── checks ──
async function overflowCheck(page) {
  return page.evaluate(() => document.documentElement.scrollWidth === window.innerWidth
    ? null : `scrollWidth ${document.documentElement.scrollWidth} != innerWidth ${window.innerWidth}`);
}

// F003: the bulk bar's first button must be the topmost element at its centre
async function bulkBarCheck(page) {
  await go(page, '#library');
  await page.click('[data-region="select-btn"]');
  await page.locator('.book-card--selectable').first().click();
  await page.waitForTimeout(300);
  return page.evaluate(() => {
    const btn = document.querySelector('#bulk-bar button');
    if (!btn) return 'bulk bar has no button';
    const r = btn.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (hit && (hit === btn || btn.contains(hit))) return null;
    const d = hit ? `${hit.tagName.toLowerCase()}${hit.id ? '#' + hit.id : ''}.${String(hit.className).split(' ')[0]}` : 'nothing';
    return `bulk bar first button is covered by ${d}`;
  });
}

// F046: focus must be inside the manual-add dialog shortly after load
async function manualFocusCheck(page) {
  await go(page, '#discover/manual');
  await page.waitForTimeout(500);
  return page.evaluate(() => {
    const modal = document.querySelector('[aria-modal="true"]');
    if (!modal) return 'no [aria-modal="true"] element on #discover/manual';
    return modal.contains(document.activeElement) ? null : 'focus is not inside the dialog 500 ms after load';
  });
}

// ── main ──
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(root, opts.out);
  mkdirSync(outDir, { recursive: true });
  const want = (slug) => !opts.only || opts.only.includes(slug);

  await assertPortFree(`${API}/api/health`, 'API');
  await assertPortFree(APP, 'vite');
  start(process.execPath, ['scripts/dev-pglite.mjs'], root, { PGLITE_FRESH: '1' });
  start('npx', ['vite', '--port', '5173', '--strictPort'], path.join(root, 'frontend'));
  await waitFor(`${API}/api/health`, 'API');
  await waitFor(APP, 'vite');
  await waitFor(`${APP}/api/health`, 'vite proxy');

  const { cookie } = await seed(API, opts.seed);
  const items = await (await fetch(`${API}/api/library`, { headers: { Cookie: cookie } })).json();
  const reading = items.find((b) => b.status === 'reading') ?? items[0];
  const ctx = { readingBookId: reading?.book_id ?? 1 };

  const captures = buildCaptures(ctx).filter((c) => want(c.slug));
  const failures = [];
  const fail = (what, msg) => { failures.push(`FAIL ${what}: ${msg}`); };
  let written = 0;

  const browser = await chromium.launch();
  try {
    for (const theme of opts.themes) {
      for (const viewport of VIEWPORTS) {
        for (const c of captures) {
          const accents = c.accents && opts.allAccents ? ACCENTS : [null];
          for (const accent of accents) {
            const { context, page, errors } = await openPage(browser, {
              viewport, theme, accent: accent ?? 'amber', list: c.list, cookie: c.auth ? cookie : null,
            });
            try {
              await go(page, c.hash);
              const file = fileName(c, viewport.width, theme, accent);
              await page.screenshot({ path: path.join(outDir, file) });
              written++;
              if (opts.check) {
                const over = await overflowCheck(page);
                if (over) fail(`${file} overflow`, over);
                const bad = errors.filter((e) => c.auth || !/401/.test(e));
                for (const e of bad) fail(`${file} console`, e.slice(0, 200));
              }
            } finally {
              await context.close();
            }
          }
        }
      }
    }

    // special checks: 390 px, first theme
    if (opts.check) {
      const viewport = VIEWPORTS[1];
      const theme = opts.themes[0];
      if (want('library')) {
        const { context, page } = await openPage(browser, { viewport, theme, accent: 'amber', cookie });
        try {
          const msg = await bulkBarCheck(page);
          if (msg) fail('F003 bulk bar tappable at 390', msg);
        } finally { await context.close(); }
      }
      if (want('discover')) {
        const { context, page } = await openPage(browser, { viewport, theme, accent: 'amber', cookie });
        try {
          const msg = await manualFocusCheck(page);
          if (msg) fail('F046 manual dialog focus', msg);
        } finally { await context.close(); }
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`${written} screenshots written to ${path.relative(root, outDir) || '.'}`);
  if (opts.check) {
    if (failures.length) console.log(failures.join('\n'));
    else console.log('all checks passed');
  }
  return failures.length ? 1 : 0;
}

let code = 1;
try {
  code = await main();
} catch (err) {
  console.error(err.message ?? err);
} finally {
  stopAll();
}
process.exit(code);
