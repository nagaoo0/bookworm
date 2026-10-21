// Settings · Reading: yearly goal and default search language.
import { api } from '../../api.js';
import { html } from '../../utils.js';
import { loadPrefs, savePrefs } from '../../prefs.js';
import {
  LABEL, TOAST, button, card, field, mountConfirmInline, plural, progressBar, select,
  setButtonLoading, setFieldError, skeletonCard, toast,
} from '../../ui/index.js';
import { createScope } from './common.js';

const SEARCH_LANGUAGES = [
  ['', 'Any language'],
  ['en', 'English'], ['fr', 'French'], ['de', 'German'], ['es', 'Spanish'],
  ['it', 'Italian'], ['pt', 'Portuguese'], ['nl', 'Dutch'], ['ru', 'Russian'],
  ['zh', 'Chinese'], ['ja', 'Japanese'], ['ko', 'Korean'], ['ar', 'Arabic'],
  ['pl', 'Polish'], ['sv', 'Swedish'], ['cs', 'Czech'],
];

function progressHTML(goal) {
  if (!goal?.target) return '';
  const read = goal.booksRead ?? 0;
  return html`<div class="space-y-1.5">
    ${progressBar({ value: read, max: goal.target, label: 'Goal progress' })}
    <p class="text-small text-text-2">${plural(read, 'book')} of ${goal.target} read</p>
  </div>`;
}

export function mount(el) {
  const scope = createScope();
  const year = new Date().getFullYear();
  let goal = null;

  function render() {
    const hasGoal = !!goal?.target;
    el.innerHTML = String(html`
      ${card({ content: html`
        <form class="space-y-4" data-goal-form novalidate>
          <h3 class="h3">${LABEL.goal(year)}</h3>
          <div data-goal-progress>${progressHTML(goal)}</div>
          ${field({ name: 'target', label: `Books to read in ${year}`, type: 'number', value: hasGoal ? goal.target : '', min: 1, max: 999, step: 1, inputmode: 'numeric', placeholder: 'For example 24' })}
          <div class="flex flex-wrap items-center gap-2">
            ${button({ label: 'Save goal', variant: 'primary', type: 'submit', attrs: 'data-save' })}
            ${hasGoal ? button({ label: 'Clear goal', variant: 'danger-ghost', attrs: `data-confirm="Clear your ${year} goal?" data-confirm-verb="Clear"` }) : ''}
          </div>
        </form>` })}

      ${card({ content: html`
        <div class="space-y-3">
          <h3 class="h3">Search</h3>
          ${select({
            name: 'searchLanguage', label: 'Default search language', value: loadPrefs().searchLanguage ?? '',
            options: SEARCH_LANGUAGES.map(([value, label]) => ({ value, label })),
            hint: 'Applied to every book search. You can still change it per search in advanced search.',
          })}
        </div>` })}`);
  }

  el.innerHTML = String(skeletonCard());
  api.getGoal(year).then(g => { goal = g; }).catch(() => { goal = null; }).finally(() => {
    if (!scope.disposed) render();
  });

  const onSubmit = async (e) => {
    const form = e.target.closest('[data-goal-form]');
    if (!form) return;
    e.preventDefault();
    const input = form.elements.target;
    const target = Number(input.value);
    if (!Number.isInteger(target) || target < 1 || target > 999) {
      setFieldError(input, 'Enter a number between 1 and 999');
      input.focus();
      return;
    }
    setFieldError(input, null);
    const btn = form.querySelector('[data-save]');
    setButtonLoading(btn, true);
    try {
      await api.setGoal(year, target);
      if (scope.disposed) return;
      goal = await api.getGoal(year).catch(() => ({ year, target, booksRead: goal?.booksRead ?? 0 }));
      render();
      toast(TOAST.goalSet(target, year));
    } catch (err) {
      if (scope.disposed) return;
      setFieldError(input, err.message || 'Enter a number between 1 and 999');
    } finally {
      setButtonLoading(btn, false);
    }
  };
  el.addEventListener('submit', onSubmit);
  scope.add(() => el.removeEventListener('submit', onSubmit));

  const onChange = (e) => {
    if (e.target.name !== 'searchLanguage') return;
    const value = e.target.value;
    const label = e.target.options[e.target.selectedIndex].text;
    savePrefs({ searchLanguage: value });
    api.updatePrefs({ searchLanguage: value || null }).catch(() => {});
    toast(TOAST.searchLanguage(value ? label : 'any language'));
  };
  el.addEventListener('change', onChange);
  scope.add(() => el.removeEventListener('change', onChange));

  scope.add(mountConfirmInline(el, {
    onConfirm: async () => {
      try {
        await api.deleteGoal(year);
        if (scope.disposed) return;
        goal = null;
        render();
        toast(TOAST.goalCleared);
      } catch {
        if (!scope.disposed) toast("Couldn't clear goal", { type: 'error' });
      }
    },
  }));

  return scope.dispose;
}
