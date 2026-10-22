// Settings · Integrations: Audiobookshelf and Calibre-Web (+ Kobo sync token), one card per service.
// Behaviour is delegated on the section element, so replacing a card never needs re-binding.
import { api } from '../../api.js';
import { html } from '../../utils.js';
import {
  TOAST, badge, button, card, delegate, field, icon, mountConfirmInline, mountFields, select, setButtonLoading,
  setFieldError, skeletonCard, switchRow, timeAgo, toast,
} from '../../ui/index.js';
import { createScope, errorText, isHttpUrl } from './common.js';

const SERVICES = {
  audiobookshelf: { label: 'Audiobookshelf', icon: 'headphones', tone: '--info-fg' },
  calibre: { label: 'Calibre-Web', icon: 'book-copy', tone: '--success-fg' },
};

/** Service roundel: the service's icon on a tinted disc (40 px on cards, 32 px for the Kobo sub-row). */
function roundel(iconName, tone, size = 40) {
  const box = size === 40 ? 'w-10 h-10' : 'w-8 h-8';
  return html`<span class="inline-flex items-center justify-center ${box} rounded-full shrink-0" style="${`background:color-mix(in srgb, var(${tone}) 16%, var(--surface-2));color:var(${tone});box-shadow:inset 0 0 0 1px color-mix(in srgb, var(${tone}) 28%, transparent)`}" aria-hidden="true">${icon(iconName, { size: size === 40 ? 20 : 16 })}</span>`;
}

const DEFAULT_INTERVAL = 15 * 60 * 1000;
const INTERVALS = [
  [5, 'Every 5 minutes'], [15, 'Every 15 minutes'], [30, 'Every 30 minutes'],
  [60, 'Every hour'], [360, 'Every 6 hours'], [1440, 'Every day'],
];

function intervalOptions(current) {
  const opts = INTERVALS.map(([min, label]) => ({ value: min * 60000, label }));
  if (current && !opts.some(o => o.value === current)) opts.push({ value: current, label: `Every ${Math.round(current / 60000)} minutes` });
  return opts.sort((a, b) => a.value - b.value);
}

const originOf = (u) => { try { return new URL(u).origin; } catch { return null; } };

function statusBadge(data, health) {
  if (!data) return badge({ label: 'Not connected', variant: 'neutral' });
  if (health === 'error') return badge({ label: 'Error', variant: 'danger', icon: 'alert-circle' });
  return badge({ label: 'Connected', variant: 'success', icon: 'check-circle' });
}

const lastSyncText = (data) => (data.last_synced_at ? `Last synced ${timeAgo(data.last_synced_at)}` : 'Not synced yet');

function actionsHTML(service, data) {
  return html`<div class="flex flex-wrap items-center gap-2">
    ${button({ label: 'Save & sync', variant: 'secondary', type: 'submit', attrs: 'data-save' })}
    ${data ? html`
      ${button({ label: 'Test connection', variant: 'secondary', attrs: 'data-action="test"' })}
      ${button({ label: 'Sync now', variant: 'secondary', icon: 'refresh-cw', attrs: 'data-action="sync"' })}
      ${button({ label: 'Disconnect', variant: 'danger-ghost', attrs: `data-confirm="Disconnect ${SERVICES[service].label}? Availability data will be removed." data-confirm-verb="Disconnect"` })}` : ''}
  </div>`;
}

function absFields(data) {
  const autoSessions = !(data && (data.auto_sessions === 'false' || data.auto_sessions === false));
  return html`
    <p class="text-small text-text-2">Self-hosted audiobook server. You need its address and an API token from your Audiobookshelf account settings.</p>
    ${field({ name: 'serverUrl', label: 'Server URL', type: 'url', value: data?.serverUrl ?? data?.server_url ?? '', placeholder: 'http://192.168.1.100:13378', inputmode: 'url', autocomplete: 'off' })}
    ${field({ name: 'token', label: 'API token', type: 'password', placeholder: data ? 'Saved — leave blank to keep' : 'Your API token', autocomplete: 'off' })}
    ${switchRow({ id: 'integration-abs-auto-sessions', label: 'Log finished audiobooks', description: 'Automatically log a read when you finish a book in Audiobookshelf', checked: autoSessions })}
    ${select({ name: 'intervalMs', label: 'Auto-sync', value: data?.intervalMs ?? DEFAULT_INTERVAL, options: intervalOptions(data?.intervalMs) })}`;
}

