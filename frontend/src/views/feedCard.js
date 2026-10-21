// Activity ("feed") card and follow button, shared by Community, Profile (History) and Home.
// Markup comes from html``; behaviour is delegated on a root (mountFeedCards / mountFollowButtons),
// so lists can be re-rendered without re-binding. Spec: design-system §8.5, §9 (like / comment / follow rows).
import { html, raw } from '../utils.js';
import { api } from '../api.js';
import { getState } from '../store.js';
import { upsertLibraryEntry } from '../libraryStore.js';
import {
  avatar, badge, button, cover, field, icon, stars, spinner,
  delegate, uid, plural, timeAgo, formatDate, formatAuthors, statusLabel,
  setButtonLoading, setFieldError, mountConfirmInline, toast, TOAST, ERROR,
} from '../ui/index.js';

const REVIEW_CLAMP_CHARS = 240;

/**
 * Escape first, then link `@mentions`. Returns SafeHTML (interpolate it straight into html``).
 * @param {string} text
 */
export function linkifyMentions(text) {
  const s = String(text ?? '');
  const out = [];
  const re = /@([a-zA-Z0-9_-]{2,32})/g;
  let last = 0;
  let m;
  while ((m = re.exec(s))) {
    if (m.index > 0 && /[A-Za-z0-9_]/.test(s[m.index - 1])) continue;   // part of an e-mail address / word
    out.push(s.slice(last, m.index));
    out.push(html`<a href="#u/${encodeURIComponent(m[1])}" class="text-accent-text hover:underline">@${m[1]}</a>`);
    last = m.index + m[0].length;
  }
  out.push(s.slice(last));
  return html`${out}`;
}

// ── Follow button ────────────────────────────────────────────────────────────

function followInner(following) {
  return html`<span class="btn__icon">${icon(following ? 'check' : 'user-plus', { size: 16 })}</span><span class="btn__label">${following ? 'Following' : 'Follow'}</span>`;
}

/**
 * Follow / Following toggle button. Wire it with mountFollowButtons().
 * @param {string} username
 * @param {boolean} following
 * @param {{ size?: 'sm'|'md' }} [o]
 */
export function followButton(username, following, { size = 'sm' } = {}) {
  return html`<button type="button" class="btn ${size === 'sm' ? 'btn--sm' : ''} ${following ? 'btn--secondary' : 'btn--primary'}" data-follow="${username}" aria-pressed="${following ? 'true' : 'false'}" aria-label="Follow @${username}">${followInner(following)}</button>`;
}

function paintFollow(btn, following) {
  btn.setAttribute('aria-pressed', following ? 'true' : 'false');
  btn.classList.toggle('btn--secondary', following);
  btn.classList.toggle('btn--primary', !following);
  btn.innerHTML = String(followInner(following));
}

/**
 * Optimistic follow / unfollow for every followButton() inside `root` (all buttons for the same user flip together).
 * `onChange(username, following)` runs after the request succeeded. Returns cleanup.
 */
export function mountFollowButtons(root, { onChange } = {}) {
  const busy = new Set();
  let disposed = false;
  const buttonsFor = (name) => [...root.querySelectorAll('[data-follow]')].filter(b => b.dataset.follow === name);

  const off = delegate(root, 'click', '[data-follow]', async (e, btn) => {
    e.preventDefault();
    const name = btn.dataset.follow;
    if (busy.has(name)) return;
    const next = btn.getAttribute('aria-pressed') !== 'true';
    busy.add(name);
    buttonsFor(name).forEach(b => paintFollow(b, next));
    try {
      if (next) await api.follow(name); else await api.unfollow(name);
      if (!disposed) {
        toast(next ? TOAST.following(name) : TOAST.unfollowed(name));
        onChange?.(name, next);
      }
    } catch {
      if (!disposed) buttonsFor(name).forEach(b => paintFollow(b, !next));
      toast(next ? ERROR.follow : ERROR.unfollow, { type: 'error' });
    } finally {
      busy.delete(name);
    }
  });
  return () => { disposed = true; off(); };
}

