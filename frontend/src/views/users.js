import { api } from '../api.js';
import { getState } from '../store.js';
import { showToast } from '../components/toast.js';
import { avatarHTML } from '../components/avatar.js';
import { escHtml } from '../utils.js';

let feedFilter = 'all'; // 'all' | 'following'
let feedFilterSetByUser = false;
let activeTab = 'feed';

export async function renderUsers(container) {
  container.innerHTML = `<div class="flex justify-center py-20"><div class="spinner"></div></div>`;
  try {
    const loggedIn = !!getState().user;
    if (loggedIn && !feedFilterSetByUser) feedFilter = 'following';
    const [users, feed, challenges, groups] = await Promise.all([
      api.getUsers(),
      api.getFeed(feedFilter === 'following' ? 'following' : undefined).catch(() => []),
      loggedIn ? api.getChallenges().catch(() => []) : Promise.resolve([]),
      loggedIn ? api.getGroups().catch(() => []) : Promise.resolve([]),
    ]);
    render(container, users, feed, challenges, groups);
  } catch (err) {
    container.innerHTML = `<p class="text-red-400 text-center py-20">${escHtml(err.message)}</p>`;
  }
}

function render(container, users, feed, challenges, groups) {
  container.innerHTML = `
    <div class="max-w-2xl mx-auto fade-in">

      <div role="tablist" class="flex gap-0 mb-6 border-b border-border overflow-x-auto shelf-bar">
        <button role="tab" class="readers-tab relative px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-all duration-150" data-tab="feed">Feed</button>
        <button role="tab" class="readers-tab relative px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-all duration-150" data-tab="readers">Readers</button>
        <button role="tab" class="readers-tab relative px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-all duration-150" data-tab="challenges">Challenges</button>
        <button role="tab" class="readers-tab relative px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-all duration-150" data-tab="groups">Groups</button>
      </div>

      <div id="tab-feed" class="tab-panel hidden">
        <div class="flex gap-2 mb-4">
          <button class="feed-filter-btn text-xs px-3 py-1.5 rounded-full border transition-colors ${feedFilter === 'all' ? 'bg-amber-500 border-amber-500 text-stone-950 font-semibold' : 'border-border text-muted hover:border-muted'}"
                  data-filter="all">All readers</button>
          <button class="feed-filter-btn text-xs px-3 py-1.5 rounded-full border transition-colors ${feedFilter === 'following' ? 'bg-amber-500 border-amber-500 text-stone-950 font-semibold' : 'border-border text-muted hover:border-muted'}"
                  data-filter="following">Following</button>
        </div>
        <div id="feed-content">${renderFeed(feed)}</div>
      </div>

      <div id="tab-readers" class="tab-panel hidden">
        <div class="mb-4">
          <input type="text" id="reader-search" placeholder="Search readers…"
            class="field-input w-full" autocomplete="off" />
        </div>
        <div id="readers-list-wrap">${renderReadersList(users)}</div>
      </div>

      <div id="tab-challenges" class="tab-panel hidden"></div>
      <div id="tab-groups" class="tab-panel hidden"></div>
    </div>`;

  // Reader search filter
  container.querySelector('#reader-search')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase().trim();
    const filtered = q ? users.filter(u => u.username.toLowerCase().includes(q)) : users;
    container.querySelector('#readers-list-wrap').innerHTML = renderReadersList(filtered);
  });

  renderChallengesTab(container.querySelector('#tab-challenges'), challenges, container, users, feed, groups);
  renderGroupsTab(container.querySelector('#tab-groups'), groups, container, users, feed, challenges);
  attachFeedInteractions(container.querySelector('#feed-content'));

  function setTab(tab) {
    activeTab = tab;
    container.querySelectorAll('.readers-tab').forEach(btn => {
      const on = btn.dataset.tab === tab;
      btn.className = `readers-tab relative px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-all duration-150 ${
        on ? 'text-amber-400' : 'text-muted hover:text-text'
      }`;
      btn.setAttribute('aria-selected', String(on));
      btn.querySelector('.tab-active-indicator')?.remove();
      if (on) {
        const bar = document.createElement('span');
        bar.className = 'tab-active-indicator';
        btn.appendChild(bar);
      }
    });
    container.querySelectorAll('.tab-panel').forEach(p => {
      p.classList.add('hidden');
      p.classList.remove('fade-in');
    });
    const panel = container.querySelector(`#tab-${tab}`);
    if (panel) {
      panel.classList.remove('hidden');
      void panel.offsetWidth;
      panel.classList.add('fade-in');
    }
  }

  setTab(activeTab);

  container.querySelectorAll('.readers-tab').forEach(btn => {
    btn.addEventListener('click', () => setTab(btn.dataset.tab));
  });

  // Feed filter
  container.querySelectorAll('.feed-filter-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      feedFilter = btn.dataset.filter;
      feedFilterSetByUser = true;
      const feedContent = container.querySelector('#feed-content');
      feedContent.innerHTML = `<div class="flex justify-center py-10"><div class="spinner"></div></div>`;
      try {
        const newFeed = await api.getFeed(feedFilter === 'following' ? 'following' : undefined);
        feedContent.innerHTML = renderFeed(newFeed);
        attachFeedInteractions(feedContent);
      } catch {
        feedContent.innerHTML = `<p class="text-muted italic text-center py-10">Could not load feed.</p>`;
      }
      container.querySelectorAll('.feed-filter-btn').forEach(b => {
        const active = b.dataset.filter === feedFilter;
        b.className = `feed-filter-btn text-xs px-3 py-1.5 rounded-full border transition-colors ${
          active ? 'bg-amber-500 border-amber-500 text-stone-950 font-semibold'
                 : 'border-border text-muted hover:border-muted'
        }`;
      });
    });
  });
}

