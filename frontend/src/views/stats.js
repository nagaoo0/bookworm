// Stats (#stats/overview) and Year in review (#stats/year[/yyyy], #u/:name/year[/yyyy]).
// Spec: docs/design-system.md §8.6. Chart.js is imported lazily (separate chunk) and reads its colours
// from the CSS tokens, so charts are redrawn on `bw:prefs` (theme / accent change).
import { api } from '../api.js';
import { getState } from '../store.js';
import { html, raw, safeUrl, localDayKey } from '../utils.js';
import { ACCENT_KEYS } from '../prefs.js';
import {
  ACTION, EMPTY, LABEL, NAV, TOAST, plural, formatDate, uid, delegate, prefersReducedMotion,
  avatar, badge, button, card, chipGroup, cover, emptyState, icon, mountChipGroup, mountTabs,
  progressRing, sectionHeader, skeletonCard, stars, statCard, tabPanel, tabs, toast,
} from '../ui/index.js';

// ── Shared helpers ───────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Google Books nests broad labels like "Fiction / Science Fiction / Space Opera".
// For those, the top-level segment is meaningless, so the second segment is used instead.
const BROAD = new Set(['Fiction', 'Nonfiction', 'Juvenile Fiction', 'Juvenile Nonfiction', 'Young Adult Fiction', 'Young Adult Nonfiction']);

function normalizeCategory(name) {
  const parts = String(name).split(' / ');
  return (BROAD.has(parts[0]) && parts[1]) ? parts[1] : parts[0];
}

/** [[genre, count], …] for one year, most read first. */
function genresForYear(stats, year) {
  const merged = {};
  for (const [cat, count] of Object.entries(stats.categoriesByYear?.[year] ?? {})) {
    const key = normalizeCategory(cat);
    merged[key] = (merged[key] ?? 0) + count;
  }
  return Object.entries(merged).sort((a, b) => b[1] - a[1]);
}

/** Years that have any reading or listening data, newest first. */
function yearsOf(stats) {
  const keys = new Set([...Object.keys(stats.perYear ?? {}), ...Object.keys(stats.absSessionsByYear ?? {})]);
  return [...keys].map(Number).filter(Number.isFinite).sort((a, b) => b - a);
}

function pickYear(requested, years) {
  const wanted = Number(requested);
  if (Number.isFinite(wanted) && wanted > 1900 && wanted < 3000) return wanted;
  const now = new Date().getFullYear();
  return years.includes(now) ? now : (years[0] ?? now);
}

function computeStreak(dailySessions) {
  // Day keys are local calendar days; walking back with setDate keeps DST days (23 h / 25 h) from skipping a day
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const todayKey = localDayKey(today);
  if (!dailySessions[todayKey] && !dailySessions[localDayKey(yesterday)]) return 0;
  const cur = new Date(today);
  if (!dailySessions[todayKey]) cur.setDate(cur.getDate() - 1);
  let streak = 0;
  while ((dailySessions[localDayKey(cur)] ?? 0) > 0) {
    streak++;
    cur.setDate(cur.getDate() - 1);
  }
  return streak;
}

/** Tracks what a view started so its cleanup can undo all of it, and lets async work notice it was disposed. */
function createScope() {
  const fns = [];
  const scope = {
    disposed: false,
    add(fn) { if (typeof fn === 'function') fns.push(fn); return fn; },
    dispose() {
      if (scope.disposed) return;
      scope.disposed = true;
      while (fns.length) { try { fns.pop()(); } catch { /* keep tearing down */ } }
    },
  };
  return scope;
}

function yearChips(years, selected) {
  if (!years.length) return '';
  return chipGroup({
    name: 'year',
    label: 'Year',
    items: years.map(y => ({ value: y, label: String(y) })),
    value: selected,
  });
}

function loadErrorState() {
  const e = EMPTY.loadError;
  return emptyState({ icon: e.icon, title: e.title, body: e.body, action: { label: e.action, attrs: 'data-action="retry"' } });
}

function statsSkeleton() {
  return html`<div class="space-y-6" role="status" aria-label="Loading" aria-busy="true">
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${[1, 2, 3, 4].map(() => skeletonCard())}</div>
    ${skeletonCard()}${skeletonCard()}
  </div>`;
}

// ── Chart.js (lazy) ──────────────────────────────────────────────────────────