// ── Comments ─────────────────────────────────────────────────────────────────

function commentHTML(c) {
  return html`
    <div class="flex gap-2.5" data-comment-id="${c.id}">
      <a href="#u/${encodeURIComponent(c.username)}" class="shrink-0" tabindex="-1" aria-hidden="true">${avatar({ username: c.username, avatarUrl: c.avatar_url, size: 24 })}</a>
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-x-2">
          <a href="#u/${encodeURIComponent(c.username)}" class="text-small font-semibold text-text-1 hover:underline">@${c.username}</a>
          <time class="text-caption text-text-3" datetime="${c.created_at}">${timeAgo(c.created_at)}</time>
          ${c.is_own ? button({ label: 'Delete', variant: 'danger-ghost', size: 'sm', cls: 'ml-auto', attrs: 'data-confirm="Delete comment?" data-confirm-verb="Delete" data-feed-cd' }) : ''}
        </div>
        <p class="text-small text-text-1 whitespace-pre-line break-words">${linkifyMentions(c.body)}</p>
      </div>
    </div>`;
}

const NO_COMMENTS = html`<p class="text-small text-text-3" data-feed-empty>No comments yet. Be the first.</p>`;

// ── Card ─────────────────────────────────────────────────────────────────────

function inLibrary(item) {
  if (item.is_in_library !== undefined && item.is_in_library !== null) return !!item.is_in_library;
  const { libraryLoaded, library } = getState();
  if (!libraryLoaded) return undefined;
  return (library ?? []).some(b => String(b.book_id) === String(item.book_id));
}

/**
 * One activity item: avatar · "@name finished Title" · time · cover · stars · review · actions · comment thread.
 * Accepts rows from /feed, /profiles/:name (feed — add `username`/`avatar_url`) and /groups/:id/feed.
 * Items without social counts (group feed) render without like / comment actions.
 * @param {object} item
 * @param {{ viewer?: object|null, showAddToLibrary?: boolean }} [o]  viewer defaults to the logged-in user
 */