function linkifyMentions(text) {
  return escHtml(text).replace(/@([a-zA-Z0-9_-]{2,32})/g,
    (_, u) => `<a href="#u/${u}" class="text-amber-400 hover:text-amber-300 transition-colors">@${escHtml(u)}</a>`);
}

// ── Feed ───────────────────────────────────────────────────────────────────────

function timeAgo(ts) {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function renderComment(c) {
  return `
    <div class="flex gap-2.5" data-comment-id="${c.id}">
      ${avatarHTML({ username: c.username, avatarUrl: c.avatar_url }, { size: 22 })}
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <a href="#u/${escHtml(c.username)}"
             class="text-xs font-semibold text-amber-400/90 hover:text-amber-400 transition-colors">${escHtml(c.username)}</a>
          <time class="text-[11px] text-muted">${timeAgo(c.created_at)}</time>
          ${c.is_own
            ? `<button class="delete-comment-btn ml-auto text-[11px] text-muted hover:text-red-400 transition-colors"
                        data-id="${c.id}">Delete</button>`
            : ''}
        </div>
        <p class="text-sm text-text/80 leading-relaxed mt-0.5">${linkifyMentions(c.body)}</p>
      </div>
    </div>`;
}

function feedCard(s, user) {
  const sid = s.session_id ?? s.id;
  const date = new Date(s.finished_at).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
  const stars = s.rating
    ? Array.from({ length: 5 }, (_, i) =>
        `<span class="${i < s.rating ? 'text-amber-400' : 'text-border'}">★</span>`
      ).join('')
    : '';
  const authors = Array.isArray(s.authors) ? s.authors.join(', ') : (s.authors ?? '');
  const cover = s.cover_url
    ? `<img src="${escHtml(s.cover_url)}" alt="" class="w-16 h-24 object-cover rounded-lg shadow-md" loading="lazy" />`
    : `<div class="w-16 h-24 bg-surface-2 rounded-lg flex-shrink-0"></div>`;

  const likeCount = s.like_count ?? 0;
  const liked = !!s.liked;
  const commentCount = s.comment_count ?? 0;
  const readersCount = s.readers_count ?? 0;

  const likeBtn = user
    ? `<button class="like-btn flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors hover:bg-surface-2/60 ${liked ? 'text-rose-400' : 'text-muted hover:text-rose-400'}"
               data-session-id="${sid}" data-liked="${liked}" data-count="${likeCount}">
         <span class="text-base leading-none">${liked ? '♥' : '♡'}</span>
         <span class="like-count">${likeCount > 0 ? likeCount : ''}</span>
       </button>`
    : likeCount > 0
    ? `<span class="flex items-center gap-1 text-xs text-muted px-2 py-1"><span class="text-base leading-none">♥</span> ${likeCount}</span>`
    : '';

  const commentToggle = `
    <button class="comments-toggle-btn flex items-center gap-1 text-xs px-2 py-1 rounded-md text-muted hover:text-amber-400 transition-colors hover:bg-surface-2/60"
            data-session-id="${sid}">
      <span class="text-base leading-none">💬</span>
      <span class="comment-count-label">${commentCount > 0 ? commentCount : ''}</span>
    </button>`;

  const readersChip = readersCount > 1
    ? `<span class="text-xs text-muted px-1">· ${readersCount} read this</span>`
    : '';

  const addLibBtn = user && !s.is_in_library
    ? `<button class="add-library-btn text-xs px-2.5 py-1 rounded-md border border-border/50 text-muted hover:border-amber-500/70 hover:text-amber-400 transition-colors whitespace-nowrap"
               data-google-id="${escHtml(s.google_id ?? '')}"
               data-title="${escHtml(s.title)}"
               data-authors="${escHtml(JSON.stringify(s.authors ?? []))}"
               data-cover="${escHtml(s.cover_url ?? '')}">
         + Library
       </button>`
    : '';

  return `
    <div class="feed-card rounded-xl bg-surface border border-border/40" data-sid="${sid}">
      <div class="flex items-center justify-between px-4 pt-3 pb-2.5">
        <a href="#u/${escHtml(s.username)}" class="flex items-center gap-2 hover:opacity-80 transition-opacity group">
          ${avatarHTML({ username: s.username, avatarUrl: s.avatar_url }, { size: 22 })}
          <span class="text-sm font-medium text-amber-400/90 group-hover:text-amber-400 transition-colors">@${escHtml(s.username)}</span>
        </a>
        <time class="text-xs text-muted">${date}</time>
      </div>

      <div class="flex gap-4 px-4 pb-3">
        <a href="#book/${s.book_id}" class="flex-shrink-0 hover:opacity-90 transition-opacity">${cover}</a>
        <div class="flex-1 min-w-0">
          <a href="#book/${s.book_id}"
             class="font-semibold text-text hover:text-amber-400 transition-colors leading-snug line-clamp-2">${escHtml(s.title)}</a>
          ${authors ? `<p class="text-xs text-muted mt-0.5 line-clamp-1">${escHtml(authors)}</p>` : ''}
          ${stars   ? `<p class="mt-1.5 leading-none">${stars}</p>` : ''}
          ${s.review ? `<p class="text-sm text-text/80 mt-2 line-clamp-4 leading-relaxed">${linkifyMentions(s.review)}</p>` : ''}
        </div>
      </div>

      <div class="flex items-center gap-1 px-3 py-2 border-t border-border/20">
        ${likeBtn}
        ${commentToggle}
        ${readersChip}
        <div class="flex-1"></div>
        ${addLibBtn}
      </div>

      <div class="comments-panel hidden border-t border-border/20 px-4 py-3"
           data-sid="${sid}" data-loaded="false">
        <div class="comments-list space-y-3"></div>
        ${user ? `
          <form class="comment-form flex gap-2 mt-3" data-session-id="${sid}">
            <input type="text"
              class="comment-input field-input flex-1 text-sm"
              placeholder="Write a comment…" maxlength="1000" autocomplete="off" />
            <button type="submit"
              class="flex-shrink-0 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-stone-950 font-semibold rounded-lg text-xs transition-colors">
              Post
            </button>
          </form>` : ''}
      </div>
    </div>`;
}

function renderFeed(feed) {
  if (!feed.length) {
    const msg = feedFilter === 'following'
      ? 'No activity from people you follow yet.'
      : 'No reviews yet — be the first!';
    return `<div class="text-center py-16 text-muted italic">${msg}</div>`;
  }
  const { user } = getState();
  return `<div class="space-y-4 stagger">
    ${feed.map(s => feedCard(s, user)).join('')}
  </div>`;
}

function attachFeedInteractions(el) {
  if (!el) return;

  el.addEventListener('click', async e => {
    // ── Like ──
    const likeBtn = e.target.closest('.like-btn');
    if (likeBtn && !likeBtn.disabled) {
      const sid = likeBtn.dataset.sessionId;
      const wasLiked = likeBtn.dataset.liked === 'true';
      likeBtn.disabled = true;
      try {
        const result = wasLiked ? await api.unlikeSession(sid) : await api.likeSession(sid);
        const count = result.likeCount;
        const nowLiked = !wasLiked;
        likeBtn.dataset.liked = String(nowLiked);
        likeBtn.querySelector('.like-count').textContent = count > 0 ? count : '';
        likeBtn.querySelector('span:first-child').textContent = nowLiked ? '♥' : '♡';
        likeBtn.className = `like-btn flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors hover:bg-surface-2/60 ${nowLiked ? 'text-rose-400' : 'text-muted hover:text-rose-400'}`;
      } catch (err) { showToast(err.message, 'error'); }
      finally { likeBtn.disabled = false; }
      return;
    }

    // ── Comments toggle ──
    const toggleBtn = e.target.closest('.comments-toggle-btn');
    if (toggleBtn) {
      const card = toggleBtn.closest('.feed-card');
      const panel = card?.querySelector('.comments-panel');
      if (!panel) return;
      if (!panel.classList.contains('hidden')) { panel.classList.add('hidden'); return; }
      panel.classList.remove('hidden');
      if (panel.dataset.loaded !== 'true') {
        const sid = toggleBtn.dataset.sessionId;
        const list = panel.querySelector('.comments-list');
        list.innerHTML = `<div class="flex justify-center py-2"><div class="spinner"></div></div>`;
        try {
          const comments = await api.getSessionComments(sid);
          panel.dataset.loaded = 'true';
          list.innerHTML = comments.length
            ? comments.map(renderComment).join('')
            : `<p class="text-xs text-muted italic text-center py-1">No comments yet. Be the first!</p>`;
        } catch {
          list.innerHTML = `<p class="text-xs text-red-400 text-center py-1">Could not load comments.</p>`;
        }
      }
      return;
    }

    // ── Add to library ──
    const addBtn = e.target.closest('.add-library-btn');
    if (addBtn && !addBtn.disabled) {
      addBtn.disabled = true;
      addBtn.textContent = '…';
      try {
        let authors = [];
        try { authors = JSON.parse(addBtn.dataset.authors); } catch {}
        await api.addToLibrary({
          googleId: addBtn.dataset.googleId || undefined,
          title: addBtn.dataset.title,
          authors,
          coverUrl: addBtn.dataset.cover || undefined,
        });
        addBtn.textContent = '✓ Added';
        addBtn.className = 'add-library-btn text-xs px-2.5 py-1 rounded-md border border-green-700/40 text-green-400 cursor-default whitespace-nowrap';
        showToast('Added to library', 'success');
      } catch (err) {
        addBtn.textContent = '+ Library';
        addBtn.disabled = false;
        showToast(err.message, 'error');
      }
      return;
    }

    // ── Delete comment ──
    const delBtn = e.target.closest('.delete-comment-btn');
    if (delBtn && !delBtn.disabled) {
      const commentId = delBtn.dataset.id;
      const panel = delBtn.closest('.comments-panel');
      const sid = panel?.dataset.sid;
      delBtn.disabled = true;
      try {
        await api.deleteSessionComment(sid, commentId);
        delBtn.closest('[data-comment-id]')?.remove();
        const card = panel?.closest('.feed-card');
        const cntEl = card?.querySelector('.comment-count-label');
        if (cntEl) {
          const cur = parseInt(cntEl.textContent || '0', 10);
          cntEl.textContent = cur > 1 ? cur - 1 : '';
        }
      } catch (err) {
        showToast(err.message, 'error');
        delBtn.disabled = false;
      }
    }
  });

  // ── Comment form submit ──
  el.addEventListener('submit', async e => {
    const form = e.target.closest('.comment-form');
    if (!form) return;
    e.preventDefault();
    const sid = form.dataset.sessionId;
    const input = form.querySelector('.comment-input');
    const body = input.value.trim();
    if (!body) return;
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    input.disabled = true;
    try {
      const comment = await api.addSessionComment(sid, body);
      input.value = '';
      const panel = form.closest('.comments-panel');
      const list = panel?.querySelector('.comments-list');
      if (list) {
        const emptyEl = list.querySelector('p.italic');
        if (emptyEl) emptyEl.remove();
        list.insertAdjacentHTML('beforeend', renderComment(comment));
      }
      const card = form.closest('.feed-card');
      const cntEl = card?.querySelector('.comment-count-label');
      if (cntEl) {
        const cur = parseInt(cntEl.textContent || '0', 10);
        cntEl.textContent = cur + 1;
      }
    } catch (err) { showToast(err.message, 'error'); }
    finally {
      submitBtn.disabled = false;
      input.disabled = false;
      input.focus();
    }
  });
}

// ── Readers list ───────────────────────────────────────────────────────────────

function renderReadersList(users) {
  if (!users.length) {
    return `<div class="text-center py-16 text-muted italic">No readers yet.</div>`;
  }
  return `<div class="grid grid-cols-2 gap-3 stagger">
    ${users.map(u => `
        <a href="#u/${escHtml(u.username)}"
           class="group block rounded-xl overflow-hidden bg-surface border border-border/40 hover:border-amber-400/30 transition-colors">
          <div class="h-14 bg-surface-2 overflow-hidden relative">
            ${u.banner_url
              ? `<img src="${escHtml(u.banner_url)}" alt="" class="w-full h-full object-cover" />`
              : `<div class="h-full w-full" style="background:linear-gradient(120deg,${u.accent ? `${escHtml(u.accent)}55` : 'var(--color-accent)'}33 0%,transparent 80%)"></div>`}
          </div>
          <div class="flex items-center gap-2.5 px-3 py-2.5">
            ${avatarHTML({ username: u.username, avatarUrl: u.avatar_url }, { size: 32 })}
            <div class="flex-1 min-w-0">
              <p class="font-semibold text-sm text-text group-hover:text-amber-400 transition-colors truncate">${escHtml(u.username)}</p>
              <p class="text-xs text-muted">${u.book_count} book${u.book_count !== 1 ? 's' : ''}</p>
            </div>
          </div>
        </a>`).join('')}
  </div>`;
}

// ── Challenges ─────────────────────────────────────────────────────────────────

function renderChallengesTab(el, challenges, rootContainer, users, feed, groups) {
  const today = new Date().toISOString().slice(0, 10);
  const active = challenges.filter(c => c.end_date >= today);
  const past   = challenges.filter(c => c.end_date < today);

  async function reload() {
    try {
      const ch = await api.getChallenges();
      renderChallengesTab(el, ch, rootContainer, users, feed, groups);
    } catch { /* silent */ }
  }

  el.innerHTML = `
    <div class="space-y-6">
      <button id="new-challenge-btn"
        class="w-full py-2.5 border border-dashed border-border rounded-xl text-sm text-muted
               hover:border-amber-500 hover:text-amber-400 transition-colors">
        + Create challenge
      </button>

      <div id="challenge-form-wrap" class="hidden"></div>

      ${active.length
        ? `<section>
            <h3 class="text-sm font-semibold text-muted uppercase tracking-wider mb-3">Active</h3>
            <div class="space-y-4">${active.map(c => challengeCard(c)).join('')}</div>
           </section>`
        : `<p class="text-muted italic text-sm text-center py-6">No active challenges yet.</p>`}

      ${past.length
        ? `<section>
            <h3 class="text-sm font-semibold text-muted uppercase tracking-wider mb-3">Past</h3>
            <div class="space-y-4">${past.map(c => challengeCard(c, true)).join('')}</div>
           </section>`
        : ''}
    </div>`;

  // ── Create form ──
  el.querySelector('#new-challenge-btn')?.addEventListener('click', () => {
    const wrap = el.querySelector('#challenge-form-wrap');
    wrap.classList.toggle('hidden');
    if (!wrap.classList.contains('hidden') && !wrap.innerHTML.trim()) {
      wrap.innerHTML = challengeCreateForm();
      wrap.querySelector('#challenge-create-form').addEventListener('submit', async e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const errEl = wrap.querySelector('#challenge-err');
        try {
          await api.createChallenge({
            title: fd.get('title'),
            description: fd.get('description'),
            startDate: fd.get('startDate'),
            endDate: fd.get('endDate'),
          });
          showToast('Challenge created!', 'success');
          await reload();
        } catch (err) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
      });
      wrap.querySelector('#cancel-challenge-btn')?.addEventListener('click', () => {
        wrap.classList.add('hidden'); wrap.innerHTML = '';
      });
    }
  });

  // ── Join / Leave ──
  el.querySelectorAll('.join-challenge-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { id, joined } = btn.dataset;
      try {
        if (joined === 'true') await api.leaveChallenge(id);
        else await api.joinChallenge(id);
        await reload();
      } catch (err) { showToast(err.message, 'error'); }
    });
  });

  // ── Edit (inline form toggle) ──
  el.querySelectorAll('.edit-challenge-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = btn.closest('[data-challenge-id]');
      card?.querySelector('.edit-challenge-form')?.classList.toggle('hidden');
    });
  });

  el.querySelectorAll('.edit-challenge-form').forEach(form => {
    form.querySelector('.cancel-edit-btn')?.addEventListener('click', () => {
      form.classList.add('hidden');
    });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(form);
      const id = form.dataset.challengeId;
      try {
        await api.editChallenge(id, {
          title: fd.get('title'),
          description: fd.get('description'),
          startDate: fd.get('startDate'),
          endDate: fd.get('endDate'),
        });
        showToast('Challenge updated', 'success');
        await reload();
      } catch (err) { showToast(err.message, 'error'); }
    });
  });

  // ── Delete ──
  el.querySelectorAll('.delete-challenge-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this challenge? This cannot be undone.')) return;
      try {
        await api.deleteChallenge(btn.dataset.id);
        showToast('Challenge deleted', 'success');
        await reload();
      } catch (err) { showToast(err.message, 'error'); }
    });
  });

  // ── Remove book ──
  el.querySelectorAll('.remove-book-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await api.removeChallengeBook(btn.dataset.challengeId, btn.dataset.bookId);
        await reload();
      } catch (err) { showToast(err.message, 'error'); }
    });
  });

  // ── Book search (add books) ──
  // Prefetch library in the background so it's ready when the user starts typing
  let libraryCache = null;
  api.getLibrary().then(lib => { libraryCache = lib; }).catch(() => {});

  let bookSearchTimer;
  el.querySelectorAll('.book-search-input').forEach(input => {
    const cid = input.dataset.challengeId;
    const resultsEl = el.querySelector(`.book-search-results[data-challenge-id="${cid}"]`);
    input.addEventListener('input', () => {
      clearTimeout(bookSearchTimer);
      const q = input.value.trim();
      if (!q) { resultsEl.classList.add('hidden'); return; }
      bookSearchTimer = setTimeout(async () => {
        resultsEl.innerHTML = `<p class="px-3 py-2 text-xs text-muted">Searching…</p>`;
        resultsEl.classList.remove('hidden');
        try {
          const ql = q.toLowerCase();
          const library = libraryCache ?? [];

          // Library matches first (filtered client-side)
          const libMatches = library.filter(b =>
            b.title?.toLowerCase().includes(ql) ||
            (b.authors ?? []).some(a => a.toLowerCase().includes(ql))
          ).slice(0, 4);

          // External results, deduplicated against library
          const extResults = await api.search(q);
          const libExternalIds = new Set(libMatches.flatMap(b =>
            [b.google_id && `g:${b.google_id}`, b.open_library_id && `ol:${b.open_library_id}`, b.apple_id && `a:${b.apple_id}`].filter(Boolean)
          ));
          const extMatches = extResults
            .filter(r => (r.googleId || r.openLibraryId || r.appleId)
              && !libExternalIds.has(r.googleId ? `g:${r.googleId}` : r.openLibraryId ? `ol:${r.openLibraryId}` : `a:${r.appleId}`))
            .slice(0, Math.max(2, 6 - libMatches.length));

          if (!libMatches.length && !extMatches.length) {
            resultsEl.innerHTML = `<p class="px-3 py-2 text-xs text-muted italic">No results.</p>`;
            return;
          }

          resultsEl.innerHTML = [
            ...libMatches.map(b => `
              <button class="add-book-result w-full text-left flex items-center gap-2.5 px-3 py-2 hover:bg-surface transition-colors"
                      data-book-id="${b.id}" data-challenge-id="${cid}">
                ${b.cover_url
                  ? `<img src="${escHtml(b.cover_url)}" alt="" class="w-7 h-10 object-cover rounded flex-shrink-0" />`
                  : `<div class="w-7 h-10 bg-surface rounded flex-shrink-0"></div>`}
                <div class="flex-1 min-w-0">
                  <p class="text-xs font-medium text-text line-clamp-1">${escHtml(b.title ?? '')}</p>
                  <p class="text-[11px] text-muted line-clamp-1">${escHtml((b.authors ?? []).join(', '))}</p>
                </div>
                <span class="flex-shrink-0 text-[10px] font-semibold text-amber-400">Library</span>
              </button>`),
            ...extMatches.map(r => `
              <button class="add-book-result w-full text-left flex items-center gap-2.5 px-3 py-2 hover:bg-surface transition-colors"
                      data-google-id="${escHtml(r.googleId ?? '')}"
                      data-open-library-id="${escHtml(r.openLibraryId ?? '')}"
                      data-apple-id="${escHtml(r.appleId ?? '')}" data-challenge-id="${cid}">
                ${r.coverUrl
                  ? `<img src="${escHtml(r.coverUrl)}" alt="" class="w-7 h-10 object-cover rounded flex-shrink-0" />`
                  : `<div class="w-7 h-10 bg-surface rounded flex-shrink-0"></div>`}
                <div class="flex-1 min-w-0">
                  <p class="text-xs font-medium text-text line-clamp-1">${escHtml(r.title ?? '')}</p>
                  <p class="text-[11px] text-muted line-clamp-1">${escHtml(Array.isArray(r.authors) ? r.authors.join(', ') : '')}</p>
                </div>
              </button>`),
          ].join('');
        } catch {
          resultsEl.innerHTML = `<p class="px-3 py-2 text-xs text-red-400">Search failed.</p>`;
        }
      }, 350);
    });
    input.addEventListener('blur', () => {
      setTimeout(() => { resultsEl.classList.add('hidden'); }, 200);
    });
    resultsEl.addEventListener('click', async e => {
      const btn = e.target.closest('.add-book-result');
      if (!btn) return;
      const bookId        = btn.dataset.bookId;
      const googleId      = btn.dataset.googleId;
      const openLibraryId = btn.dataset.openLibraryId;
      const appleId       = btn.dataset.appleId;
      const cid2 = btn.dataset.challengeId;
      btn.disabled = true;
      try {
        // Library books already have an internal id — no extra fetch needed
        const finalBookId = bookId
          ?? (googleId
            ? (await api.getBookByExternalId('google', googleId)).id
            : openLibraryId
              ? (await api.getBookByExternalId('openlibrary', openLibraryId)).id
              : (await api.getBookByExternalId('apple', appleId)).id);
        await api.addChallengeBook(cid2, finalBookId);
        input.value = '';
        resultsEl.classList.add('hidden');
        showToast('Book added to challenge', 'success');
        await reload();
      } catch (err) {
        showToast(err.message, 'error');
        btn.disabled = false;
      }
    });
  });

  // ── Leaderboard ──
  el.querySelectorAll('.leaderboard-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const panel = el.querySelector(`#lb-${id}`);
      if (!panel) return;
      if (!panel.classList.contains('hidden')) { panel.classList.add('hidden'); return; }
      panel.innerHTML = `<div class="flex justify-center py-3"><div class="spinner"></div></div>`;
      panel.classList.remove('hidden');
      try {
        const { leaderboard, total } = await api.getChallengeLeaderboard(id);
        panel.innerHTML = leaderboard.length
          ? `<ol class="space-y-1.5 mt-2 pb-1">
              ${leaderboard.map((u, i) => `
                <li class="flex items-center gap-3 text-sm">
                  <span class="w-5 text-right text-muted font-mono text-xs">${i + 1}</span>
                  <a href="#u/${escHtml(u.username)}" class="flex-1 text-text hover:text-amber-400">${escHtml(u.username)}</a>
                  <span class="text-xs font-semibold ${u.books_read === total && total > 0 ? 'text-green-400' : 'text-amber-400'}">
                    ${u.books_read}${total ? `/${total}` : ''}
                  </span>
                </li>`).join('')}
             </ol>`
          : `<p class="text-muted text-sm italic mt-2 pb-1">No participants yet.</p>`;
      } catch { panel.innerHTML = `<p class="text-red-400 text-xs mt-2">Failed to load.</p>`; }
    });
  });
}

