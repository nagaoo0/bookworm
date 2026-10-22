// Settings · Library tools: duplicates + merge, missing covers, export, import.
import { api } from '../../api.js';
import { html } from '../../utils.js';
import { loadLibrary } from '../../libraryStore.js';
import {
  TOAST, badge, button, card, cover, delegate, field, openPopover, plural, setButtonLoading, toast,
} from '../../ui/index.js';
import { createScope, errorText, group, groupCard } from './common.js';

const authorOf = (authors) => (Array.isArray(authors) ? authors[0] : authors) ?? '';

function matchBadge(score) {
  if (score == null) return '';
  const pct = Math.round(score * 100);
  const [label, variant] = pct >= 90 ? ['Exact', 'success'] : pct >= 70 ? ['Very likely', 'warning'] : ['Possible', 'neutral'];
  return badge({ label: `${label} · ${pct}% match`, variant });
}

function bookCell(role, id, title, authors, coverUrl) {
  return html`<div class="min-w-0">
    <p class="label mb-2">${role}</p>
    <div class="flex gap-2 items-start">
      ${cover({ url: coverUrl, bookId: id, title, size: 'xs' })}
      <div class="min-w-0">
        <p class="text-small font-medium line-clamp-2">${title}</p>
        <p class="text-caption text-text-2 truncate">${authorOf(authors)}</p>
      </div>
    </div>
  </div>`;
}

function pairHTML(pair, index) {
  return html`<li class="rounded-xl bg-surface-2 p-3 space-y-3" data-pair="${index}">
    <div class="flex flex-wrap items-center justify-between gap-2">
      ${matchBadge(pair.score)}
      <span data-pair-action>${button({ label: 'Merge', variant: 'primary', size: 'sm', icon: 'merge', attrs: `data-action="merge" data-index="${index}" aria-haspopup="dialog"` })}</span>
    </div>
    <div class="grid grid-cols-2 gap-3">
      ${bookCell('Book A', pair.keep_id, pair.keep_title, pair.keep_authors, pair.keep_cover)}
      ${bookCell('Book B', pair.remove_id, pair.remove_title, pair.remove_authors, pair.remove_cover)}
    </div>
    <p class="text-small text-success" data-pair-done hidden></p>
  </li>`;
}

function toolRow(title, body, action) {
  return html`<div class="flex flex-wrap items-start justify-between gap-3">
    <div class="min-w-0 flex-1">
      <h3 class="h3">${title}</h3>
      <p class="text-small text-text-2">${body}</p>
    </div>
    <div class="shrink-0">${action}</div>
  </div>`;
}

