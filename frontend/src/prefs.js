const KEY = 'bw_prefs';
const DEFAULTS = { theme: 'dark', cardSize: 'medium', accent: 'amber' };

export function loadPrefs() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; }
  catch { return { ...DEFAULTS }; }
}

export function savePrefs(patch) {
  const prefs = { ...loadPrefs(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(prefs));
  applyPrefs(prefs);
  return prefs;
}

export const ACCENT_COLORS = {
  amber: { main: '#f59e0b', hover: '#fbbf24' },
  blue:  { main: '#3b82f6', hover: '#60a5fa' },
  teal:  { main: '#14b8a6', hover: '#2dd4bf' },
  rose:  { main: '#f43f5e', hover: '#fb7185' },
};

const CARD_SIZES = { miniature: '58px', small: '80px', medium: '110px', large: '158px' };

export function applyPrefs(prefs = loadPrefs()) {
  const html = document.documentElement;

  // Theme class on <html> — CSS overrides cascade to all children
  html.classList.remove('theme-light', 'theme-sepia');
  if (prefs.theme !== 'dark') html.classList.add(`theme-${prefs.theme}`);

  // Card size via CSS variable consumed by .book-grid
  html.style.setProperty('--grid-min-col', CARD_SIZES[prefs.cardSize] ?? CARD_SIZES.medium);

  // Accent — overrides the custom accent vars AND Tailwind's amber scale
  // so that bg-amber-500, text-amber-400, ring-amber-500, etc. all follow the choice
  const a = ACCENT_COLORS[prefs.accent] ?? ACCENT_COLORS.amber;
  html.style.setProperty('--color-accent', a.main);
  html.style.setProperty('--color-accent-hover', a.hover);
  html.style.setProperty('--color-amber-500', a.main);
  html.style.setProperty('--color-amber-400', a.hover);
}