function challengeCard(c, isPast = false) {
  const start = new Date(c.start_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const end   = new Date(c.end_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const books = c.books ?? [];
  const goal  = c.goal ?? 0;
  const pct   = goal > 0 ? Math.min(100, Math.round((c.progress / goal) * 100)) : 0;

  return `
    <div class="bg-surface rounded-xl ring-1 ring-border/20 overflow-hidden" data-challenge-id="${c.id}">

      <!-- Header -->
      <div class="p-4 pb-3">
        <div class="flex items-start justify-between gap-2">
          <div class="flex-1 min-w-0">
            <p class="font-semibold text-text">${escHtml(c.title)}</p>
            ${c.description ? `<p class="text-xs text-muted mt-0.5 line-clamp-2">${escHtml(c.description)}</p>` : ''}
            <p class="text-xs text-muted mt-1.5">${start} – ${end} · by @${escHtml(c.created_by)} · ${c.participant_count} joined</p>
          </div>
          <div class="flex items-center gap-0.5 flex-shrink-0 -mt-0.5">
            ${!isPast ? `
              <button class="join-challenge-btn px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors
                ${c.joined ? 'bg-surface-2 hover:bg-red-900/40 text-text hover:text-red-400' : 'bg-amber-500 hover:bg-amber-400 text-stone-950'}"
                data-id="${c.id}" data-joined="${c.joined}">${c.joined ? 'Leave' : 'Join'}</button>` : ''}
            ${c.is_creator ? `
              <button class="edit-challenge-btn p-1.5 rounded text-muted hover:text-amber-400 transition-colors" data-id="${c.id}" title="Edit">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
              </button>
              <button class="delete-challenge-btn p-1.5 rounded text-muted hover:text-red-400 transition-colors" data-id="${c.id}" title="Delete">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              </button>` : ''}
          </div>
        </div>

        ${c.is_creator ? `
          <form class="edit-challenge-form hidden mt-3 space-y-2 p-3 bg-surface-2 rounded-lg" data-challenge-id="${c.id}">
            <input name="title" class="field-input w-full text-sm" value="${escHtml(c.title)}" required />
            <textarea name="description" class="field-input w-full text-sm resize-none" rows="2">${escHtml(c.description ?? '')}</textarea>
            <div class="flex gap-2">
              <input name="startDate" type="date" class="field-input flex-1 text-sm" value="${c.start_date}" />
              <input name="endDate"   type="date" class="field-input flex-1 text-sm" value="${c.end_date}" />
            </div>
            <div class="flex gap-2">
              <button type="submit" class="flex-1 py-1.5 bg-amber-500 hover:bg-amber-400 text-stone-950 font-semibold rounded-lg text-xs transition-colors">Save</button>
              <button type="button" class="cancel-edit-btn px-3 py-1.5 text-muted hover:text-text text-xs rounded-lg">Cancel</button>
            </div>
          </form>` : ''}
      </div>

      <!-- Books -->
      <div class="border-t border-border/20 px-4 py-3">
        <div class="flex items-center justify-between mb-2">
          <span class="text-xs font-semibold text-muted uppercase tracking-wide">
            Books${goal > 0 ? ` · ${c.progress}/${goal} done` : ''}
          </span>
          ${goal > 0 && c.joined ? `
            <span class="text-xs font-bold ${pct === 100 ? 'text-green-400' : 'text-amber-400'}">${pct}%</span>` : ''}
        </div>

        ${goal > 0 && c.joined ? `
          <div class="w-full bg-surface-2 rounded-full h-1 overflow-hidden mb-3">
            <div class="h-1 rounded-full transition-all ${pct === 100 ? 'bg-green-400' : 'bg-amber-400'}" style="width:${pct}%"></div>
          </div>` : ''}

        ${books.length ? `
          <div class="space-y-2 mb-3">
            ${books.map(b => `
              <div class="flex items-center gap-2.5">
                <a href="#book/${b.book_id}" class="flex-shrink-0 hover:opacity-80 transition-opacity">
                  ${b.cover_url
                    ? `<img src="${escHtml(b.cover_url)}" alt="" class="w-8 h-11 object-cover rounded" />`
                    : `<div class="w-8 h-11 bg-surface-2 rounded"></div>`}
                </a>
                <div class="flex-1 min-w-0">
                  <a href="#book/${b.book_id}" class="text-xs font-medium text-text hover:text-amber-400 transition-colors line-clamp-1">${escHtml(b.title)}</a>
                  <p class="text-[11px] text-muted line-clamp-1">${Array.isArray(b.authors) ? b.authors.slice(0, 2).join(', ') : (b.authors ?? '')}</p>
                </div>
                <span class="flex-shrink-0 text-sm ${b.done ? 'text-green-400' : b.in_library ? 'text-amber-400' : 'text-border'}"
                      title="${b.done ? 'Finished' : b.in_library ? 'In your library' : 'Not in your library'}">
                  ${b.done ? '✓' : b.in_library ? '⦿' : '○'}
                </span>
                ${c.is_creator ? `
                  <button class="remove-book-btn flex-shrink-0 w-5 h-5 flex items-center justify-center rounded text-muted hover:text-red-400 transition-colors"
                          data-challenge-id="${c.id}" data-book-id="${b.book_id}" title="Remove">×</button>` : ''}
              </div>`).join('')}
          </div>` : `
          <p class="text-xs text-muted italic mb-3">${c.is_creator ? 'Search below to add books to this challenge.' : 'No books in this challenge yet.'}</p>`}

        ${c.is_creator ? `
          <div class="mt-1">
            <input type="text"
              class="book-search-input field-input w-full text-sm py-1.5"
              placeholder="Search to add a book…" autocomplete="off"
              data-challenge-id="${c.id}" />
            <div class="book-search-results hidden mt-1 rounded-lg border border-border/40 bg-surface-2 divide-y divide-border/10 max-h-52 overflow-y-auto"
                 data-challenge-id="${c.id}"></div>
          </div>` : ''}
      </div>

      <!-- Leaderboard -->
      <div class="px-4 py-2.5 border-t border-border/20">
        <button class="leaderboard-btn text-xs text-muted hover:text-amber-400 transition-colors" data-id="${c.id}">
          Leaderboard ▾
        </button>
        <div id="lb-${c.id}" class="hidden"></div>
      </div>
    </div>`;
}

function challengeCreateForm() {
  const today = new Date().toISOString().slice(0, 10);
  return `
    <form id="challenge-create-form" class="bg-surface rounded-xl p-4 ring-1 ring-border/20 space-y-3">
      <p class="text-sm font-semibold">New challenge</p>
      <div>
        <label class="text-xs text-muted block mb-1">Title</label>
        <input name="title" required placeholder="e.g. Classic novels of 2025"
          class="field-input w-full" />
      </div>
      <div>
        <label class="text-xs text-muted block mb-1">Description (optional)</label>
        <textarea name="description" rows="2" placeholder="What's the challenge about?"
          class="field-input w-full resize-none"></textarea>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="text-xs text-muted block mb-1">Start date</label>
          <input name="startDate" type="date" required value="${today}" class="field-input w-full" />
        </div>
        <div>
          <label class="text-xs text-muted block mb-1">End date</label>
          <input name="endDate" type="date" required class="field-input w-full" />
        </div>
      </div>
      <p class="text-xs text-muted">After creating, add the specific books from the challenge card.</p>
      <p id="challenge-err" class="text-xs text-red-400 hidden"></p>
      <div class="flex gap-2">
        <button type="submit"
          class="flex-1 py-2 bg-amber-500 hover:bg-amber-400 text-stone-950 font-semibold rounded-lg text-sm transition-colors">
          Create
        </button>
        <button type="button" id="cancel-challenge-btn"
          class="px-4 py-2 text-muted hover:text-text rounded-lg text-sm transition-colors">
          Cancel
        </button>
      </div>
    </form>`;
}

// ── Groups ─────────────────────────────────────────────────────────────────────

function renderGroupsTab(el, groups, rootContainer, _users, _feed, _challenges) {
  el.innerHTML = `
    <div class="space-y-6">
      <div class="flex gap-2">
        <button id="new-group-btn"
          class="flex-1 py-2.5 border border-dashed border-border rounded-xl text-sm text-muted
                 hover:border-amber-500 hover:text-amber-400 transition-colors">
          + Create group
        </button>
        <button id="join-group-btn"
          class="flex-1 py-2.5 border border-dashed border-border rounded-xl text-sm text-muted
                 hover:border-amber-500 hover:text-amber-400 transition-colors">
          Join by code
        </button>
      </div>

      <div id="group-form-wrap" class="hidden"></div>

      ${groups.length
        ? `<div class="space-y-3" id="groups-list">${groups.map(g => groupCard(g)).join('')}</div>`
        : `<p class="text-muted italic text-sm text-center py-6">You're not in any groups yet.</p>`}
    </div>`;

  el.querySelector('#new-group-btn')?.addEventListener('click', () => {
    showGroupForm(el, 'create', rootContainer);
  });

  el.querySelector('#join-group-btn')?.addEventListener('click', () => {
    showGroupForm(el, 'join', rootContainer);
  });

  el.querySelectorAll('.leave-group-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await api.leaveGroup(btn.dataset.id);
        renderUsers(rootContainer);
      } catch (err) { showToast(err.message, 'error'); }
    });
  });

  el.querySelectorAll('.group-feed-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const panel = el.querySelector(`#gf-${id}`);
      if (!panel) return;
      if (!panel.classList.contains('hidden')) { panel.classList.add('hidden'); return; }
      panel.innerHTML = `<div class="flex justify-center py-4"><div class="spinner"></div></div>`;
      panel.classList.remove('hidden');
      try {
        const feed = await api.getGroupFeed(id);
        panel.innerHTML = feed.length
          ? `<div class="space-y-3 mt-3">
              ${feed.map(s => {
                const stars = s.rating ? '★'.repeat(s.rating) + '☆'.repeat(5 - s.rating) : '';
                const cover = s.cover_url
                  ? `<img src="${escHtml(s.cover_url)}" alt="" class="w-10 h-14 object-cover rounded flex-shrink-0" />`
                  : `<div class="w-10 h-14 bg-surface-2 rounded flex-shrink-0"></div>`;
                return `
                  <div class="flex gap-3 bg-surface-2 rounded-xl p-3">
                    <a href="#book/${s.book_id}">${cover}</a>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-start justify-between gap-1">
                        <a href="#book/${s.book_id}" class="text-xs font-semibold hover:text-amber-400 line-clamp-1">${escHtml(s.title)}</a>
                        <a href="#u/${escHtml(s.username)}" class="text-[11px] text-amber-400 hover:underline flex-shrink-0">@${escHtml(s.username)}</a>
                      </div>
                      ${stars ? `<p class="text-amber-400 text-xs mt-0.5">${stars}</p>` : ''}
                      ${s.review ? `<p class="text-xs text-text mt-1 line-clamp-2">${escHtml(s.review)}</p>` : ''}
                    </div>
                  </div>`;
              }).join('')}
             </div>`
          : `<p class="text-muted text-sm italic mt-2">No activity yet.</p>`;
      } catch { panel.innerHTML = `<p class="text-red-400 text-xs mt-2">Failed to load.</p>`; }
    });
  });
}