let chartPromise = null;
function loadChart() {
  chartPromise ??= import('chart.js/auto')
    .then(m => m.Chart ?? m.default)
    .catch((err) => { chartPromise = null; throw err; });
  return chartPromise;
}

/** Chart.js draws on a canvas and cannot resolve var(), so resolve the tokens once per draw. */
function readTheme(root) {
  const cs = getComputedStyle(root);
  const g = (name) => cs.getPropertyValue(name).trim();
  return {
    font: cs.fontFamily,
    accent: g('--accent'),
    text2: g('--text-2'),
    text3: g('--text-3'),
    border: g('--border-1'),
    surface: g('--surface-1'),
    series: ['--accent', '--info-fg', '--success-fg', '--danger-fg', '--text-2'].map(g),
  };
}

function withAlpha(color, alpha) {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// ── Heatmap (SVG; colours come from CSS variables, so it needs no redraw on theme change) ──

function heatmapHTML(daily) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - 364);
  start.setDate(start.getDate() - start.getDay());   // back to the Sunday

  const max = Math.max(1, ...Object.values(daily));
  const activeDays = Object.values(daily).filter(v => v > 0).length;
  const CELL = 12, GAP = 3, LABEL_W = 32, LABEL_H = 20;

  const weeks = [];
  const cur = new Date(start);
  while (cur <= today) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      week.push({ date: new Date(cur), count: daily[localDayKey(cur)] ?? 0, future: cur > today });
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push(week);
  }

  const LEVEL_OPACITY = [0, 0.3, 0.5, 0.75, 1];
  const level = (c) => (c === 0 ? 0 : Math.min(4, Math.ceil((c / max) * 4)));
  const cellStyle = (c) => (c === 0 ? 'fill:var(--surface-2)' : `fill:var(--accent);fill-opacity:${LEVEL_OPACITY[level(c)]}`);

  const cells = weeks.map((week, wi) => week.map((day, di) => (day.future ? '' : html`<rect x="${LABEL_W + wi * (CELL + GAP)}" y="${LABEL_H + di * (CELL + GAP)}" width="${CELL}" height="${CELL}" rx="2" style="${cellStyle(day.count)}"><title>${formatDate(day.date)}: ${plural(day.count, 'book')} finished</title></rect>`)));

  let lastMonth = -1;
  const monthLabels = weeks.map((week, wi) => {
    const m = week[0].date.getMonth();
    if (m === lastMonth) return '';
    lastMonth = m;
    return html`<text x="${LABEL_W + wi * (CELL + GAP)}" y="${LABEL_H - 6}" font-size="12" style="fill:var(--text-3)">${MONTHS[m]}</text>`;
  });
  const dayLabels = [['Mon', 1], ['Wed', 3], ['Fri', 5]].map(([label, di]) =>
    html`<text x="0" y="${LABEL_H + di * (CELL + GAP) + CELL - 1}" font-size="12" style="fill:var(--text-3)">${label}</text>`);

  const w = LABEL_W + weeks.length * (CELL + GAP);
  const h = LABEL_H + 7 * (CELL + GAP);
  return html`
    <div class="overflow-x-auto" data-heatmap>
      <svg class="block" width="${w}" height="${h}" role="img" aria-label="Reading activity over the last 12 months: ${plural(activeDays, 'day')} with a finished book">
        ${monthLabels}${dayLabels}${cells}
      </svg>
    </div>
    <div class="flex items-center gap-1.5 mt-3 justify-end" aria-hidden="true">
      <span class="text-caption text-text-3">Less</span>
      ${LEVEL_OPACITY.map(o => html`<span class="block w-3 h-3 rounded-sm" style="${o === 0 ? 'background:var(--surface-2)' : `background:var(--accent);opacity:${o}`}"></span>`)}
      <span class="text-caption text-text-3">More</span>
    </div>`;
}

// ── Overview ─────────────────────────────────────────────────────────────────

