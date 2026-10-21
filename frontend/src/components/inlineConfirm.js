import { escHtml } from '../utils.js';
import { showToast } from './toast.js';

// Swap `btn` for a small "Delete? Yes / No" prompt (same pattern as the shelf
// delete in views/home.js). onConfirm may be async; if it throws, the original
// button comes back and the error is shown as a toast. On success the caller
// is responsible for updating the DOM.
export function inlineConfirm(btn, { label = 'Delete?', yes = 'Yes', no = 'No', onConfirm }) {
  if (!btn.isConnected || btn.parentElement?.querySelector(':scope > .inline-confirm')) return;

  const prompt = document.createElement('span');
  prompt.className = 'inline-confirm flex items-center gap-1 text-xs';
  prompt.innerHTML = `
    <span class="text-muted">${escHtml(label)}</span>
    <button type="button" class="confirm-yes px-2 py-0.5 bg-red-600 hover:bg-red-500 text-white rounded font-medium">${escHtml(yes)}</button>
    <button type="button" class="confirm-no px-2 py-0.5 text-muted hover:text-text">${escHtml(no)}</button>`;
  btn.replaceWith(prompt);

  prompt.querySelector('.confirm-no').addEventListener('click', () => prompt.replaceWith(btn));
  prompt.querySelector('.confirm-yes').addEventListener('click', async e => {
    e.currentTarget.disabled = true;
    try {
      await onConfirm();
    } catch (err) {
      if (prompt.isConnected) prompt.replaceWith(btn);
      showToast(err.message, 'error');
    }
  });
}
