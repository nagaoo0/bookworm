import { api } from '../api.js';
import { getState } from '../store.js';
import { ACCENT_COLORS } from '../prefs.js';
import { avatarHTML } from '../components/avatar.js';
import { escHtml } from '../utils.js';

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
        <p class="text-text text-lg font-semibold">Could not load year in review</p>
        <p class="text-muted text-sm">${escHtml(err.message)}</p>
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
  const monthValues = Object.values(monthlyThisYear).filter(v => v > 0);
  const maxMonth = monthValues.length ? Math.max(...monthValues) : 1;
  const peakMonth = monthValues.length
    ? monthNames[Object.entries(monthlyThisYear).sort((a, b) => b[1] - a[1])[0]?.[0] - 1]
    : null;

  const shareUrl = `${location.origin}${location.pathname}#u/${encodeURIComponent(username)}/wrapped`;

  container.innerHTML = `
    <div class="max-w-lg mx-auto fade-in">
      <!-- Back link -->
      <a href="#u/${escHtml(username)}" class="inline-flex items-center gap-1.5 text-sm text-muted hover:text-text transition-colors mb-6">
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
          <p class="text-muted text-sm mb-1">@${escHtml(username)}'s</p>
          <h1 class="font-serif text-3xl font-bold mb-1" style="color:${accentColor}">${year}</h1>
          <p class="font-serif text-xl font-semibold text-text">Year in Review</p>
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
        <div class="flex items-center justify-between mb-4">
          <h2 class="font-semibold text-text text-sm uppercase tracking-wider">Books per Month</h2>
          ${peakMonth ? `<span class="text-xs" style="color:${accentColor}">Peak: ${peakMonth}</span>` : ''}
        </div>
        <div class="flex items-end gap-1.5 h-24">
          ${monthNames.map((m, i) => {
            const count = monthlyThisYear[i + 1] ?? 0;
            const h = count ? Math.max(6, Math.round((count / maxMonth) * 80)) : 4;
            const isPeak = count === maxMonth && count > 0;
            return `<div class="flex-1 flex flex-col items-center gap-1">
              <div class="w-full rounded-t transition-all duration-500" style="height:${h}px;background:${isPeak ? accentHover : (count ? accentColor : 'rgba(68,64,60,0.4)')}"></div>
              <span class="text-[9px] ${isPeak ? 'font-semibold' : 'text-muted'}" style="${isPeak ? `color:${accentColor}` : ''}">${m}</span>
            </div>`;
          }).join('')}
        </div>
      </div>` : ''}

      <!-- Share -->
      <div class="card-section text-center space-y-3">
        <p class="text-sm text-muted">Share your reading year</p>
        <div class="rounded-lg px-3 py-2.5 text-xs" style="background:rgba(12,10,9,0.6);border:1px solid rgba(68,64,60,0.5)">
          <span class="text-muted select-none">Link: </span>
          <a href="${escHtml(shareUrl)}" class="text-amber-400 hover:text-amber-300 transition-colors break-all">${escHtml(shareUrl)}</a>
        </div>
        <button id="share-wrapped-btn"
          class="px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150 active:scale-[0.98]"
          style="background:${accentColor};color:#1c1917">
          Share
        </button>
      </div>
    </div>`;

  container.querySelector('#share-wrapped-btn')?.addEventListener('click', async () => {
    const btn = container.querySelector('#share-wrapped-btn');
    const shareData = {
      title: `${username}'s ${year} Year in Review · Bookworm`,
      url: shareUrl,
    };
    if (typeof navigator.share === 'function' && navigator.canShare?.(shareData)) {
      try {
        await navigator.share(shareData);
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }
    // Clipboard fallback
    navigator.clipboard.writeText(shareUrl).then(() => {
      if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Share'; }, 1500); }
    }).catch(() => {});
  });
}

function statCard(icon, value, label, accent) {
  return `
    <div class="card-section text-center py-5">
      <div class="text-2xl mb-1">${icon}</div>
      <div class="font-serif text-2xl font-bold text-text truncate" style="color:${accent}">${escHtml(String(value))}</div>
      <div class="text-xs text-muted mt-0.5">${escHtml(label)}</div>
    </div>`;
}

