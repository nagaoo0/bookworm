// The large-title row of a signed-in view (visual-v3 §6.1): date caption, h1, one summary line and the view's own
// actions. It goes first in the view. On desktop the shell's search field and notifications button sit at the
// right of this row (main.js renders them, ruling D): the row leaves room for them, and on desktop it moves up
// into the shell's top strip so the title and those controls share one line (styles.css, "Shell").
import { html } from '../utils.js';
import { delegate } from '../ui/dom.js';

let shellHandler = null;

/** main.js passes its data-shell click handler here once. */
export function setTitleBarHandler(fn) { shellHandler = fn; }

/**
 * @param {{ title: any, caption?: any, summary?: any, actions?: any }} o
 *   caption: the small uppercase line above the title (a date on Home). summary: the line below it; pass '' to
 *   render an empty line the view fills later. actions: trusted markup for the view's own controls (right of the title).
 */
export function titleBar({ title, caption, summary, actions } = {}) {
  return html`<header class="title-bar">
    ${caption ? html`<p class="label title-bar__caption">${caption}</p>` : ''}
    <div class="title-bar__row">
      <h1 class="h1 title-bar__title" data-focus-target>${title}</h1>
      ${actions ? html`<div class="title-bar__actions">${actions}</div>` : ''}
    </div>
    ${summary != null ? html`<p class="title-bar__summary" data-title-summary>${summary}</p>` : ''}
  </header>`;
}

/** Wire data-shell controls in the title bar (data-shell="search", "add-book") to the shell. */
export function mountTitleBar(root) {
  return delegate(root, 'click', '.title-bar [data-shell]', (e, el) => shellHandler?.(e, el));
}