function groupCard(g) {
  return `
    <div class="bg-surface rounded-xl p-4 ring-1 ring-border/20">
      <div class="flex items-start justify-between gap-3 mb-1">
        <div class="flex-1 min-w-0">
          <p class="font-semibold text-text">${escHtml(g.name)}</p>
          ${g.description ? `<p class="text-xs text-muted mt-0.5 line-clamp-2">${escHtml(g.description)}</p>` : ''}
          <p class="text-xs text-muted mt-1">${g.member_count} member${g.member_count !== 1 ? 's' : ''} · by @${escHtml(g.created_by)}</p>
          ${g.role === 'admin' ? `<p class="text-xs text-muted mt-0.5">Invite code: <span class="font-mono text-amber-500">${escHtml(g.invite_code)}</span></p>` : ''}
        </div>
        <button class="leave-group-btn flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold
                       bg-surface-2 hover:bg-red-900/40 text-text hover:text-red-400 transition-colors"
                data-id="${g.id}">Leave</button>
      </div>
      <button class="group-feed-btn text-xs text-muted hover:text-amber-400 transition-colors mt-1" data-id="${g.id}">
        Group feed ▾
      </button>
      <div id="gf-${g.id}" class="hidden"></div>
    </div>`;
}

function showGroupForm(el, mode, rootContainer) {
  const wrap = el.querySelector('#group-form-wrap');
  wrap.classList.remove('hidden');
  wrap.innerHTML = mode === 'create' ? groupCreateForm() : groupJoinForm();

  if (mode === 'create') {
    wrap.querySelector('#group-create-form').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const errEl = wrap.querySelector('#group-err');
      try {
        await api.createGroup({ name: fd.get('name'), description: fd.get('description') });
        showToast('Group created!', 'success');
        renderUsers(rootContainer);
      } catch (err) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
    });
  } else {
    wrap.querySelector('#group-join-form').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const errEl = wrap.querySelector('#group-err');
      try {
        await api.joinGroup(fd.get('code'));
        showToast('Joined group!', 'success');
        renderUsers(rootContainer);
      } catch (err) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
    });
  }

  wrap.querySelector('.cancel-group-btn')?.addEventListener('click', () => {
    wrap.classList.add('hidden');
    wrap.innerHTML = '';
  });
}

