import { api } from '../api.js';
import { getState } from '../store.js';
import { showToast } from '../components/toast.js';

let feedFilter = 'all'; // 'all' | 'following'
let activeTab = 'feed';

export async function renderUsers(container) {
  container.innerHTML = `<div class="flex justify-center py-20"><div class="spinner"></div></div>`;
  try {
    const loggedIn = !!getState().user;
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
      <h1 class="font-serif text-2xl font-bold mb-6">Readers</h1>

      <div role="tablist" class="flex gap-0 mb-6 border-b border-stone-800 overflow-x-auto shelf-bar">
        <button role="tab" class="readers-tab relative px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-all duration-150" data-tab="feed">Feed</button>
        <button role="tab" class="readers-tab relative px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-all duration-150" data-tab="readers">Readers</button>
        <button role="tab" class="readers-tab relative px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-all duration-150" data-tab="challenges">Challenges</button>
        <button role="tab" class="readers-tab relative px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-all duration-150" data-tab="groups">Groups</button>
      </div>

      <div id="tab-feed" class="tab-panel hidden">
        <div class="flex gap-2 mb-4">
          <button class="feed-filter-btn text-xs px-3 py-1.5 rounded-full border transition-colors ${feedFilter === 'all' ? 'bg-amber-500 border-amber-500 text-stone-950 font-semibold' : 'border-stone-600 text-stone-400 hover:border-stone-400'}"
                  data-filter="all">All readers</button>
          <button class="feed-filter-btn text-xs px-3 py-1.5 rounded-full border transition-colors ${feedFilter === 'following' ? 'bg-amber-500 border-amber-500 text-stone-950 font-semibold' : 'border-stone-600 text-stone-400 hover:border-stone-400'}"
                  data-filter="following">Following</button>
        </div>
        <div id="feed-content">${renderFeed(feed)}</div>
      </div>

      <div id="tab-readers" class="tab-panel hidden">
        ${renderReadersList(users)}
      </div>

      <div id="tab-challenges" class="tab-panel hidden"></div>
      <div id="tab-groups" class="tab-panel hidden"></div>
    </div>`;

  renderChallengesTab(container.querySelector('#tab-challenges'), challenges, container, users, feed, groups);
  renderGroupsTab(container.querySelector('#tab-groups'), groups, container, users, feed, challenges);

  function setTab(tab) {
    activeTab = tab;
    container.querySelectorAll('.readers-tab').forEach(btn => {
      const on = btn.dataset.tab === tab;
      btn.className = `readers-tab relative px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-all duration-150 ${
        on ? 'text-amber-400' : 'text-stone-400 hover:text-stone-200'
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
      const feedContent = container.querySelector('#feed-content');
      feedContent.innerHTML = `<div class="flex justify-center py-10"><div class="spinner"></div></div>`;
      try {
        const newFeed = await api.getFeed(feedFilter === 'following' ? 'following' : undefined);
        feedContent.innerHTML = renderFeed(newFeed);
      } catch {
        feedContent.innerHTML = `<p class="text-stone-500 italic text-center py-10">Could not load feed.</p>`;
      }
      container.querySelectorAll('.feed-filter-btn').forEach(b => {
        const active = b.dataset.filter === feedFilter;
        b.className = `feed-filter-btn text-xs px-3 py-1.5 rounded-full border transition-colors ${
          active ? 'bg-amber-500 border-amber-500 text-stone-950 font-semibold'
                 : 'border-stone-600 text-stone-400 hover:border-stone-400'
        }`;
      });
    });
  });
}

// ── Feed ───────────────────────────────────────────────────────────────────────