function calibreFields(data) {
  return html`
    <p class="text-small text-text-2">Connects through the Calibre-Web OPDS catalogue. Turn it on in Calibre-Web under Admin, Configuration, Feature Configuration, Allow OPDS.</p>
    ${field({ name: 'serverUrl', label: 'Server URL', type: 'url', value: data?.serverUrl ?? data?.server_url ?? '', placeholder: 'http://localhost:8083', inputmode: 'url', autocomplete: 'off' })}
    <div class="grid gap-4 sm:grid-cols-2">
      ${field({ name: 'username', label: 'Username (optional)', autocomplete: 'off', hint: data ? 'Not shown for security. Enter it again whenever you save changes.' : undefined })}
      ${field({ name: 'password', label: 'Password (optional)', type: 'password', autocomplete: 'off', placeholder: data ? 'Leave blank to keep what is saved' : '' })}
    </div>
    <details class="group" ${data?.opdsStartPath ? 'open' : ''}>
      <summary class="flex items-center gap-1.5 min-h-11 cursor-pointer text-small text-text-2 hover:text-text-1 list-none">
        <span class="transition-transform group-open:rotate-90">${icon('chevron-right', { size: 16 })}</span>Advanced
      </summary>
      <div class="pt-1">${field({ name: 'opdsStartPath', label: 'OPDS catalogue path', value: data?.opdsStartPath ?? '', placeholder: '/opds/new', hint: 'Leave blank to use /opds/new.', autocomplete: 'off' })}</div>
    </details>
    <div class="space-y-2">
      <div class="flex items-center gap-2">${roundel('tablet', '--warning-fg', 32)}<span class="label">Kobo sync token (optional)</span>${data?.kobo_connected ? badge({ label: 'Connected', variant: 'success' }) : ''}</div>
      ${field({ name: 'koboToken', ariaLabel: 'Kobo sync token', type: 'password', placeholder: data?.kobo_connected ? 'Saved — leave blank to keep' : 'Paste the token from Calibre-Web', autocomplete: 'off', hint: 'Syncs reading progress from your Kobo through Calibre-Web. Find the token in Calibre-Web under Settings, Connect to Kobo.' })}
    </div>
    ${select({ name: 'intervalMs', label: 'Auto-sync', value: data?.intervalMs ?? DEFAULT_INTERVAL, options: intervalOptions(data?.intervalMs) })}`;
}

function cardHTML(service, data, health) {
  const def = SERVICES[service];
  return card({
    attrs: `data-card="${service}"`,
    content: html`
      <form class="space-y-4" data-service="${service}" novalidate>
        <div class="flex items-center gap-3">
          ${roundel(def.icon, def.tone)}
          <div class="flex-1 min-w-0">
            <h3 class="h3">${def.label}</h3>
            ${data ? html`<p class="text-small text-text-2" data-last-sync>${lastSyncText(data)}</p>` : ''}
          </div>
          <span data-badge>${statusBadge(data, health)}</span>
        </div>
        ${service === 'audiobookshelf' ? absFields(data) : calibreFields(data)}
        ${actionsHTML(service, data)}
        <p class="text-small" data-msg aria-live="polite" hidden></p>
      </form>`,
  });
}