function groupCreateForm() {
  return `
    <form id="group-create-form" class="bg-surface rounded-xl p-4 ring-1 ring-border/20 space-y-3">
      <p class="text-sm font-semibold">New group</p>
      <div>
        <label class="text-xs text-muted block mb-1">Name</label>
        <input name="name" required placeholder="e.g. Sci-fi Club"
          class="field-input w-full" />
      </div>
      <div>
        <label class="text-xs text-muted block mb-1">Description (optional)</label>
        <textarea name="description" rows="2"
          class="field-input w-full resize-none"></textarea>
      </div>
      <p id="group-err" class="text-xs text-red-400 hidden"></p>
      <div class="flex gap-2">
        <button type="submit"
          class="flex-1 py-2 bg-amber-500 hover:bg-amber-400 text-stone-950 font-semibold rounded-lg text-sm transition-colors">
          Create
        </button>
        <button type="button" class="cancel-group-btn px-4 py-2 text-muted hover:text-text rounded-lg text-sm">Cancel</button>
      </div>
    </form>`;
}

function groupJoinForm() {
  return `
    <form id="group-join-form" class="bg-surface ring-1 ring-border/20 rounded-xl p-4 space-y-3">
      <p class="text-sm font-semibold">Join a group</p>
      <div>
        <label class="text-xs text-muted block mb-1">Invite code</label>
        <input name="code" required placeholder="8-character code"
          class="field-input w-full font-mono" />
      </div>
      <p id="group-err" class="text-xs text-red-400 hidden"></p>
      <div class="flex gap-2">
        <button type="submit"
          class="flex-1 py-2 bg-amber-500 hover:bg-amber-400 text-stone-950 font-semibold rounded-lg text-sm transition-colors">
          Join
        </button>
        <button type="button" class="cancel-group-btn px-4 py-2 text-muted hover:text-text rounded-lg text-sm">Cancel</button>
      </div>
    </form>`;
}

