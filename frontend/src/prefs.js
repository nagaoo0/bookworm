// User display preferences (theme, accent, card size, search language).
// Stored in localStorage under `bw_prefs`; the inline script in index.html applies
// theme + accent before first paint, applyPrefs() keeps them in sync at runtime.
// All theming lives in CSS (styles.css) behind `data-theme` / `data-accent` on <html>.
const KEY = 'bw_prefs';

export const THEMES = [
  { value: 'dark',   label: 'Dark',   icon: 'moon' },
  { value: 'light',  label: 'Light',  icon: 'sun' },
  { value: 'sepia',  label: 'Sepia',  icon: 'coffee' },
  { value: 'system', label: 'System', icon: 'monitor' },
];
const THEME_VALUES = THEMES.map(t => t.value);

export const ACCENT_KEYS = ['amber', 'blue', 'teal', 'rose'];

// Accent fill (`main`) and its hover colour, identical in every theme (design-system §2.3).
export const ACCENT_COLORS = {
  amber: { main: '#f59e0b', hover: '#fbbf24' },
  blue:  { main: '#2563eb', hover: '#3b82f6' },
  teal:  { main: '#14b8a6', hover: '#2dd4bf' },
  rose:  { main: '#e11d48', hover: '#f43f5e' },
};

export const CARD_SIZES = { miniature: '58px', small: '80px', medium: '110px', large: '158px' };

// Page background (--surface-0) per resolved theme; used for <meta name="theme-color">.
const SURFACE_0 = { dark: '#0c0a09', light: '#faf8f5', sepia: '#f4ecd8' };

// Spec §2.1: dark unless the user picked something else.
const DEFAULTS = { theme: 'dark', cardSize: 'medium', accent: 'amber', searchLanguage: '' };

function readStored() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return s && typeof s === 'object' ? s : {};
  } catch { return {}; }
}

function normalise(p) {
  const prefs = { ...DEFAULTS, ...p };
  if (!THEME_VALUES.includes(prefs.theme)) prefs.theme = DEFAULTS.theme;   // migrates unknown/legacy values
  if (!ACCENT_COLORS[prefs.accent]) prefs.accent = DEFAULTS.accent;
  if (!CARD_SIZES[prefs.cardSize]) prefs.cardSize = DEFAULTS.cardSize;
  return prefs;
}

export function loadPrefs() {
  return normalise(readStored());
}

export function savePrefs(patch) {
  // Persist only what was ever set, so untouched prefs keep following the defaults.
  const stored = { ...readStored(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(stored)); } catch { /* private mode / quota */ }
  const prefs = normalise(stored);
  applyPrefs(prefs);
  return prefs;
}

function systemTheme() {
  try { return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; }
  catch { return 'dark'; }
}

/** The theme actually on screen: 'dark' | 'light' | 'sepia' (system resolved via the OS). */
export function resolvedTheme(prefs = loadPrefs()) {
  return prefs.theme === 'system' ? systemTheme() : prefs.theme;
}

let watchingSystem = false;
function watchSystemTheme() {
  if (watchingSystem) return;
  watchingSystem = true;
  try {
    matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
      if (loadPrefs().theme === 'system') applyPrefs();
    });
  } catch { /* old browsers */ }
}

export function applyPrefs(prefs = loadPrefs()) {
  const root = document.documentElement;
  const resolved = resolvedTheme(prefs);

  root.setAttribute('data-theme', prefs.theme);
  root.setAttribute('data-accent', prefs.accent);
  root.classList.remove('theme-light');   // legacy class from before the token system

  // Keep the browser/OS chrome (Android status bar, PWA title bar) in sync with surface-0
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', SURFACE_0[resolved]);
  document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')
    ?.setAttribute('content', resolved === 'dark' ? 'black-translucent' : 'default');

  // Card size via CSS variable consumed by .book-grid
  root.style.setProperty('--grid-min-col', CARD_SIZES[prefs.cardSize]);

  watchSystemTheme();
  // Charts and other canvas consumers re-read the tokens on this event.
  // `prefs:change` is the name used in the design spec's Stats section.
  const detail = { ...prefs, resolvedTheme: resolved };
  window.dispatchEvent(new CustomEvent('bw:prefs', { detail }));
  window.dispatchEvent(new CustomEvent('prefs:change', { detail }));
}