function goalCardHTML(goal, year) {
  const now = new Date();
  const isCurrent = year === now.getFullYear();
  if (!goal?.target) {
    if (!isCurrent) return '';
    return card({ content: html`
      <div class="flex items-center gap-4">
        <span class="inline-flex items-center justify-center w-12 h-12 rounded-full bg-surface-2 text-text-3 shrink-0" aria-hidden="true">${icon('target', { size: 24 })}</span>
        <div class="min-w-0 flex-1">
          <h2 class="h3">${LABEL.goal(year)}</h2>
          <p class="text-small text-text-2">Set a reading goal for ${year}.</p>
        </div>
        <a class="btn btn--secondary btn--sm shrink-0" href="#settings/reading"><span class="btn__label">Set goal</span></a>
      </div>` });
  }
  const read = goal.booksRead ?? 0;
  const done = read >= goal.target;
  let pace;
  if (isCurrent) {
    const dayOfYear = Math.floor((now - new Date(year, 0, 0)) / 86400000);
    const diff = read - Math.round((goal.target * dayOfYear) / 365);
    pace = diff > 0 ? `${diff} ahead of pace` : diff < 0 ? `${-diff} behind pace` : 'Right on pace';
  } else {
    pace = done ? 'Goal reached' : `${goal.target - read} short of the goal`;
  }
  return card({ content: html`
    <div class="flex items-center gap-5">
      ${progressRing({ value: read, max: goal.target, size: 96, label: String(read), sublabel: `of ${goal.target}` })}
      <div class="min-w-0 flex-1">
        <h2 class="h3">${LABEL.goal(year)}</h2>
        <p class="text-small text-text-2">${plural(read, 'book')} read · ${pace}${done ? html` <span aria-hidden="true">🎉</span>` : ''}</p>
        <a class="btn btn--ghost btn--sm mt-2" href="#settings/reading"><span class="btn__label">Edit goal</span></a>
      </div>
    </div>` });
}

function listeningCardHTML(stats, year) {
  const sessions = stats.absSessionsByYear?.[year] ?? 0;
  const minutes = stats.absMinutesByYear?.[year] ?? 0;
  const hours = minutes > 0 ? Math.round(minutes / 60) : null;
  const headingId = uid('stats-listening');
  return html`
    <section aria-labelledby="${headingId}">
      ${sectionHeader({ title: LABEL.listening, id: headingId, actions: badge({ label: 'Audiobookshelf', variant: 'info', icon: 'headphones' }) })}
      <div class="grid grid-cols-2 gap-3">
        ${statCard({ label: LABEL.audiobooks, value: sessions, hint: `finished in ${year}` })}
        ${statCard({ label: LABEL.hoursListened, value: hours, hint: hours === null ? `No hours for ${year}` : `listened in ${year}` })}
      </div>
    </section>`;
}

function overviewBodyHTML({ stats, year, goal, absConnected, compact }) {
  const finished = stats.perYear?.[year] ?? 0;
  const pages = stats.pagesByYear?.[year] ?? 0;
  const genres = genresForYear(stats, year);
  const daily = stats.dailySessions ?? {};
  const streak = computeStreak(daily);
  const monthly = MONTHS.map((_, i) => stats.monthly?.[year]?.[i + 1] ?? 0);

  const goalHtml = compact ? '' : goalCardHTML(goal, year);
  const streakHtml = streak > 0
    ? statCard({ label: 'Day streak', value: streak, hint: 'Consecutive days with a finished book', emoji: '🔥', tone: 'accent' })
    : '';
  const monthlyId = uid('stats-monthly');
  const genresId = uid('stats-genres');
  const activityId = uid('stats-activity');
  const monthlySummary = `Books finished by month in ${year}: ${MONTHS.map((m, i) => `${m} ${monthly[i]}`).join(', ')}`;
  const genreSummary = `Genres in ${year}: ${genres.slice(0, 10).map(([g, c]) => `${g} ${c}`).join(', ')}`;

  return html`
    <div class="space-y-6 md:space-y-8">
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        ${statCard({ label: LABEL.finished, value: finished, hint: `${stats.totalBooks ?? 0} all time`, icon: 'check-circle-2' })}
        ${statCard({ label: LABEL.pagesRead, value: pages > 0 ? pages.toLocaleString() : null, hint: pages > 0 ? `in ${year}` : 'Page counts not tracked', icon: 'file-text' })}
        ${statCard({ label: LABEL.averageRating, value: stats.avgRating ? stats.avgRating.toFixed(1) : null, hint: 'across all reads', icon: 'star' })}
        ${statCard({ label: 'Reading now', value: stats.currentlyReading ?? 0, hint: compact ? undefined : 'books in progress', icon: 'book-open', href: compact ? undefined : '#library/status/reading' })}
      </div>

      ${(goalHtml || streakHtml) ? html`<div class="grid gap-3 md:grid-cols-2">
        ${goalHtml ? html`<div class="${streakHtml ? '' : 'md:col-span-2'}">${goalHtml}</div>` : ''}
        ${streakHtml ? html`<div class="${goalHtml ? '' : 'md:col-span-2'}">${streakHtml}</div>` : ''}
      </div>` : ''}

      ${(!compact && absConnected) ? listeningCardHTML(stats, year) : ''}

      <section aria-labelledby="${monthlyId}">
        ${sectionHeader({ title: LABEL.finishedByMonth, id: monthlyId })}
        ${card({ content: html`<div class="relative h-56"><canvas data-chart="monthly" role="img" aria-label="${monthlySummary}"></canvas></div>` })}
      </section>

      ${genres.length ? html`<section aria-labelledby="${genresId}">
        ${sectionHeader({ title: LABEL.genres, id: genresId })}
        ${card({ content: html`<div class="relative h-72"><canvas data-chart="genres" role="img" aria-label="${genreSummary}"></canvas></div>` })}
      </section>` : ''}

      ${Object.keys(daily).length ? html`<section aria-labelledby="${activityId}">
        ${sectionHeader({ title: LABEL.readingActivity, id: activityId })}
        ${card({ content: heatmapHTML(daily) })}
      </section>` : ''}
    </div>`;
}

