// Field, Select, Switch, Checkbox (design-system §5.3 – §5.5).
import { html, raw } from '../utils.js';
import { icon } from './icons.js';
import { cx, uid, attr, attrsRaw, bool, delegate } from './dom.js';

const TEXT_TYPES = new Set(['text', 'email', 'url', 'password', 'number', 'date', 'search', 'tel', 'time']);

/**
 * Label + input/textarea + hint/error.
 * @param {{ name: string, label?: string, type?: string, value?: any, placeholder?: string, hint?: string, error?: string,
 *   required?: boolean, disabled?: boolean, readonly?: boolean, autocomplete?: string, inputmode?: string,
 *   maxlength?: number, rows?: number, min?: any, max?: any, step?: any, size?: 'sm'|'md', icon?: string,
 *   id?: string, attrs?: string, ariaLabel?: string }} o
 *   type 'textarea' renders a <textarea>; 'password' gets a show/hide toggle (needs mountFields).
 *   `attrs` is a TRUSTED attribute string applied to the <input>.
 */
export function field({
  name, label, type = 'text', value = '', placeholder, hint, error, required = false, disabled = false, readonly = false,
  autocomplete, inputmode, maxlength, rows = 3, min, max, step, size = 'md', icon: iconName, id, attrs = '', ariaLabel,
} = {}) {
  const fid = id ?? uid('field');
  const hintId = `${fid}-hint`;
  const errorId = `${fid}-error`;
  const textarea = type === 'textarea';
  const password = type === 'password';
  const inputType = textarea ? null : (TEXT_TYPES.has(type) ? type : 'text');
  const describedBy = error ? errorId : (hint ? hintId : null);

  const common = html`${attr('name', name)}${attr('id', fid)}${attr('placeholder', placeholder)}${attr('autocomplete', autocomplete)}${attr('inputmode', inputmode)}${attr('maxlength', maxlength)}${bool(required, 'required')}${bool(disabled, 'disabled')}${bool(readonly, 'readonly')}${error ? raw(' aria-invalid="true"') : ''}${attr('aria-describedby', describedBy)}${attr('aria-label', !label ? ariaLabel : undefined)}${attrsRaw(attrs)}`;

  const control = textarea
    ? html`<textarea class="field__input" rows="${rows}"${common}>${value}</textarea>`
    : html`<input class="field__input" type="${inputType}" value="${value}"${attr('min', min)}${attr('max', max)}${attr('step', step)}${common}>`;

  return html`
    <div class="${cx('field', size === 'sm' && 'field--sm', iconName && 'field--icon', password && 'field--trailing', error && 'field--error')}">
      ${label ? html`<label class="field__label" for="${fid}">${label}${required ? html`<span class="field__req" aria-hidden="true">*</span>` : ''}</label>` : ''}
      <div class="field__control">
        ${iconName ? html`<span class="field__icon">${icon(iconName, { size: 20 })}</span>` : ''}
        ${control}
        ${password ? html`<span class="field__trailing"><button type="button" class="icon-btn icon-btn--sm" data-field-toggle="${fid}" aria-label="Show password" aria-pressed="false">${icon('eye', { size: 16 })}</button></span>` : ''}
      </div>
      ${error ? html`<p class="field__error" id="${errorId}" role="alert">${error}</p>` : ''}
      ${hint ? html`<p class="field__hint" id="${hintId}"${error ? raw(' hidden') : ''}>${hint}</p>` : ''}
      ${textarea && maxlength ? html`<div class="field__counter" data-counter-for="${fid}" aria-hidden="true">${String(value ?? '').length}/${maxlength}</div>` : ''}
    </div>`;
}

/**
 * Toggle the error state of a rendered field in place (no re-render, focus is kept).
 * @param {Element} rootOrInput the `.field` element or its input
 * @param {string|null} message  null / '' clears the error
 */
export function setFieldError(rootOrInput, message) {
  const root = rootOrInput?.closest?.('.field') ?? rootOrInput;
  const input = root?.querySelector?.('.field__input');
  if (!root || !input) return;
  root.querySelector('.field__error')?.remove();
  const hint = root.querySelector('.field__hint');
  if (message) {
    const p = document.createElement('p');
    p.className = 'field__error';
    p.id = `${input.id}-error`;
    p.setAttribute('role', 'alert');
    p.textContent = message;
    (hint ?? root.querySelector('.field__control')).insertAdjacentElement(hint ? 'beforebegin' : 'afterend', p);
    root.classList.add('field--error');
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', p.id);
    if (hint) hint.hidden = true;
  } else {
    root.classList.remove('field--error');
    input.removeAttribute('aria-invalid');
    if (hint) { hint.hidden = false; input.setAttribute('aria-describedby', hint.id); }
    else input.removeAttribute('aria-describedby');
  }
}

/**
 * Styled native <select>.
 * @param {{ name: string, label?: string, options: Array<{value:any,label:string,disabled?:boolean}|{group:string,options:Array}>,
 *   value?: any, hint?: string, error?: string, size?: 'sm'|'md', id?: string, disabled?: boolean, required?: boolean, attrs?: string, ariaLabel?: string }} o
 */