export function mount(el) {
  const scope = createScope();
  let pairs = [];

  el.innerHTML = String(groupCard([
    group(html`
      ${toolRow('Find duplicates', 'Spot books that were imported from more than one source, then merge them into a single entry.',
        button({ label: 'Find duplicates', variant: 'secondary', attrs: 'data-action="find-dupes"' }))}
      <p class="text-small text-text-2" data-dupes-msg role="status" hidden></p>
      <ul class="space-y-3" data-dupes-list></ul>`),
    group(toolRow('Fetch missing covers', 'Search Google Books and Open Library for cover art on books that have none.',
      button({ label: 'Fetch covers', variant: 'secondary', icon: 'image', attrs: 'data-action="fetch-covers"' }))),
    group(toolRow('Export', 'Download your whole library as a tab-separated CSV file.',
      button({ label: 'Export library', variant: 'secondary', icon: 'download', attrs: 'data-action="export"' }))),
    group(html`
      <form class="space-y-4" data-import-form novalidate>
        <div>
          <h3 class="h3">Import</h3>
          <p class="text-small text-text-2">Import a tab-separated CSV in the same format as the export above.</p>
        </div>
        <div class="field">
          <label class="field__label" for="library-import-file">CSV file</label>
          <input id="library-import-file" name="file" type="file" accept=".csv,.tsv,.txt,text/csv,text/plain"
            class="block w-full text-small text-text-2 file:mr-3 file:rounded-md file:border-0 file:bg-surface-2 file:px-3 file:py-2 file:text-small file:font-medium file:text-text-1 file:cursor-pointer hover:file:bg-surface-3">
        </div>
        ${field({ name: 'paste', label: 'Or paste the data', type: 'textarea', rows: 5, placeholder: 'Paste tab-separated rows here' })}
        <div>${button({ label: 'Import', variant: 'primary', type: 'submit', icon: 'upload', attrs: 'data-import' })}</div>
        <div data-import-result role="status" aria-live="polite"></div>
      </form>`),
  ]));

  const dupesMsg = el.querySelector('[data-dupes-msg]');
  const dupesList = el.querySelector('[data-dupes-list]');

  // ── Duplicates ──
  scope.add(delegate(el, 'click', '[data-action="find-dupes"]', async (e, btn) => {
    setButtonLoading(btn, true);
    dupesMsg.hidden = true;
    dupesList.innerHTML = '';
    try {
      pairs = await api.findDuplicates();
      if (scope.disposed) return;
      dupesMsg.hidden = false;
      if (!pairs.length) {
        dupesMsg.textContent = 'No duplicate books found';
        dupesMsg.className = 'text-small text-success';
      } else {
        dupesMsg.textContent = `${plural(pairs.length, 'possible duplicate')} found. Choose which book to keep for each.`;
        dupesMsg.className = 'text-small text-text-2';
        dupesList.innerHTML = String(html`${pairs.map((p, i) => pairHTML(p, i))}`);
      }
    } catch (err) {
      if (scope.disposed) return;
      dupesMsg.hidden = false;
      dupesMsg.textContent = `Couldn't scan for duplicates — ${errorText(err, 'try again')}`;
      dupesMsg.className = 'text-small text-danger';
    } finally {
      setButtonLoading(btn, false);
    }
  }));

  scope.add(delegate(el, 'click', '[data-action="merge"]', (e, trigger) => {
    const index = Number(trigger.dataset.index);
    const pair = pairs[index];
    if (!pair) return;
    const pop = openPopover({
      trigger,
      label: 'Choose which book to keep',
      width: 340,
      placement: 'bottom-start',
      content: html`<div class="popover__body space-y-3">
        <p class="h3">Keep which book?</p>
        <p class="text-small text-text-2">The other one is merged into it. This can't be undone.</p>
        <div class="space-y-2">
          <button type="button" class="btn btn--secondary btn--block" data-keep="A"><span class="btn__label truncate">Keep “${pair.keep_title}”</span></button>
          <button type="button" class="btn btn--secondary btn--block" data-keep="B"><span class="btn__label truncate">Keep “${pair.remove_title}”</span></button>
        </div>
      </div>`,
    });
    pop.el.addEventListener('click', async (ev) => {
      const choice = ev.target instanceof Element ? ev.target.closest('[data-keep]') : null;
      if (!choice) return;
      const keepA = choice.dataset.keep === 'A';
      const keepId = keepA ? pair.keep_id : pair.remove_id;
      const removeId = keepA ? pair.remove_id : pair.keep_id;
      const keptTitle = keepA ? pair.keep_title : pair.remove_title;
      pop.close();
      trigger.disabled = true;
      setButtonLoading(trigger, true);
      try {
        await api.mergeBooks(keepId, removeId);
        if (scope.disposed) { loadLibrary(); return; }   // the library changed server-side either way
        const row = el.querySelector(`[data-pair="${index}"]`);
        if (row) {
          row.classList.add('opacity-60');
          row.querySelector('[data-pair-action]').innerHTML = '';
          const done = row.querySelector('[data-pair-done]');
          done.textContent = `Merged into “${keptTitle}”`;
          done.hidden = false;
        }
        toast(TOAST.booksMerged);
        loadLibrary();
      } catch {
        if (scope.disposed) return;
        setButtonLoading(trigger, false);
        trigger.disabled = false;
        toast("Couldn't merge — try again", { type: 'error' });
      }
    });
  }));

  // ── Covers ──
  scope.add(delegate(el, 'click', '[data-action="fetch-covers"]', async (e, btn) => {
    setButtonLoading(btn, true);
    try {
      const { updated, checked } = await api.fetchMissingCovers();
      if (scope.disposed) { if (updated) loadLibrary(); return; }
      if (!checked) toast('All books already have covers', { type: 'info' });
      else { toast(`Updated ${updated} of ${checked} covers`); if (updated) loadLibrary(); }
    } catch {
      if (!scope.disposed) toast("Couldn't fetch covers", { type: 'error' });
    } finally {
      setButtonLoading(btn, false);
    }
  }));

  // ── Export ──
  scope.add(delegate(el, 'click', '[data-action="export"]', async (e, btn) => {
    setButtonLoading(btn, true);
    try {
      const res = await api.exportLibrary();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'bookworm-library.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (!scope.disposed) toast(TOAST.exportReady);
    } catch {
      if (!scope.disposed) toast('Export failed', { type: 'error' });
    } finally {
      setButtonLoading(btn, false);
    }
  }));

  // ── Import ──
  const form = el.querySelector('[data-import-form]');
  const result = el.querySelector('[data-import-result]');
  const onSubmit = async (e) => {
    e.preventDefault();
    const file = form.elements.file.files[0];
    const pasted = form.elements.paste.value;
    result.innerHTML = '';
    let csv = pasted;
    try { if (file) csv = await file.text(); } catch { csv = ''; }
    if (!csv || !csv.trim()) {
      result.innerHTML = String(html`<p class="field__error" role="alert">Choose a file or paste your data</p>`);
      return;
    }
    const btn = form.querySelector('[data-import]');
    setButtonLoading(btn, true);
    try {
      const { imported = 0, skipped = 0 } = await api.importLibrary(csv);
      if (scope.disposed) { loadLibrary(); return; }
      result.innerHTML = String(card({ padding: 'sm', cls: 'bg-surface-2', content: html`
        <p class="font-medium">Imported ${plural(imported, 'book')} · ${skipped} skipped</p>` }));
      form.reset();
      toast(TOAST.importFinished);
      loadLibrary();
    } catch (err) {
      if (scope.disposed) return;
      result.innerHTML = String(html`<p class="field__error" role="alert">Import failed — check the file format${err?.message ? html` (${err.message})` : ''}</p>`);
    } finally {
      setButtonLoading(btn, false);
    }
  };
  form.addEventListener('submit', onSubmit);
  scope.add(() => form.removeEventListener('submit', onSubmit));

  return scope.dispose;
}