/**
 * Renders the overview (chips + body + charts) into `container`.
 * `goalFor(year)` → Promise<goal|null> (cached by the caller). Returns cleanup.
 */
function mountOverview(container, { stats, goalFor, absConnected = false, compact = false, year, onYear }) {
  const scope = createScope();
  const years = yearsOf(stats);
  let selected = pickYear(year, years);
  if (!years.includes(selected)) years.unshift(selected);   // requested / current year without data still gets a chip
  years.sort((a, b) => b - a);

  container.innerHTML = String(html`
    <div class="space-y-6 md:space-y-8">
      <div data-year-chips>${yearChips(years, selected)}</div>
      <div data-stats-body></div>
    </div>`);
  const body = container.querySelector('[data-stats-body]');

  let charts = [];
  let drawSeq = 0;
  const destroyCharts = () => { charts.forEach(c => c.destroy()); charts = []; };
  scope.add(destroyCharts);

  async function drawCharts() {
    const seq = ++drawSeq;
    if (!body.querySelector('[data-chart]')) { destroyCharts(); return; }
    let Chart;
    try { Chart = await loadChart(); } catch {
      if (scope.disposed || seq !== drawSeq) return;
      body.querySelectorAll('[data-chart]').forEach(c => {
        c.parentElement.innerHTML = String(emptyState({ icon: 'alert-circle', title: "Couldn't load the chart", size: 'sm' }));
      });
      return;
    }
    if (scope.disposed || seq !== drawSeq) return;
    destroyCharts();

    const t = readTheme(body);
    const animation = prefersReducedMotion() ? false : undefined;
    const tick = { color: t.text2, font: { family: t.font, size: 12 } };

    const monthlyCanvas = body.querySelector('[data-chart="monthly"]');
    if (monthlyCanvas) {
      const counts = MONTHS.map((_, i) => stats.monthly?.[selected]?.[i + 1] ?? 0);
      charts.push(new Chart(monthlyCanvas, {
        type: 'bar',
        data: {
          labels: MONTHS,
          datasets: [{ label: String(selected), data: counts, backgroundColor: withAlpha(t.accent, 0.6), borderColor: t.accent, borderWidth: 1, borderRadius: 4 }],
        },
        options: {
          responsive: true, maintainAspectRatio: false, animation,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: (ctx) => ` ${plural(ctx.parsed.y, 'book')}` } },
          },
          scales: {
            x: { grid: { display: false }, ticks: tick },
            y: { beginAtZero: true, grid: { color: t.border }, ticks: { ...tick, stepSize: 1, precision: 0 } },
          },
        },
      }));
    }

    const genreCanvas = body.querySelector('[data-chart="genres"]');
    if (genreCanvas) {
      const sorted = genresForYear(stats, selected);
      const top = sorted.slice(0, 10);
      const other = sorted.slice(10).reduce((sum, [, n]) => sum + n, 0);
      if (other > 0) top.push(['Other', other]);
      const colors = top.map(([name], i) => {
        if (name === 'Other') return t.text3;
        // Five token colours, then the same colours thinned out (the legend names every slice)
        const tier = Math.floor(i / t.series.length);
        return withAlpha(t.series[i % t.series.length], [1, 0.55, 0.3][Math.min(tier, 2)]);
      });
      charts.push(new Chart(genreCanvas, {
        type: 'doughnut',
        data: { labels: top.map(([n]) => n), datasets: [{ data: top.map(([, n]) => n), backgroundColor: colors, borderColor: t.surface, borderWidth: 2 }] },
        options: {
          responsive: true, maintainAspectRatio: false, animation, cutout: '60%',
          plugins: {
            legend: {
              position: genreCanvas.parentElement.clientWidth < 480 ? 'bottom' : 'right',
              labels: { color: t.text2, boxWidth: 12, font: { family: t.font, size: 12 } },
            },
            tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ${plural(ctx.parsed, 'book')}` } },
          },
        },
      }));
    }
  }

  let renderSeq = 0;
  async function renderBody() {
    const seq = ++renderSeq;
    const goal = compact || !goalFor ? null : await goalFor(selected).catch(() => null);
    if (scope.disposed || seq !== renderSeq) return;
    body.innerHTML = String(overviewBodyHTML({ stats, year: selected, goal, absConnected, compact }));
    const heat = body.querySelector('[data-heatmap]');
    if (heat) heat.scrollLeft = heat.scrollWidth;   // newest weeks first in view
    drawCharts();
  }

  scope.add(mountChipGroup(container, ({ name, value }) => {
    if (name !== 'year') return;
    selected = Number(value);
    onYear?.(selected);
    renderBody();
  }));
  const onPrefs = () => drawCharts();
  window.addEventListener('bw:prefs', onPrefs);
  scope.add(() => window.removeEventListener('bw:prefs', onPrefs));

  renderBody();
  return scope.dispose;
}

// ── Year in review ───────────────────────────────────────────────────────────

function topBooksOf(feed, year) {
  const seen = new Set();
  return (feed ?? [])
    .filter(r => r.finished_at && new Date(r.finished_at).getFullYear() === year)
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || new Date(b.finished_at) - new Date(a.finished_at))
    .filter(r => (seen.has(r.book_id) ? false : (seen.add(r.book_id), true)))
    .slice(0, 5);
}

function yearBodyHTML({ stats, feed, person, year, headingLevel, shareUrl, own }) {
  const finished = stats.perYear?.[year] ?? 0;
  const pages = stats.pagesByYear?.[year] ?? 0;
  const author = stats.favoriteAuthorByYear?.[year] ?? null;
  const topGenre = genresForYear(stats, year)[0]?.[0] ?? null;
  const audioBooks = stats.absSessionsByYear?.[year] ?? 0;
  const audioHours = stats.absMinutesByYear?.[year] ? Math.round(stats.absMinutesByYear[year] / 60) : null;
  const monthly = MONTHS.map((_, i) => stats.monthly?.[year]?.[i + 1] ?? 0);
  const maxMonth = Math.max(0, ...monthly);
  const peak = maxMonth > 0 ? MONTHS[monthly.indexOf(maxMonth)] : null;
  const top = topBooksOf(feed, year);
  const hasAny = finished > 0 || audioBooks > 0;

  const barsId = uid('yir-months');
  const topId = uid('yir-top');
  const shareId = uid('yir-share');
  const heading = headingLevel === 1 ? 'h1' : 'h2';

  const hero = html`
    <div class="relative overflow-hidden rounded-xl border border-border-1 bg-surface-1 p-6 md:p-8 text-center">
      <div class="absolute inset-0 bg-accent-soft pointer-events-none" aria-hidden="true"></div>
      <div class="relative">
        <div class="flex justify-center mb-3">${avatar({ username: person.username, avatarUrl: person.avatarUrl, size: 64, ring: true })}</div>
        <p class="text-small text-text-2">@${person.username}</p>
        <p class="display text-accent-text mt-1">${year}</p>
        ${raw(`<${heading} class="h2 mt-1">`)}${NAV.yearInReview}${raw(`</${heading}>`)}
      </div>
    </div>`;

  if (!hasAny) {
    return html`<div class="space-y-6 md:space-y-8">${hero}${emptyState({ icon: 'calendar', title: `Nothing finished in ${year}`, body: own ? 'Finish a book to start your year in review.' : 'No finished books for this year yet.', size: 'sm' })}</div>`;
  }

  return html`
    <div class="space-y-6 md:space-y-8">
      ${hero}
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        ${statCard({ label: LABEL.finished, value: finished, tone: 'accent' })}
        ${statCard({ label: LABEL.pagesRead, value: pages > 0 ? pages.toLocaleString() : null, hint: pages > 0 ? undefined : 'Page counts not tracked' })}
        ${statCard({ label: LABEL.averageRating, value: stats.avgRating ? stats.avgRating.toFixed(1) : null })}
        ${statCard({ label: 'Finished all time', value: stats.totalBooks ?? 0 })}
        ${author ? statCard({ label: LABEL.favouriteAuthor, value: author, size: 'sm' }) : ''}
        ${topGenre ? statCard({ label: LABEL.topGenre, value: topGenre, size: 'sm' }) : ''}
        ${audioBooks > 0 ? statCard({ label: LABEL.audiobooks, value: audioBooks, size: 'sm' }) : ''}
        ${audioHours ? statCard({ label: LABEL.hoursListened, value: `${audioHours} h`, size: 'sm' }) : ''}
      </div>

      <section aria-labelledby="${barsId}">
        ${sectionHeader({ title: LABEL.finishedByMonth, id: barsId, actions: peak ? badge({ label: `Peak: ${peak}`, variant: 'accent' }) : undefined })}
        ${card({ content: html`
          <div class="flex items-end gap-1.5 h-32" role="img" aria-label="${`Books finished by month in ${year}: ${MONTHS.map((m, i) => `${m} ${monthly[i]}`).join(', ')}`}">
            ${monthly.map((count, i) => {
              const pct = count ? Math.max(8, Math.round((count / maxMonth) * 100)) : 0;
              const isPeak = count === maxMonth && count > 0;
              return html`<div class="flex-1 h-full flex flex-col justify-end items-center gap-1.5">
                <div class="w-full rounded-t-sm ${count ? (isPeak ? 'bg-accent' : 'bg-accent/60') : 'bg-surface-3'}" style="height:${count ? pct : 3}%" title="${MONTHS[i]}: ${plural(count, 'book')}"></div>
                <span class="text-caption ${isPeak ? 'text-accent-text' : 'text-text-3'}" aria-hidden="true">${MONTHS[i][0]}</span>
              </div>`;
            })}
          </div>` })}
      </section>

      ${top.length ? html`<section aria-labelledby="${topId}">
        ${sectionHeader({ title: 'Top books', id: topId })}
        ${card({ padding: 'sm', content: html`<ol class="divide-y divide-border-1">
          ${top.map((b, i) => html`<li class="flex items-center gap-3 py-3 px-1">
            <span class="w-5 text-center text-small text-text-3 tabular-nums" aria-hidden="true">${i + 1}</span>
            ${cover({ url: b.cover_url, bookId: b.book_id, title: b.title, size: 'xs' })}
            <div class="min-w-0 flex-1">
              <a class="block truncate font-medium hover:text-accent-text" href="#book/${b.book_id}">${b.title}</a>
              <p class="truncate text-small text-text-2">${(b.authors ?? []).join(', ')}</p>
            </div>
            ${b.rating ? stars({ value: b.rating, size: 14 }) : ''}
          </li>`)}
        </ol>` })}
      </section>` : ''}

      <section aria-labelledby="${shareId}">
        ${card({ content: html`
          <div class="text-center space-y-3">
            <h2 class="h3" id="${shareId}">Share ${own ? 'your' : 'this'} reading year</h2>
            ${(own && getState().user && getState().user.isPublic === false)
              ? html`<p class="text-small text-text-2">Your profile is private, so only you can open this link.</p>` : ''}
            <p class="text-small text-text-2 break-all"><a class="text-accent-text hover:underline" href="${safeUrl(shareUrl)}">${shareUrl}</a></p>
            <div class="flex justify-center gap-2">
              ${button({ label: ACTION.share, variant: 'primary', icon: 'share-2', attrs: 'data-action="share"' })}
              ${button({ label: ACTION.copyLink, variant: 'secondary', icon: 'link', attrs: 'data-action="copy-link"' })}
            </div>
          </div>` })}
      </section>
    </div>`;
}

/**
 * Year-in-review content for one person into `container`.
 * `basePath` is the hash prefix used for the year in the address bar (history.replaceState, no router run).
 */
function mountYearReview(container, { stats, feed, person, year, basePath, headingLevel, own, backHref }) {
  const scope = createScope();
  const years = yearsOf(stats);
  let selected = pickYear(year, years);
  if (!years.includes(selected)) years.unshift(selected);
  years.sort((a, b) => b - a);

  const shareUrlFor = (y) => `${location.origin}${location.pathname}#u/${encodeURIComponent(person.username)}/year/${y}`;

  container.innerHTML = String(html`
    <div class="space-y-6 md:space-y-8">
      ${backHref ? html`<a class="inline-flex items-center gap-1.5 text-small text-text-2 hover:text-text-1" href="${safeUrl(backHref)}">${icon('arrow-left', { size: 16 })}Back to profile</a>` : ''}
      <div data-year-chips>${yearChips(years, selected)}</div>
      <div data-yir-body></div>
    </div>`);
  const body = container.querySelector('[data-yir-body]');

  const renderBody = () => {
    body.innerHTML = String(yearBodyHTML({ stats, feed, person, year: selected, headingLevel, shareUrl: shareUrlFor(selected), own }));
  };

  scope.add(mountChipGroup(container, ({ name, value }) => {
    if (name !== 'year') return;
    selected = Number(value);
    try { history.replaceState(null, '', `${basePath}${selected}`); } catch { /* sandboxed frames */ }
    renderBody();
  }));

  scope.add(delegate(container, 'click', '[data-action="share"]', async () => {
    const url = shareUrlFor(selected);
    const data = { title: `${person.username}'s ${selected} year in review · Bookworm`, url };
    if (typeof navigator.share === 'function' && (!navigator.canShare || navigator.canShare(data))) {
      try { await navigator.share(data); return; } catch (err) { if (err?.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(url); toast(TOAST.linkCopied); } catch { toast("Couldn't copy the link — try again", { type: 'error' }); }
  }));
  scope.add(delegate(container, 'click', '[data-action="copy-link"]', async () => {
    try { await navigator.clipboard.writeText(shareUrlFor(selected)); toast(TOAST.linkCopied); } catch { toast("Couldn't copy the link — try again", { type: 'error' }); }
  }));

  renderBody();
  return scope.dispose;
}

// ── Exported views ───────────────────────────────────────────────────────────

function pageShell(inner) {
  return html`<div class="max-w-3xl mx-auto space-y-6 md:space-y-8">${inner}</div>`;
}

/**
 * #stats/overview and #stats/year[/yyyy]. Returns the cleanup synchronously; data loads in the background.
 * @param {HTMLElement} el
 * @param {{ tab?: 'overview'|'year', year?: string|number }} [params]
 */
export function renderStats(el, { tab = 'overview', year } = {}) {
  const scope = createScope();
  const activeTab = tab === 'year' ? 'year' : 'overview';
  const tabsId = 'stats-tabs';
  const user = getState().user;

  el.innerHTML = String(pageShell(html`
    <h1 class="h1">Stats</h1>
    ${tabs({ id: tabsId, label: 'Stats sections', value: activeTab, items: [
      { value: 'overview', label: NAV.overview, href: '#stats/overview' },
      { value: 'year', label: NAV.yearInReview, href: '#stats/year' },
    ] })}
    <div data-stats-panel>${tabPanel({ tabsId, value: activeTab, active: true, content: html`<div data-stats-content>${statsSkeleton()}</div>` })}</div>`));
  scope.add(mountTabs(el));
  const content = el.querySelector('[data-stats-content]');

  let inner = null;
  const load = async () => {
    content.innerHTML = String(statsSkeleton());
    try {
      const currentYear = new Date().getFullYear();
      const [stats, absStatus, profile] = await Promise.all([
        api.getStats(),
        activeTab === 'overview' ? api.getIntegrationStatus('audiobookshelf').catch(() => null) : null,
        activeTab === 'year' && user ? api.getProfile(user.username).catch(() => null) : null,
      ]);
      if (scope.disposed) return;

      if (!yearsOf(stats).length && !stats.totalBooks) {
        const e = EMPTY.noStats;
        content.innerHTML = String(emptyState({ icon: e.icon, title: e.title, body: e.body, action: { label: e.action, href: '#library' } }));
        return;
      }

      if (activeTab === 'overview') {
        const goals = new Map();
        const goalFor = (y) => {
          if (!goals.has(y)) goals.set(y, api.getGoal(y).catch(() => null));
          return goals.get(y);
        };
        goals.set(currentYear, api.getGoal(currentYear).catch(() => null));
        inner = mountOverview(content, { stats, goalFor, absConnected: !!absStatus?.connected, year });
      } else {
        inner = mountYearReview(content, {
          stats,
          feed: profile?.feed ?? [],
          person: { username: user?.username ?? '', avatarUrl: user?.avatarUrl ?? null },
          year,
          basePath: '#stats/year/',
          headingLevel: 2,
          own: true,
        });
      }
    } catch {
      if (scope.disposed) return;
      content.innerHTML = String(loadErrorState());
    }
  };

  scope.add(delegate(el, 'click', '[data-action="retry"]', () => load()));
  scope.add(() => { inner?.(); inner = null; });
  load();
  return scope.dispose;
}

/**
 * Compact stats for the profile Stats tab (`#u/:name/stats`): public data from the profile endpoint.
 * @param {HTMLElement} el
 * @param {{ username: string }} params
 * @returns {() => void} cleanup
 */
export function renderStatsCompact(el, { username } = {}) {
  const scope = createScope();
  let inner = null;
  const load = async () => {
    el.innerHTML = String(statsSkeleton());
    try {
      const data = await api.getProfile(username);
      if (scope.disposed) return;
      const stats = data.stats ?? {};
      if (!yearsOf(stats).length && !stats.totalBooks) {
        const e = EMPTY.noStats;
        el.innerHTML = String(emptyState({ icon: e.icon, title: e.title, body: e.body }));
        return;
      }
      inner = mountOverview(el, { stats, compact: true });
    } catch {
      if (scope.disposed) return;
      el.innerHTML = String(loadErrorState());
    }
  };
  scope.add(delegate(el, 'click', '[data-action="retry"]', () => load()));
  scope.add(() => { inner?.(); inner = null; });
  load();
  return scope.dispose;
}

/**
 * Shareable year in review for `#u/:name/year[/yyyy]`. Applies that user's accent to `el` while mounted.
 * @param {HTMLElement} el
 * @param {{ username: string, year?: string|number }} params
 * @returns {() => void} cleanup
 */
export function renderYearInReview(el, { username, year } = {}) {
  const scope = createScope();
  let inner = null;
  const load = async () => {
    el.innerHTML = String(statsSkeleton());
    try {
      const data = await api.getProfile(username);
      if (scope.disposed) return;
      if (ACCENT_KEYS.includes(data.accent)) {
        el.classList.add('accent-scope');
        el.dataset.accent = data.accent;
        scope.add(() => { el.classList.remove('accent-scope'); delete el.dataset.accent; });
      }
      const wrap = document.createElement('div');
      wrap.className = 'max-w-3xl mx-auto';
      el.innerHTML = '';
      el.appendChild(wrap);
      inner = mountYearReview(wrap, {
        stats: data.stats ?? {},
        feed: data.feed ?? [],
        person: { username: data.username, avatarUrl: data.avatarUrl },
        year,
        basePath: `#u/${encodeURIComponent(data.username)}/year/`,
        headingLevel: 1,
        own: getState().user?.username === data.username,
        backHref: `#u/${encodeURIComponent(data.username)}`,
      });
    } catch (err) {
      if (scope.disposed) return;
      if (err?.status === 404) {
        const e = EMPTY.profileUnavailable;
        el.innerHTML = String(pageShell(emptyState({ icon: e.icon, title: e.title, body: e.body, action: { label: e.action, href: '#community/people' } })));
      } else {
        el.innerHTML = String(pageShell(loadErrorState()));
      }
    }
  };
  scope.add(delegate(el, 'click', '[data-action="retry"]', () => load()));
  scope.add(() => { inner?.(); inner = null; });
  load();
  return scope.dispose;
}