function renderFeed(feed) {
  if (!feed.length) {
    const msg = feedFilter === 'following'
      ? 'No activity from people you follow yet.'
      : 'No reviews yet — be the first!';
    return `<div class="text-center py-16 text-stone-500 italic">${msg}</div>`;
  }
  return `<div class="space-y-3 stagger">
    ${feed.map(s => {
      const date = s.finished_at
        ? new Date(s.finished_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
        : s.started_at
        ? `Started ${new Date(s.started_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`
        : '';
      const stars = s.rating ? Array.from({ length: 5 }, (_, i) =>
        `<span style="color:${i < s.rating ? '#f59e0b' : '#44403c'}">★</span>`).join('') : '';
      const authors = Array.isArray(s.authors) ? s.authors.join(', ') : (s.authors ?? '');
      const cover = s.cover_url
        ? `<img src="${escHtml(s.cover_url)}" alt="" class="w-12 h-[4.5rem] object-cover rounded-lg shadow-md flex-shrink-0" />`
        : `<div class="w-12 h-[4.5rem] bg-stone-800 rounded-lg flex-shrink-0"></div>`;
      return `
        <div class="flex gap-4 rounded-xl p-4 transition-colors hover:bg-stone-800/40"
             style="background:rgba(28,25,23,0.7);border:1px solid rgba(68,64,60,0.4)">
          <a href="#book/${s.book_id}" class="flex-shrink-0 hover:opacity-90 transition-opacity">${cover}</a>
          <div class="flex-1 min-w-0">
            <div class="flex items-start justify-between gap-2 mb-1">
              <a href="#book/${s.book_id}" class="font-semibold leading-tight line-clamp-2 hover:text-amber-400 transition-colors text-stone-100">${escHtml(s.title)}</a>
              <a href="#u/${escHtml(s.username)}" class="text-xs text-amber-400/80 hover:text-amber-400 font-medium flex-shrink-0 transition-colors">@${escHtml(s.username)}</a>
            </div>
            ${authors ? `<p class="text-xs text-stone-400 mt-0.5">${escHtml(authors)}</p>` : ''}
            ${date    ? `<p class="text-xs text-stone-500 mt-1">${escHtml(date)}</p>` : ''}
            ${stars   ? `<p class="text-sm mt-1 leading-none">${stars}</p>` : ''}
            ${s.review ? `<p class="text-sm text-stone-300 mt-2 line-clamp-4 leading-relaxed">${escHtml(s.review)}</p>` : ''}
          </div>
        </div>`;
    }).join('')}
  </div>`;
}

// ── Readers list ───────────────────────────────────────────────────────────────

function renderReadersList(users) {
  if (!users.length) {
    return `<div class="text-center py-16 text-stone-500 italic">No readers yet.</div>`;
  }
  return `<div class="space-y-2 stagger">
    ${users.map(u => {
      const hue = [...u.username].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
      return `
        <a href="#u/${escHtml(u.username)}"
           class="group flex items-center gap-4 rounded-xl px-5 py-3.5 transition-all duration-200 hover:translate-x-0.5"
           style="background:rgba(28,25,23,0.7);border:1px solid rgba(68,64,60,0.4)"
           onmouseenter="this.style.borderColor='rgba(245,158,11,0.25)'" onmouseleave="this.style.borderColor='rgba(68,64,60,0.4)'">
          <div class="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-200 group-hover:scale-105"
               style="background:linear-gradient(135deg,hsl(${hue},50%,35%),hsl(${(hue+50)%360},40%,25%))">
            <span class="text-white font-bold text-base leading-none">${escHtml(u.username[0].toUpperCase())}</span>
          </div>
          <div class="flex-1 min-w-0">
            <p class="font-semibold text-stone-200 group-hover:text-amber-400 transition-colors">${escHtml(u.username)}</p>
            <p class="text-xs text-stone-500 mt-0.5">${u.book_count} book${u.book_count !== 1 ? 's' : ''}</p>
          </div>
          <svg class="w-4 h-4 text-stone-600 group-hover:text-amber-400 group-hover:translate-x-0.5 transition-all duration-150 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
          </svg>
        </a>`;
    }).join('')}
  </div>`;
}

// ── Challenges ─────────────────────────────────────────────────────────────────

function renderChallengesTab(el, challenges, rootContainer, users, feed, groups) {
  const today = new Date().toISOString().slice(0, 10);

  const active   = challenges.filter(c => c.end_date >= today);
  const past     = challenges.filter(c => c.end_date < today);

  el.innerHTML = `
    <div class="space-y-6">
      <button id="new-challenge-btn"
        class="w-full py-2.5 border border-dashed border-stone-600 rounded-xl text-sm text-stone-400
               hover:border-amber-500 hover:text-amber-400 transition-colors">
        + Create challenge
      </button>

      <div id="challenge-form-wrap" class="hidden"></div>

      ${active.length ? `
      <section>
        <h3 class="text-sm font-semibold text-stone-400 uppercase tracking-wider mb-3">Active</h3>
        <div class="space-y-3" id="active-challenges">
          ${active.map(c => challengeCard(c)).join('')}
        </div>
      </section>` : `<p class="text-stone-500 italic text-sm text-center py-6">No active challenges yet.</p>`}

      ${past.length ? `
      <section>
        <h3 class="text-sm font-semibold text-stone-400 uppercase tracking-wider mb-3">Past</h3>
        <div class="space-y-3">${past.map(c => challengeCard(c, true)).join('')}</div>
      </section>` : ''}
    </div>`;

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
            goal: fd.get('goal'),
            startDate: fd.get('startDate'),
            endDate: fd.get('endDate'),
          });
          showToast('Challenge created!', 'success');
          renderUsers(rootContainer);
        } catch (err) {
          errEl.textContent = err.message; errEl.classList.remove('hidden');
        }
      });
      wrap.querySelector('#cancel-challenge-btn')?.addEventListener('click', () => {
        wrap.classList.add('hidden');
        wrap.innerHTML = '';
      });
    }
  });

  el.querySelectorAll('.join-challenge-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const joined = btn.dataset.joined === 'true';
      try {
        if (joined) { await api.leaveChallenge(id); }
        else { await api.joinChallenge(id); }
        renderUsers(rootContainer);
      } catch (err) { showToast(err.message, 'error'); }
    });
  });

  el.querySelectorAll('.leaderboard-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const panel = el.querySelector(`#lb-${id}`);
      if (!panel) return;
      if (!panel.classList.contains('hidden')) { panel.classList.add('hidden'); return; }
      panel.innerHTML = `<div class="flex justify-center py-4"><div class="spinner"></div></div>`;
      panel.classList.remove('hidden');
      try {
        const { leaderboard } = await api.getChallengeLeaderboard(id);
        panel.innerHTML = leaderboard.length
          ? `<ol class="space-y-1.5 mt-2">
              ${leaderboard.map((u, i) => `
                <li class="flex items-center gap-3 text-sm">
                  <span class="w-5 text-right text-stone-500 font-mono text-xs">${i + 1}</span>
                  <a href="#u/${escHtml(u.username)}" class="flex-1 text-stone-200 hover:text-amber-400">${escHtml(u.username)}</a>
                  <span class="text-amber-400 font-semibold">${u.books_read}</span>
                </li>`).join('')}
             </ol>`
          : `<p class="text-stone-500 text-sm italic mt-2">No participants yet.</p>`;
      } catch { panel.innerHTML = `<p class="text-red-400 text-xs mt-2">Failed to load.</p>`; }
    });
  });
}