export function select({ name, label, options = [], value, hint, error, size = 'md', id, disabled = false, required = false, attrs = '', ariaLabel } = {}) {
  const fid = id ?? uid('select');
  const hintId = `${fid}-hint`;
  const errorId = `${fid}-error`;
  const describedBy = error ? errorId : (hint ? hintId : null);
  const opt = (o) => html`<option value="${o.value}"${bool(String(o.value) === String(value ?? ''), 'selected')}${bool(o.disabled, 'disabled')}>${o.label}</option>`;
  const renderOpts = options.map(o => (o.group !== undefined
    ? html`<optgroup label="${o.group}">${(o.options ?? []).map(opt)}</optgroup>`
    : opt(o)));
  return html`
    <div class="${cx('field', size === 'sm' && 'field--sm', error && 'field--error')}">
      ${label ? html`<label class="field__label" for="${fid}">${label}${required ? html`<span class="field__req" aria-hidden="true">*</span>` : ''}</label>` : ''}
      <div class="field__control">
        <select class="field__input field__select"${attr('name', name)} id="${fid}"${bool(disabled, 'disabled')}${bool(required, 'required')}${error ? raw(' aria-invalid="true"') : ''}${attr('aria-describedby', describedBy)}${attr('aria-label', !label ? ariaLabel : undefined)}${attrsRaw(attrs)}>${renderOpts}</select>
        <span class="field__select-icon">${icon('chevrons-up-down', { size: 16 })}</span>
      </div>
      ${error ? html`<p class="field__error" id="${errorId}" role="alert">${error}</p>` : ''}
      ${hint ? html`<p class="field__hint" id="${hintId}"${error ? raw(' hidden') : ''}>${hint}</p>` : ''}
    </div>`;
}

/**
 * On/off setting row. Behaviour: mountFields(root) toggles aria-checked and dispatches a bubbling
 * `change` CustomEvent ({ detail: { checked } }) on the switch button.
 * @param {{ id?: string, label: string, description?: string, checked?: boolean, disabled?: boolean, name?: string, attrs?: string }} o
 */
export function switchRow({ id, label, description, checked = false, disabled = false, name, attrs = '' } = {}) {
  const sid = id ?? uid('switch');
  return html`
    <div class="switch-row">
      <div class="switch-row__text">
        <span class="switch-row__label" id="${sid}-label" data-switch-label="${sid}">${label}</span>
        ${description ? html`<p class="switch-row__desc" id="${sid}-desc">${description}</p>` : ''}
      </div>
      <button type="button" role="switch" class="switch" id="${sid}" aria-checked="${checked ? 'true' : 'false'}" aria-labelledby="${sid}-label"${description ? raw(` aria-describedby="${sid}-desc"`) : ''}${attr('data-name', name)}${bool(disabled, 'disabled')}${attrsRaw(attrs)}><span class="switch__thumb"></span></button>
    </div>`;
}

/**
 * Native checkbox with a custom box. Indeterminate is applied by mountFields (it needs the DOM property).
 * @param {{ id?: string, name?: string, label?: string, checked?: boolean, indeterminate?: boolean, disabled?: boolean,
 *   value?: any, ariaLabel?: string, cls?: string, attrs?: string }} o
 */
export function checkbox({ id, name, label, checked = false, indeterminate = false, disabled = false, value, ariaLabel, cls = '', attrs = '' } = {}) {
  const cid = id ?? uid('checkbox');
  return html`<label class="${cx('checkbox', cls)}" for="${cid}"><input type="checkbox" class="checkbox__input" id="${cid}"${attr('name', name)}${attr('value', value)}${bool(checked, 'checked')}${bool(disabled, 'disabled')}${indeterminate ? raw(' data-indeterminate="true"') : ''}${attr('aria-label', !label ? ariaLabel : undefined)}${attrsRaw(attrs)}><span class="checkbox__box">${icon('check', { size: 14 })}</span>${label ? html`<span class="checkbox__label">${label}</span>` : ''}</label>`;
}

/**
 * Behaviour for everything in this file, by delegation on `root`: switches, password toggle,
 * textarea counters, indeterminate checkboxes. Call once per mounted view; returns cleanup.
 * Call again after replacing markup that contains new indeterminate checkboxes.
 */
export function mountFields(root) {
  const applyIndeterminate = () => root.querySelectorAll('input[data-indeterminate="true"]').forEach(i => { i.indeterminate = true; });
  applyIndeterminate();

  const toggleSwitch = (sw) => {
    if (sw.disabled || sw.getAttribute('aria-disabled') === 'true') return;
    const checked = sw.getAttribute('aria-checked') !== 'true';
    sw.setAttribute('aria-checked', String(checked));
    sw.dispatchEvent(new CustomEvent('change', { bubbles: true, detail: { checked } }));
  };

  const offs = [
    delegate(root, 'click', '.switch', (e, sw) => toggleSwitch(sw)),
    delegate(root, 'click', '[data-switch-label]', (e, lbl) => {
      const sw = root.querySelector(`#${CSS.escape(lbl.dataset.switchLabel)}`);
      if (sw) { toggleSwitch(sw); sw.focus(); }
    }),
    delegate(root, 'click', '[data-field-toggle]', (e, btn) => {
      const input = root.querySelector(`#${CSS.escape(btn.dataset.fieldToggle)}`);
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-pressed', String(show));
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      btn.innerHTML = String(icon(show ? 'eye-off' : 'eye', { size: 16 }));
    }),
    delegate(root, 'input', 'textarea.field__input[maxlength]', (e, ta) => {
      const counter = root.querySelector(`[data-counter-for="${CSS.escape(ta.id)}"]`);
      if (counter) counter.textContent = `${ta.value.length}/${ta.getAttribute('maxlength')}`;
    }),
  ];
  return () => offs.forEach(off => off());
}

/** Alias: switches are wired by mountFields. */
export const mountSwitches = mountFields;