export function feedCardHTML(item, { viewer = getState().user, showAddToLibrary = true } = {}) {
  const sid = Number(item.session_id ?? item.id);
  const name = item.username ?? '';
  const when = item.finished_at ?? item.started_at;
  const verb = item.finished_at ? 'finished' : 'started';
  const authors = formatAuthors(item.authors);
  const review = typeof item.review === 'string' ? item.review.trim() : '';
  const long = review.length > REVIEW_CLAMP_CHARS || (review.match(/\n/g)?.length ?? 0) >= 4;
  const social = item.like_count !== undefined && item.like_count !== null;
  const likes = Number(item.like_count) || 0;
  const liked = !!item.liked;
  const comments = Number(item.comment_count) || 0;
  const readers = Number(item.readers_count) || 0;
  const reviewId = uid('feed-review');
  const threadId = uid('feed-thread');
  const canAdd = showAddToLibrary && viewer && viewer.username !== name && inLibrary(item) === false;
  const gate = (control) => (viewer ? control : html`<span title="Sign in to react">${control}</span>`);

  const likeBtn = social ? gate(html`<button type="button" class="btn btn--sm ${liked ? 'btn--danger-ghost' : 'btn--ghost'}" data-feed-like="${sid}" data-count="${likes}" aria-pressed="${liked ? 'true' : 'false'}" aria-label="${likes > 0 ? `Like, ${plural(likes, 'like')}` : 'Like'}"${viewer ? '' : raw(' disabled aria-disabled="true"')}><span class="btn__icon">${icon('heart', { size: 16, fill: liked })}</span><span class="btn__label">${likes > 0 ? likes : ''}</span></button>`) : '';

  const commentBtn = social ? gate(html`<button type="button" class="btn btn--sm btn--ghost" data-feed-comments="${sid}" data-count="${comments}" aria-expanded="false" aria-controls="${threadId}" aria-label="${comments > 0 ? `Comments, ${comments}` : 'Comments'}"${viewer ? '' : raw(' disabled aria-disabled="true"')}><span class="btn__icon">${icon('message-circle', { size: 16 })}</span><span class="btn__label">${comments > 0 ? comments : ''}</span></button>`) : '';

  const addBtn = canAdd
    ? html`<button type="button" class="btn btn--sm btn--ghost" data-feed-add data-book-id="${item.book_id}"><span class="btn__icon">${icon('plus', { size: 16 })}</span><span class="btn__label">Add to library</span></button>`
    : '';

  return html`
    <article class="card feed-card" data-feed-sid="${sid}" aria-label="${name ? `@${name} ${verb} ${item.title}` : item.title}">
      <div class="flex items-start gap-3">
        ${name ? html`<a href="#u/${encodeURIComponent(name)}" class="shrink-0" tabindex="-1" aria-hidden="true">${avatar({ username: name, avatarUrl: item.avatar_url, size: 40 })}</a>` : ''}
        <div class="min-w-0 flex-1">
          <p class="text-small text-text-2">
            ${name ? html`<a href="#u/${encodeURIComponent(name)}" class="font-semibold text-text-1 hover:underline">@${name}</a> ` : ''}${verb}
            <a href="#book/${item.book_id}" class="font-display font-semibold text-text-1 hover:text-accent-text">${item.title}</a>
          </p>
          ${when ? html`<time class="text-caption text-text-3" datetime="${when}" title="${formatDate(when)}">${timeAgo(when)}</time>` : ''}
        </div>
      </div>

      <div class="mt-3 flex gap-3">
        <a href="#book/${item.book_id}" class="shrink-0" tabindex="-1" aria-hidden="true">${cover({ url: item.cover_url, bookId: item.book_id, title: item.title, size: 'sm' })}</a>
        <div class="min-w-0 flex-1 space-y-1.5">
          ${authors ? html`<p class="text-small text-text-2 line-clamp-1">${authors}</p>` : ''}
          ${item.rating ? stars({ value: item.rating, size: 14 }) : ''}
          ${review ? html`<p class="text-body text-text-1 whitespace-pre-line break-words ${long ? 'line-clamp-4' : ''}" id="${reviewId}">${linkifyMentions(review)}</p>` : ''}
          ${long ? html`<button type="button" class="btn btn--sm btn--ghost -ml-3" data-feed-more="${reviewId}" aria-expanded="false" aria-controls="${reviewId}"><span class="btn__label">More</span></button>` : ''}
        </div>
      </div>

      <div class="mt-3 flex flex-wrap items-center gap-1 border-t border-border-1 pt-2">
        ${likeBtn}${commentBtn}
        ${readers > 1 ? html`<span class="text-caption text-text-3 px-1">${plural(readers, 'reader')} finished this</span>` : ''}
        <span class="flex-1"></span>
        ${addBtn}
      </div>

      ${social ? html`
        <div class="mt-3 border-t border-border-1 pt-3" id="${threadId}" data-feed-thread="${sid}" data-loaded="false" hidden>
          <div class="space-y-3" data-feed-list aria-live="polite"></div>
          ${viewer ? html`
            <form class="mt-3 flex items-start gap-2" data-feed-form="${sid}" novalidate>
              <div class="min-w-0 flex-1">${field({ name: 'body', ariaLabel: 'Write a comment', placeholder: 'Write a comment', maxlength: 1000, size: 'sm', autocomplete: 'off' })}</div>
              ${button({ label: 'Post', variant: 'primary', size: 'sm', type: 'submit' })}
            </form>` : ''}
        </div>` : ''}
    </article>`;
}

// ── Behaviour ────────────────────────────────────────────────────────────────