export function mount(el) {
  const scope = createScope();
  const data = {};      // service -> row from GET /integrations (absent = not connected)
  const health = {};    // service -> 'ok' | 'error'

  const cardEl = (service) => el.querySelector(`[data-card="${service}"]`);

  function replaceCard(service) {
    const old = cardEl(service);
    if (!old) return;
    const tpl = document.createElement('template');
    tpl.innerHTML = String(cardHTML(service, data[service], health[service]));
    old.replaceWith(tpl.content.firstElementChild);
  }

  // Refresh the badge and last-sync line without touching the form (keeps unsaved edits)
  function updateStatus(service) {
    const root = cardEl(service);
    if (!root) return;
    const b = root.querySelector('[data-badge]');
    if (b) b.innerHTML = String(statusBadge(data[service], health[service]));
    const t = root.querySelector('[data-last-sync]');
    if (t && data[service]) t.textContent = lastSyncText(data[service]);
  }

  function setMsg(service, text, tone = 'success') {
    const p = cardEl(service)?.querySelector('[data-msg]');
    if (!p) return;
    p.textContent = text ?? '';
    p.hidden = !text;
    p.classList.toggle('text-danger', tone === 'error');
    p.classList.toggle('text-success', tone === 'success');
    p.classList.toggle('text-text-2', tone === 'neutral');
    p.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  }

  async function refresh() {
    try {
      const rows = await api.getIntegrations();
      for (const key of Object.keys(SERVICES)) delete data[key];
      for (const row of rows) if (SERVICES[row.service]) data[row.service] = row;
    } catch { /* keep what we have */ }
  }

  function render() {
    el.innerHTML = String(html`
      <p class="text-small text-text-2">Connect other services to show where each book is available and to sync your audiobook and ebook libraries.</p>
      ${Object.keys(SERVICES).map(s => cardHTML(s, data[s], health[s]))}`);
  }

  el.innerHTML = String(skeletonCard());
  (async () => {
    await refresh();
    if (scope.disposed) return;
    render();
    // Health check of saved connections, in the background: flips the badge to Error when unreachable
    for (const service of Object.keys(data)) {
      api.getIntegrationStatus(service).then(s => {
        if (scope.disposed) return;
        health[service] = s?.connected ? 'ok' : 'error';
        if (health[service] === 'error') updateStatus(service);
      }).catch(() => {});
    }
  })();

  scope.add(mountFields(el));

  // ── Save & sync (submit) ──
  const onSubmit = async (e) => {
    const form = e.target.closest('[data-service]');
    if (!form) return;
    e.preventDefault();
    const service = form.dataset.service;
    const label = SERVICES[service].label;
    const current = data[service];
    const val = (name) => form.elements[name]?.value.trim() ?? '';
    const urlInput = form.elements.serverUrl;

    ['serverUrl', 'token', 'koboToken'].forEach(n => form.elements[n] && setFieldError(form.elements[n], null));
    setMsg(service, '');

    const serverUrl = val('serverUrl');
    if (!isHttpUrl(serverUrl)) {
      setFieldError(urlInput, 'Enter the server address, starting with http:// or https://');
      urlInput.focus();
      return;
    }
    const originChanged = !!current && originOf(current.serverUrl ?? current.server_url) !== originOf(serverUrl);
    const payload = { serverUrl, intervalMs: Number(form.elements.intervalMs.value) || DEFAULT_INTERVAL };

    if (service === 'audiobookshelf') {
      const token = form.elements.token.value;
      if (!token && (!current || originChanged)) {
        setFieldError(form.elements.token, current ? 'Enter the API token again when you change the server' : 'Enter your API token');
        form.elements.token.focus();
        return;
      }
      if (token) payload.token = token;
      payload.auto_sessions = form.querySelector('#integration-abs-auto-sessions').getAttribute('aria-checked') === 'true';
    } else {
      if (val('username')) payload.username = val('username');
      if (form.elements.password.value) payload.password = form.elements.password.value;
      if (val('opdsStartPath')) payload.opdsStartPath = val('opdsStartPath');
      if (val('koboToken')) payload.koboToken = val('koboToken');
    }

    const btn = form.querySelector('[data-save]');
    setButtonLoading(btn, true);
    try {
      await api.saveIntegration(service, payload);
      if (scope.disposed) return;
      toast(TOAST.integrationConnected(label));
      health[service] = 'ok';
      await refresh();
      if (scope.disposed) return;
      replaceCard(service);
      runSync(service, { announce: true });
    } catch (err) {
      if (scope.disposed) return;
      setMsg(service, `Couldn't reach ${label}: ${errorText(err, 'check the address and credentials')}`, 'error');
    } finally {
      setButtonLoading(btn, false);
    }
  };
  el.addEventListener('submit', onSubmit);
  scope.add(() => el.removeEventListener('submit', onSubmit));

  async function runSync(service, { btn, announce = false } = {}) {
    if (btn) setButtonLoading(btn, true);
    if (announce) toast(TOAST.syncing, { type: 'info' });
    try {
      await api.syncIntegration(service);
      if (scope.disposed) return;
      await refresh();
      if (scope.disposed) return;
      updateStatus(service);
      toast('Sync complete');
    } catch (err) {
      if (!scope.disposed) toast(`Sync failed — ${errorText(err, 'try again')}`, { type: 'error' });
    } finally {
      if (btn?.isConnected) setButtonLoading(btn, false);
    }
  }

  scope.add(delegate(el, 'click', '[data-action="sync"]', (e, btn) => {
    const service = btn.closest('[data-service]')?.dataset.service;
    if (service) runSync(service, { btn });
  }));

  scope.add(delegate(el, 'click', '[data-action="test"]', async (e, btn) => {
    const service = btn.closest('[data-service]')?.dataset.service;
    if (!service) return;
    const label = SERVICES[service].label;
    setButtonLoading(btn, true);
    setMsg(service, '');
    try {
      const status = await api.getIntegrationStatus(service);
      if (scope.disposed) return;
      if (status?.connected) {
        health[service] = 'ok';
        updateStatus(service);
        setMsg(service, status.itemCount != null ? `Connected — ${status.itemCount} items found` : 'Connected', 'success');
      } else {
        health[service] = 'error';
        updateStatus(service);
        setMsg(service, `Couldn't reach ${label}: the server didn't respond`, 'error');
      }
    } catch (err) {
      if (scope.disposed) return;
      health[service] = 'error';
      updateStatus(service);
      setMsg(service, `Couldn't reach ${label}: ${errorText(err, 'try again')}`, 'error');
    } finally {
      if (btn.isConnected) setButtonLoading(btn, false);
    }
  }));

  scope.add(mountConfirmInline(el, {
    onConfirm: async (trigger) => {
      const service = trigger.closest('[data-service]')?.dataset.service;
      if (!service) return;
      try {
        await api.disconnectIntegration(service);
        if (scope.disposed) return;
        delete data[service];
        delete health[service];
        replaceCard(service);
        toast(TOAST.integrationDisconnected(SERVICES[service].label));
      } catch {
        if (!scope.disposed) toast("Couldn't disconnect", { type: 'error' });
      }
    },
  }));

  return scope.dispose;
}