function challengeCard(c, isPast = false) {
  const start = new Date(c.start_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const end   = new Date(c.end_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const pct   = c.goal > 0 ? Math.min(100, Math.round((c.progress / c.goal) * 100)) : 0;
  return `
    <div class="bg-stone-900 rounded-xl p-4 ring-1 ring-white/5">
      <div class="flex items-start justify-between gap-3 mb-2">
        <div class="flex-1 min-w-0">
          <p class="font-semibold text-stone-100">${escHtml(c.title)}</p>
          ${c.description ? `<p class="text-xs text-stone-400 mt-0.5 line-clamp-2">${escHtml(c.description)}</p>` : ''}
          <p class="text-xs text-stone-500 mt-1">${start} – ${end} · ${c.goal} books · ${c.participant_count} participant${c.participant_count !== 1 ? 's' : ''}</p>
        </div>
        ${!isPast ? `
        <button class="join-challenge-btn flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors
          ${c.joined ? 'bg-stone-700 hover:bg-red-900/40 text-stone-300 hover:text-red-400' : 'bg-amber-500 hover:bg-amber-400 text-stone-950'}"
          data-id="${c.id}" data-joined="${c.joined}">
          ${c.joined ? 'Leave' : 'Join'}
        </button>` : ''}
      </div>
      ${c.joined && !isPast ? `
      <div class="mb-2">
        <div class="flex items-center justify-between text-xs text-stone-500 mb-1">
          <span>Your progress</span><span>${c.progress} / ${c.goal}</span>
        </div>
        <div class="w-full bg-stone-800 rounded-full h-1.5 overflow-hidden">
          <div class="h-1.5 rounded-full bg-amber-400 transition-all" style="width:${pct}%"></div>
        </div>
      </div>` : ''}
      <button class="leaderboard-btn text-xs text-stone-500 hover:text-amber-400 transition-colors" data-id="${c.id}">
        Leaderboard ▾
      </button>
      <div id="lb-${c.id}" class="hidden"></div>
    </div>`;
}

function challengeCreateForm() {
  const today = new Date().toISOString().slice(0, 10);
  return `
    <form id="challenge-create-form" class="bg-stone-900 rounded-xl p-4 ring-1 ring-white/5 space-y-3">
      <p class="text-sm font-semibold">New challenge</p>
      <div>
        <label class="text-xs text-stone-400 block mb-1">Title</label>
        <input name="title" required placeholder="e.g. Read 5 sci-fi books in July"
          class="w-full bg-stone-800 border border-stone-600 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-amber-500" />
      </div>
      <div>
        <label class="text-xs text-stone-400 block mb-1">Description (optional)</label>
        <textarea name="description" rows="2" placeholder="What's the challenge about?"
          class="w-full bg-stone-800 border border-stone-600 rounded-lg px-3 py-1.5 text-sm resize-none focus:outline-none focus:border-amber-500"></textarea>
      </div>
      <div class="grid grid-cols-3 gap-3">
        <div>
          <label class="text-xs text-stone-400 block mb-1">Goal (books)</label>
          <input name="goal" type="number" min="1" max="9999" required value="5"
            class="w-full bg-stone-800 border border-stone-600 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-amber-500" />
        </div>
        <div>
          <label class="text-xs text-stone-400 block mb-1">Start</label>
          <input name="startDate" type="date" required value="${today}"
            class="w-full bg-stone-800 border border-stone-600 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-amber-500" />
        </div>
        <div>
          <label class="text-xs text-stone-400 block mb-1">End</label>
          <input name="endDate" type="date" required
            class="w-full bg-stone-800 border border-stone-600 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-amber-500" />
        </div>
      </div>
      <p id="challenge-err" class="text-xs text-red-400 hidden"></p>
      <div class="flex gap-2">
        <button type="submit"
          class="flex-1 py-2 bg-amber-500 hover:bg-amber-400 text-stone-950 font-semibold rounded-lg text-sm transition-colors">
          Create
        </button>
        <button type="button" id="cancel-challenge-btn"
          class="px-4 py-2 text-stone-400 hover:text-stone-200 rounded-lg text-sm transition-colors">
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
          class="flex-1 py-2.5 border border-dashed border-stone-600 rounded-xl text-sm text-stone-400
                 hover:border-amber-500 hover:text-amber-400 transition-colors">
          + Create group
        </button>
        <button id="join-group-btn"
          class="flex-1 py-2.5 border border-dashed border-stone-600 rounded-xl text-sm text-stone-400
                 hover:border-amber-500 hover:text-amber-400 transition-colors">
          Join by code
        </button>
      </div>

      <div id="group-form-wrap" class="hidden"></div>

      ${groups.length
        ? `<div class="space-y-3" id="groups-list">${groups.map(g => groupCard(g)).join('')}</div>`
        : `<p class="text-stone-500 italic text-sm text-center py-6">You're not in any groups yet.</p>`}
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
                  : `<div class="w-10 h-14 bg-stone-800 rounded flex-shrink-0"></div>`;
                return `
                  <div class="flex gap-3 bg-stone-800 rounded-xl p-3">
                    <a href="#book/${s.book_id}">${cover}</a>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-start justify-between gap-1">
                        <a href="#book/${s.book_id}" class="text-xs font-semibold hover:text-amber-400 line-clamp-1">${escHtml(s.title)}</a>
                        <a href="#u/${escHtml(s.username)}" class="text-[11px] text-amber-400 hover:underline flex-shrink-0">@${escHtml(s.username)}</a>
                      </div>
                      ${stars ? `<p class="text-amber-400 text-xs mt-0.5">${stars}</p>` : ''}
                      ${s.review ? `<p class="text-xs text-stone-300 mt-1 line-clamp-2">${escHtml(s.review)}</p>` : ''}
                    </div>
                  </div>`;
              }).join('')}
             </div>`
          : `<p class="text-stone-500 text-sm italic mt-2">No activity yet.</p>`;
      } catch { panel.innerHTML = `<p class="text-red-400 text-xs mt-2">Failed to load.</p>`; }
    });
  });
}

function groupCard(g) {
  return `
    <div class="bg-stone-900 rounded-xl p-4 ring-1 ring-white/5">
      <div class="flex items-start justify-between gap-3 mb-1">
        <div class="flex-1 min-w-0">
          <p class="font-semibold text-stone-100">${escHtml(g.name)}</p>
          ${g.description ? `<p class="text-xs text-stone-400 mt-0.5 line-clamp-2">${escHtml(g.description)}</p>` : ''}
          <p class="text-xs text-stone-500 mt-1">${g.member_count} member${g.member_count !== 1 ? 's' : ''} · by @${escHtml(g.created_by)}</p>
          ${g.role === 'admin' ? `<p class="text-xs text-stone-500 mt-0.5">Invite code: <span class="font-mono text-amber-500">${escHtml(g.invite_code)}</span></p>` : ''}
        </div>
        <button class="leave-group-btn flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold
                       bg-stone-700 hover:bg-red-900/40 text-stone-300 hover:text-red-400 transition-colors"
                data-id="${g.id}">Leave</button>
      </div>
      <button class="group-feed-btn text-xs text-stone-500 hover:text-amber-400 transition-colors mt-1" data-id="${g.id}">
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
    <form id="group-create-form" class="bg-stone-900 rounded-xl p-4 ring-1 ring-white/5 space-y-3">
      <p class="text-sm font-semibold">New group</p>
      <div>
        <label class="text-xs text-stone-400 block mb-1">Name</label>
        <input name="name" required placeholder="e.g. Sci-fi Club"
          class="w-full bg-stone-800 border border-stone-600 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-amber-500" />
      </div>
      <div>
        <label class="text-xs text-stone-400 block mb-1">Description (optional)</label>
        <textarea name="description" rows="2"
          class="w-full bg-stone-800 border border-stone-600 rounded-lg px-3 py-1.5 text-sm resize-none focus:outline-none focus:border-amber-500"></textarea>
      </div>
      <p id="group-err" class="text-xs text-red-400 hidden"></p>
      <div class="flex gap-2">
        <button type="submit"
          class="flex-1 py-2 bg-amber-500 hover:bg-amber-400 text-stone-950 font-semibold rounded-lg text-sm transition-colors">
          Create
        </button>
        <button type="button" class="cancel-group-btn px-4 py-2 text-stone-400 hover:text-stone-200 rounded-lg text-sm">Cancel</button>
      </div>
    </form>`;
}

function groupJoinForm() {
  return `
    <form id="group-join-form" class="bg-stone-900 rounded-xl p-4 ring-1 ring-white/5 space-y-3">
      <p class="text-sm font-semibold">Join a group</p>
      <div>
        <label class="text-xs text-stone-400 block mb-1">Invite code</label>
        <input name="code" required placeholder="8-character code"
          class="w-full bg-stone-800 border border-stone-600 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:border-amber-500" />
      </div>
      <p id="group-err" class="text-xs text-red-400 hidden"></p>
      <div class="flex gap-2">
        <button type="submit"
          class="flex-1 py-2 bg-amber-500 hover:bg-amber-400 text-stone-950 font-semibold rounded-lg text-sm transition-colors">
          Join
        </button>
        <button type="button" class="cancel-group-btn px-4 py-2 text-stone-400 hover:text-stone-200 rounded-lg text-sm">Cancel</button>
      </div>
    </form>`;
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