function paintLike(btn, liked, count) {
  btn.setAttribute('aria-pressed', liked ? 'true' : 'false');
  btn.setAttribute('aria-label', count > 0 ? `Like, ${plural(count, 'like')}` : 'Like');
  btn.dataset.count = String(count);
  btn.classList.toggle('btn--danger-ghost', liked);
  btn.classList.toggle('btn--ghost', !liked);
  btn.querySelector('svg')?.setAttribute('fill', liked ? 'currentColor' : 'none');
  const label = btn.querySelector('.btn__label');
  if (label) label.textContent = count > 0 ? String(count) : '';
}

function paintCommentCount(card, count) {
  const btn = card.querySelector('[data-feed-comments]');
  if (!btn) return;
  btn.dataset.count = String(count);
  btn.setAttribute('aria-label', count > 0 ? `Comments, ${count}` : 'Comments');
  const label = btn.querySelector('.btn__label');
  if (label) label.textContent = count > 0 ? String(count) : '';
}

/**
 * Likes, comment threads, "More", "Add to library" for every feedCardHTML() inside `root`.
 * `onChange({ type: 'like'|'comment'|'library', sessionId?, bookId?, ... })` fires after each successful change.
 * @returns {() => void} cleanup
 */
export function mountFeedCards(root, { onChange } = {}) {
  let disposed = false;
  const cleanups = [];
  const busy = new Set();
  const notify = (change) => { if (!disposed) onChange?.(change); };

  // Like — optimistic, reverts on failure
  cleanups.push(delegate(root, 'click', '[data-feed-like]', async (e, btn) => {
    const sid = btn.dataset.feedLike;
    if (btn.disabled || busy.has(`like:${sid}`)) return;
    busy.add(`like:${sid}`);
    const wasLiked = btn.getAttribute('aria-pressed') === 'true';
    const count = Number(btn.dataset.count) || 0;
    paintLike(btn, !wasLiked, Math.max(0, count + (wasLiked ? -1 : 1)));
    try {
      const res = wasLiked ? await api.unlikeSession(sid) : await api.likeSession(sid);
      if (disposed) return;
      paintLike(btn, !wasLiked, Number(res?.likeCount) || 0);
      notify({ type: 'like', sessionId: Number(sid), liked: !wasLiked, likeCount: Number(res?.likeCount) || 0 });
    } catch {
      if (!disposed) paintLike(btn, wasLiked, count);
      toast(ERROR.like, { type: 'error' });
    } finally {
      busy.delete(`like:${sid}`);
    }
  }));

  // Comments — toggle the inline thread, load on first open
  const loadThread = async (thread) => {
    const list = thread.querySelector('[data-feed-list]');
    const sid = thread.dataset.feedThread;
    thread.dataset.loading = 'true';
    list.innerHTML = String(html`<div class="flex justify-center py-2">${spinner({ size: 20, label: 'Loading comments' })}</div>`);
    try {
      const items = await api.getSessionComments(sid);
      if (disposed) return;
      thread.dataset.loaded = 'true';
      list.innerHTML = String(items.length ? html`${items.map(commentHTML)}` : NO_COMMENTS);
    } catch {
      if (disposed) return;
      list.innerHTML = String(html`<div class="flex items-center gap-2 text-small text-danger">Couldn't load comments. ${button({ label: 'Try again', variant: 'ghost', size: 'sm', attrs: 'data-feed-retry' })}</div>`);
    } finally {
      delete thread.dataset.loading;
    }
  };

  cleanups.push(delegate(root, 'click', '[data-feed-comments]', (e, btn) => {
    if (btn.disabled) return;
    const card = btn.closest('.feed-card');
    const thread = card?.querySelector('[data-feed-thread]');
    if (!thread) return;
    const open = thread.hidden;
    thread.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open && thread.dataset.loaded !== 'true' && !thread.dataset.loading) loadThread(thread);
  }));

  cleanups.push(delegate(root, 'click', '[data-feed-retry]', (e, btn) => {
    const thread = btn.closest('[data-feed-thread]');
    if (thread && !thread.dataset.loading) loadThread(thread);
  }));

  // Post a comment
  cleanups.push(delegate(root, 'submit', '[data-feed-form]', async (e, form) => {
    e.preventDefault();
    const sid = form.dataset.feedForm;
    const input = form.querySelector('.field__input');
    const submit = form.querySelector('button[type="submit"]');
    const body = input.value.trim();
    if (!body || submit.dataset.loading) return;
    setFieldError(input, null);
    setButtonLoading(submit, true);
    try {
      const comment = await api.addSessionComment(sid, body);
      if (disposed) return;
      const card = form.closest('.feed-card');
      const list = card.querySelector('[data-feed-list]');
      list.querySelector('[data-feed-empty]')?.remove();
      list.insertAdjacentHTML('beforeend', String(commentHTML(comment)));
      input.value = '';
      const count = (Number(card.querySelector('[data-feed-comments]')?.dataset.count) || 0) + 1;
      paintCommentCount(card, count);
      notify({ type: 'comment', sessionId: Number(sid), commentCount: count });
    } catch {
      if (!disposed) setFieldError(input, "Couldn't post — try again");
    } finally {
      setButtonLoading(submit, false);
      if (!disposed) input.focus();
    }
  }));

  // Delete own comment (ConfirmInline)
  cleanups.push(mountConfirmInline(root, {
    selector: '[data-confirm][data-feed-cd]',
    onConfirm: async (trigger) => {
      const row = trigger.closest('[data-comment-id]');
      const card = trigger.closest('.feed-card');
      const sid = trigger.closest('[data-feed-thread]')?.dataset.feedThread;
      if (!row || !card || !sid) return;
      try {
        await api.deleteSessionComment(sid, row.dataset.commentId);
        if (disposed) return;
        const list = card.querySelector('[data-feed-list]');
        row.remove();
        if (!list.querySelector('[data-comment-id]')) list.insertAdjacentHTML('beforeend', String(NO_COMMENTS));
        const count = Math.max(0, (Number(card.querySelector('[data-feed-comments]')?.dataset.count) || 0) - 1);
        paintCommentCount(card, count);
        notify({ type: 'comment', sessionId: Number(sid), commentCount: count });
      } catch {
        toast("Couldn't delete comment", { type: 'error' });
      }
    },
  }));

  // Review "More" / "Less"
  cleanups.push(delegate(root, 'click', '[data-feed-more]', (e, btn) => {
    const target = root.querySelector(`#${CSS.escape(btn.dataset.feedMore)}`);
    if (!target) return;
    const expand = btn.getAttribute('aria-expanded') !== 'true';
    target.classList.toggle('line-clamp-4', !expand);
    btn.setAttribute('aria-expanded', expand ? 'true' : 'false');
    btn.querySelector('.btn__label').textContent = expand ? 'Less' : 'More';
  }));

  // Add to library — the feed item carries our own books.id, so the server adds that row directly
  cleanups.push(delegate(root, 'click', '[data-feed-add]', async (e, btn) => {
    if (btn.dataset.loading) return;
    const bookId = btn.dataset.bookId;
    setButtonLoading(btn, true);
    try {
      const row = await api.addToLibrary({ bookId: Number(bookId) });
      upsertLibraryEntry(row);   // store: the book is in the library whether or not this view is still open
      if (disposed) return;
      const done = String(badge({ label: 'In library', variant: 'neutral', icon: 'check' }));
      root.querySelectorAll('[data-feed-add]').forEach((b) => {
        if (b.dataset.bookId === bookId) b.outerHTML = done;
      });
      toast(TOAST.addedTo(statusLabel(row?.status ?? 'to_read')), {
        action: { label: 'View', onClick: () => { location.hash = `#book/${row?.book_id ?? bookId}`; } },
      });
      notify({ type: 'library', bookId: Number(bookId), entry: row });
    } catch {
      if (!disposed) setButtonLoading(btn, false);
      toast(ERROR.add, { type: 'error' });
    }
  }));

  return () => { disposed = true; cleanups.forEach(off => off()); };
}
