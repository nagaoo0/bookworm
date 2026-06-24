import { api } from '../api.js';
import { getState } from '../store.js';
import { ACCENT_COLORS } from '../prefs.js';
import { avatarHTML } from '../components/avatar.js';

export async function renderWrapped(container, username) {
  container.innerHTML = `<div class="flex justify-center py-20"><div class="spinner"></div></div>`;

  try {
    const year = new Date().getFullYear();
    let stats, profileUsername, avatarUrl, accent, bio;

    const { user } = getState();
    if (!username || username === user?.username) {
      // Own wrapped
      stats = await api.getStats();
      profileUsername = user?.username ?? '';
      avatarUrl = user?.avatarUrl ?? null;
      accent = user?.accent ?? null;
      bio = null;
    } else {
      // Other user's wrapped — use profile data
      const data = await api.getProfile(username);
      stats = data.stats;
      profileUsername = data.username;
      avatarUrl = data.avatarUrl;
      accent = data.accent;
      bio = data.bio;
    }

    renderView(container, { stats, username: profileUsername, avatarUrl, accent, year });
  } catch (err) {
    container.innerHTML = `
      <div class="text-center py-24 space-y-3 fade-in">
        <p class="text-stone-300 text-lg font-semibold">Could not load year in review</p>
        <p class="text-stone-500 text-sm">${escHtml(err.message)}</p>
      </div>`;
  }
}

function renderView(container, { stats, username, avatarUrl, accent, year }) {
  const hue = [...username].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
  const accentColor = (accent && ACCENT_COLORS[accent]) ? ACCENT_COLORS[accent].main : `hsl(${hue},65%,55%)`;
  const accentHover = (accent && ACCENT_COLORS[accent]) ? ACCENT_COLORS[accent].hover : `hsl(${hue},65%,65%)`;

  const yearBooks = stats.perYear?.[year] ?? 0;
  const yearPages = stats.pagesByYear?.[year] ?? 0;
  const favAuthor = stats.favoriteAuthorByYear?.[year] ?? null;
  const avgRating = stats.avgRating;
  const totalBooks = stats.totalBooks;

  // Top genre for this year
  const genresThisYear = stats.categoriesByYear?.[year] ?? {};
  const topGenre = Object.entries(genresThisYear).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  // Books per month this year
  const monthlyThisYear = stats.monthly?.[year] ?? {};
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const maxMonth = Math.max(1, ...Object.values(monthlyThisYear));

  const shareUrl = `${location.origin}${location.pathname}#u/${encodeURIComponent(username)}/wrapped`;

  container.innerHTML = `
    <div class="max-w-lg mx-auto fade-in">
      <!-- Back link -->
      <a href="#u/${escHtml(username)}" class="inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-300 transition-colors mb-6">
        ← Back to profile
      </a>

      <!-- Hero card -->
      <div class="relative rounded-3xl overflow-hidden p-8 mb-6 text-center"
           style="background:linear-gradient(135deg,hsl(${hue},30%,10%),hsl(${(hue+60)%360},25%,8%));border:1px solid rgba(255,255,255,0.08)">
        <div class="absolute inset-0 pointer-events-none"
             style="background:radial-gradient(ellipse at 50% 0%,${accentColor}33 0%,transparent 70%)"></div>
        <div class="relative">
          <div class="flex justify-center mb-4">
            ${avatarHTML({ username, avatarUrl }, { size: 64, classes: 'mx-auto ring-2' })}
          </div>
          <p class="text-stone-400 text-sm mb-1">@${escHtml(username)}'s</p>
          <h1 class="font-serif text-3xl font-bold mb-1" style="color:${accentColor}">${year}</h1>
          <p class="font-serif text-xl font-semibold text-stone-200">Year in Review</p>
        </div>
      </div>

      <!-- Stats grid -->
      <div class="grid grid-cols-2 gap-4 mb-6">
        ${statCard('📚', yearBooks, yearBooks === 1 ? 'Book Read' : 'Books Read', accentColor)}
        ${statCard('📄', yearPages > 0 ? yearPages.toLocaleString() : '—', yearPages > 0 ? 'Pages Turned' : 'Pages (not tracked)', accentColor)}
        ${favAuthor ? statCard('✍️', favAuthor, 'Favorite Author', accentColor) : ''}
        ${topGenre  ? statCard('🏷️', topGenre, 'Top Genre', accentColor) : ''}
        ${avgRating ? statCard('⭐', avgRating.toFixed(1), 'Avg Rating', accentColor) : ''}
        ${statCard('📖', totalBooks, 'Total Library', accentColor)}
      </div>

      <!-- Monthly bars -->
      ${Object.keys(monthlyThisYear).length ? `
      <div class="card-section mb-6">
        <h2 class="font-semibold text-stone-200 mb-4 text-sm uppercase tracking-wider">Books per Month</h2>
        <div class="flex items-end gap-1.5 h-24">
          ${monthNames.map((m, i) => {
            const count = monthlyThisYear[i + 1] ?? 0;
            const h = count ? Math.max(6, Math.round((count / maxMonth) * 80)) : 4;
            return `<div class="flex-1 flex flex-col items-center gap-1">
              <div class="w-full rounded-t transition-all duration-500" style="height:${h}px;background:${count ? accentColor : 'rgba(68,64,60,0.4)'}"></div>
              <span class="text-[9px] text-stone-600">${m}</span>
            </div>`;
          }).join('')}
        </div>
      </div>` : ''}

      <!-- Share -->
      <div class="card-section text-center space-y-3">
        <p class="text-sm text-stone-400">Share your reading year</p>
        <div class="rounded-lg px-3 py-2.5 text-xs" style="background:rgba(12,10,9,0.6);border:1px solid rgba(68,64,60,0.5)">
          <span class="text-stone-500 select-none">Link: </span>
          <a href="${escHtml(shareUrl)}" class="text-amber-400 hover:text-amber-300 transition-colors break-all">${escHtml(shareUrl)}</a>
        </div>
        <button id="copy-wrapped-btn"
          class="px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150 active:scale-[0.98]"
          style="background:${accentColor};color:#1c1917">
          Copy link
        </button>
      </div>
    </div>`;

  container.querySelector('#copy-wrapped-btn')?.addEventListener('click', () => {
    navigator.clipboard.writeText(shareUrl).then(() => {
      const btn = container.querySelector('#copy-wrapped-btn');
      if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy link'; }, 1500); }
    });
  });
}

function statCard(icon, value, label, accent) {
  return `
    <div class="card-section text-center py-5">
      <div class="text-2xl mb-1">${icon}</div>
      <div class="font-serif text-2xl font-bold text-stone-100 truncate" style="color:${accent}">${escHtml(String(value))}</div>
      <div class="text-xs text-stone-500 mt-0.5">${escHtml(label)}</div>
    </div>`;
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
