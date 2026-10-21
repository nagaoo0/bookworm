// Settings (#settings, #settings/:section). Spec: docs/design-system.md §8.8.
// Desktop: section nav on the left, content on the right. Mobile: `#settings` is the section list,
// a section opens as a drill-down with a back link. Every section is its own module exporting
// `mount(el, { user }) → cleanup`; they are loaded on demand.
import { html } from '../../utils.js';
import { getState } from '../../store.js';
import { icon, emptyState, EMPTY, ACTION, NAV, delegate, skeletonCard } from '../../ui/index.js';
import { createScope } from './common.js';

const SECTIONS = [
  { id: 'profile',       label: NAV.profile,      icon: 'user',        load: () => import('./profile.js') },
  { id: 'account',       label: 'Account',        icon: 'lock',        load: () => import('./account.js') },
  { id: 'appearance',    label: 'Appearance',     icon: 'palette',     load: () => import('./appearance.js') },
  { id: 'reading',       label: 'Reading',        icon: 'target',      load: () => import('./reading.js') },
  { id: 'integrations',  label: 'Integrations',   icon: 'link',        load: () => import('./integrations.js') },
  { id: 'library-tools', label: NAV.libraryTools, icon: 'library-big', load: () => import('./libraryTools.js') },
  { id: 'admin',         label: NAV.admin,        icon: 'shield',      load: () => import('./admin.js'), adminOnly: true },
];

const DESKTOP = '(min-width: 768px)';

/**
 * @param {HTMLElement} el
 * @param {{ section?: string }} [params]
 * @returns {() => void} cleanup
 */
export function renderSettings(el, { section } = {}) {
  const scope = createScope();
  const user = getState().user;
  if (!user) return scope.dispose;

  const visible = SECTIONS.filter(s => !s.adminOnly || user.isAdmin);
  let current = SECTIONS.some(s => s.id === section) ? section : undefined;
  let mq = null;
  try { mq = matchMedia(DESKTOP); } catch { /* no matchMedia */ }
  let sectionCleanup = null;
  let showSeq = 0;

  const setHash = (hash) => { try { history.replaceState(null, '', hash); } catch { /* sandboxed frames */ } };

  async function show() {
    const seq = ++showSeq;
    sectionCleanup?.();
    sectionCleanup = null;

    if (current === 'admin' && !user.isAdmin) { current = 'profile'; setHash('#settings/profile'); }
    if (!current && mq?.matches) { current = 'profile'; setHash('#settings/profile'); }
    const def = visible.find(s => s.id === current);

    el.innerHTML = String(html`
      <div class="max-w-5xl mx-auto space-y-6">
        <h1 class="h1${def ? ' sr-only md:not-sr-only' : ''}">Settings</h1>
        <div class="md:grid md:grid-cols-4 md:gap-8">
          <nav aria-label="Settings sections" class="${def ? 'hidden md:block' : ''}">
            <ul class="rounded-lg border border-border-1 bg-surface-1 divide-y divide-border-1 md:border-0 md:bg-transparent md:divide-y-0 md:space-y-1">
              ${visible.map(s => html`<li>
                <a href="#settings/${s.id}" class="flex items-center gap-3 min-h-11 px-3 rounded-md text-body transition-colors duration-[var(--dur-fast)] ${s.id === current ? 'bg-accent-soft text-accent-text' : 'text-text-1 md:text-text-2 hover:bg-surface-2 hover:text-text-1'}"${s.id === current ? html` aria-current="page"` : ''}>
                  ${icon(s.icon, { size: 20 })}
                  <span class="flex-1">${s.label}</span>
                  <span class="md:hidden text-text-3">${icon('chevron-right', { size: 16 })}</span>
                </a>
              </li>`)}
            </ul>
          </nav>
          <div class="md:col-span-3 min-w-0 ${def ? '' : 'hidden md:block'}">
            ${def ? html`
              <a class="md:hidden inline-flex items-center gap-1.5 min-h-11 text-small text-text-2 hover:text-text-1" href="#settings">${icon('arrow-left', { size: 16 })}${NAV.settings}</a>
              <div class="max-w-2xl space-y-4">
                <h2 class="h2" data-settings-title tabindex="-1">${def.label}</h2>
                <div data-section-body class="space-y-4">${skeletonCard()}</div>
              </div>` : ''}
          </div>
        </div>
      </div>`);

    if (!def) return;
    const body = el.querySelector('[data-section-body]');
    try {
      const mod = await def.load();
      if (scope.disposed || seq !== showSeq) return;
      body.innerHTML = '';
      const cleanup = await mod.mount(body, { user: getState().user });
      if (scope.disposed || seq !== showSeq) { cleanup?.(); return; }
      sectionCleanup = typeof cleanup === 'function' ? cleanup : null;
    } catch {
      if (scope.disposed || seq !== showSeq) return;
      const e = EMPTY.loadError;
      body.innerHTML = String(emptyState({ icon: e.icon, title: e.title, body: e.body, action: { label: ACTION.tryAgain, attrs: 'data-action="retry"' } }));
    }
  }

  scope.add(delegate(el, 'click', '[data-action="retry"]', () => show()));
  scope.add(() => { showSeq++; sectionCleanup?.(); sectionCleanup = null; });

  // Crossing the md breakpoint changes whether `#settings` is a list or redirects to the first section
  if (mq) {
    const onChange = () => { if (!current) show(); };
    mq.addEventListener?.('change', onChange);
    scope.add(() => mq.removeEventListener?.('change', onChange));
  }

  show();
  return scope.dispose;
}
