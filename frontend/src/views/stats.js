// Stats (#stats/overview) and Year in review (#stats/year[/yyyy], #u/:name/year[/yyyy]).
// Spec: docs/visual-v2.md §6.8 (+ §3.6, §3.15, §4.7, §7.1). Chart.js is imported lazily (separate chunk) and reads its
// colours from the --chart-* tokens, so charts are redrawn on `bw:prefs` (theme / accent change).
import { api } from '../api.js';
import { getState } from '../store.js';
import { html, raw, safeUrl, localDayKey } from '../utils.js';
import { ACCENT_KEYS } from '../prefs.js';
import {
  ACTION, EMPTY, LABEL, NAV, TOAST, plural, formatDate, formatAuthors, uid, delegate, prefersReducedMotion,
  badge, button, card, cover, emptyState, genreBreakdown, icon, mountChipGroup, mountStoryCard, mountTabs,
  progressBar, progressRing, sectionHeader, segmented, skeletonCard, stars, statCard, storyCard, tabPanel, tabs, toast,
} from '../ui/index.js';

// ── Shared helpers ───────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Cleaned genre distribution for one year: [{ name, count, share, other? }] (top 7 + Other, see ui/meta.js). */
function genresForYear(stats, year) {
  const lists = [];
  for (const [cat, count] of Object.entries(stats.categoriesByYear?.[year] ?? {})) {
    for (let i = 0; i < Math.min(Number(count) || 0, 200); i++) lists.push([cat]);
  }
  return genreBreakdown(lists);
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

/** Year selector: a segmented control (scrolls sideways when there are many years). */
function yearSelector(years, selected) {
  if (!years.length) return '';
  return html`<div class="max-w-full overflow-x-auto">${segmented({
    name: 'year',
    label: 'Year',
    items: years.map(y => ({ value: y, label: String(y) })),
    value: selected,
  })}</div>`;
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

/** Chart.js draws on a canvas and cannot resolve var(), so resolve the --chart-* tokens once per draw. */
function readTheme(root) {
  const cs = getComputedStyle(root);
  const g = (name) => cs.getPropertyValue(name).trim();
  return {
    font: cs.fontFamily,
    accent: g('--chart-1') || g('--accent'),
    series: [1, 2, 3, 4, 5, 6, 7].map(i => g(`--chart-${i}`)),
    grid: g('--chart-grid') || g('--border-1'),
    text: g('--chart-text') || g('--text-2'),
    text1: g('--text-1'),
    text3: g('--text-3'),
    surface: g('--surface-1'),
    border: g('--border-1'),
    shadow: g('--shadow-3'),
  };
}

function withAlpha(color, alpha) {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// ── Heatmap (our own DOM grid, 53 × 7; colours are CSS variables so it needs no redraw on theme change) ──

const HEAT_STEPS = [25, 50, 75, 100];
const heatBg = (count, max) => (count <= 0
  ? 'var(--surface-2)'
  : `color-mix(in srgb, var(--accent) ${HEAT_STEPS[Math.min(3, Math.ceil((count / max) * 4) - 1)]}%, var(--surface-2))`);

function heatmapHTML(daily) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - 364);
  start.setDate(start.getDate() - start.getDay());   // back to the Sunday

  const max = Math.max(1, ...Object.values(daily));
  const activeDays = Object.values(daily).filter(v => v > 0).length;
  const CELL = 12, GAP = 3;

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

  const cells = weeks.map(week => week.map((day) => {
    if (day.future) return html`<span class="block" aria-hidden="true"></span>`;
    const label = `${day.date.getDate()} ${MONTHS[day.date.getMonth()]} — ${plural(day.count, 'book')}`;
    return html`<span class="block rounded-[3px]" style="${`background:${heatBg(day.count, max)}`}" title="${label}"></span>`;
  }));

  let lastMonth = -1;
  let lastAt = -9;
  const monthLabels = weeks.map((week, wi) => {
    const m = week[0].date.getMonth();
    if (m === lastMonth) return '';
    lastMonth = m;
    if (wi - lastAt < 3) return '';
    lastAt = wi;
    return html`<span class="absolute top-0 text-caption text-text-3" style="${`left:${wi * (CELL + GAP)}px`}">${MONTHS[m]}</span>`;
  });
  const dayLabels = [['Mon', 1], ['Wed', 3], ['Fri', 5]].map(([label, di]) =>
    html`<span class="absolute left-0 text-caption text-text-3 leading-none" style="${`top:${di * (CELL + GAP) + 1}px`}">${label}</span>`);

  const gridW = weeks.length * (CELL + GAP) - GAP;
  const gridH = 7 * (CELL + GAP) - GAP;
  return html`
    <div class="flex gap-2" data-heatmap-wrap>
      <div class="relative shrink-0 w-8" style="${`margin-top:20px;height:${gridH}px`}" aria-hidden="true">${dayLabels}</div>
      <div class="min-w-0 flex-1 overflow-x-auto max-md:[mask-image:linear-gradient(to_right,#000_calc(100%_-_28px),transparent)] max-md:pr-4" data-heatmap>
        <div role="img" aria-label="Reading activity over the last 12 months: ${plural(activeDays, 'day')} with a finished book" style="${`width:${gridW}px`}">
          <div class="relative h-5" aria-hidden="true">${monthLabels}</div>
          <div class="grid" style="${`grid-template-rows:repeat(7,${CELL}px);grid-auto-flow:column;grid-auto-columns:${CELL}px;gap:${GAP}px`}">${cells}</div>
        </div>
      </div>
    </div>
    <div class="flex items-center gap-1.5 mt-3 justify-end" aria-hidden="true">
      <span class="text-caption text-text-3">Less</span>
      <span class="block w-3 h-3 rounded-[3px]" style="background:var(--surface-2)"></span>
      ${HEAT_STEPS.map(p => html`<span class="block w-3 h-3 rounded-[3px]" style="${`background:color-mix(in srgb, var(--accent) ${p}%, var(--surface-2))`}"></span>`)}
      <span class="text-caption text-text-3">More</span>
    </div>`;
}

// ── Overview ─────────────────────────────────────────────────────────────────

function goalCardHTML(goal, year) {
  const now = new Date();
  const isCurrent = year === now.getFullYear();
  if (!goal?.target) {
    if (!isCurrent) return '';
    return card({ cls: 'h-full', content: html`
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
  return card({ cls: 'h-full', content: html`
    <div class="flex items-center gap-5">
      ${progressRing({ value: read, max: goal.target, size: 96, label: String(read), sublabel: `of ${goal.target}` })}
      <div class="min-w-0 flex-1 space-y-3">
        <div>
          <h2 class="h3">${LABEL.goal(year)}</h2>
          <p class="text-small text-text-2">${plural(read, 'book')} read · ${pace}${done ? html` <span aria-hidden="true">🎉</span>` : ''}</p>
        </div>
        ${progressBar({ value: read, max: goal.target, size: 'lg', label: `${year} goal progress`, ticks: [25, 50, 75], tone: done ? 'success' : 'accent' })}
        <a class="btn btn--ghost btn--sm" href="#settings/reading"><span class="btn__label">Edit goal</span></a>
      </div>
    </div>` });
}

function streakCardHTML(daily, streak) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = 27; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push({ d, c: daily[localDayKey(d)] ?? 0 });
  }
  const max = Math.max(1, ...days.map(x => x.c));
  return card({ cls: 'h-full', content: html`
    <div class="flex items-start justify-between gap-3">
      <div>
        <span class="label">Day streak</span>
        <p class="stat mt-1.5 text-accent-text">${streak}<span class="text-small font-medium text-text-2 ml-2 align-middle">${streak === 1 ? 'day' : 'days'}</span></p>
      </div>
      <span class="inline-flex items-center justify-center w-8 h-8 rounded-full bg-accent-soft text-lg" aria-hidden="true">🔥</span>
    </div>
    <div class="grid grid-cols-[repeat(28,minmax(0,1fr))] gap-[3px] mt-4" role="img" aria-label="Finished books in the last 28 days">
      ${days.map(({ d, c }) => html`<span class="block h-5 rounded-[3px]" style="${`background:${heatBg(c, max)}`}" title="${`${d.getDate()} ${MONTHS[d.getMonth()]} — ${plural(c, 'book')}`}"></span>`)}
    </div>
    <p class="text-caption text-text-3 mt-2">Consecutive days with a finished book</p>` });
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

function genreLegendHTML(rows) {
  return html`<ul class="flex flex-wrap gap-1.5 mt-4" aria-label="Genres">
    ${rows.map((g, i) => html`<li class="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full bg-surface-2 text-caption text-text-1">
      <span class="block w-2 h-2 rounded-full shrink-0" style="${`background:${g.other ? 'var(--text-3)' : `var(--chart-${(i % 7) + 1})`}`}" aria-hidden="true"></span>
      <span class="truncate max-w-[10rem]">${g.name}</span><span class="text-text-3 tabular-nums">${g.count}</span>
    </li>`)}
  </ul>`;
}

function overviewBodyHTML({ stats, year, goal, absConnected, compact }) {
  const finished = stats.perYear?.[year] ?? 0;
  const prevFinished = stats.perYear?.[year - 1];
  const pages = stats.pagesByYear?.[year] ?? 0;
  const prevPages = stats.pagesByYear?.[year - 1];
  const genres = genresForYear(stats, year);
  const daily = stats.dailySessions ?? {};
  const streak = computeStreak(daily);
  const monthly = MONTHS.map((_, i) => stats.monthly?.[year]?.[i + 1] ?? 0);
  const pageSeries = Object.keys(stats.pagesByYear ?? {}).map(Number).sort((a, b) => a - b).slice(-6).map(y => stats.pagesByYear[y]);

  const finishedDelta = prevFinished !== undefined && prevFinished !== finished
    ? { value: `${finished > prevFinished ? '+' : '−'}${Math.abs(finished - prevFinished)}`, tone: finished > prevFinished ? 'up' : 'down', label: `vs ${year - 1}` } : undefined;
  const pagesDelta = prevPages > 0 && pages > 0 && prevPages !== pages
    ? { value: `${pages > prevPages ? '+' : '−'}${Math.round((Math.abs(pages - prevPages) / prevPages) * 100)}%`, tone: pages > prevPages ? 'up' : 'down', label: `vs ${year - 1}` } : undefined;

  const goalHtml = compact ? '' : goalCardHTML(goal, year);
  const streakHtml = streak > 0 ? streakCardHTML(daily, streak) : '';
  const monthlyId = uid('stats-monthly');
  const genresId = uid('stats-genres');
  const activityId = uid('stats-activity');
  const monthlySummary = `Books finished by month in ${year}: ${MONTHS.map((m, i) => `${m} ${monthly[i]}`).join(', ')}`;
  const genreSummary = `Genres in ${year}: ${genres.map(g => `${g.name} ${g.count}`).join(', ')}`;
  const genreTotal = genres.reduce((n, g) => n + g.count, 0);

  return html`
    <div class="space-y-4 md:space-y-6">
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 max-xl:[&_svg.sparkline]:hidden">
        ${statCard({ label: LABEL.finished, value: finished, hint: `${stats.totalBooks ?? 0} all time`, icon: 'check-circle-2', delta: finishedDelta, spark: monthly.some(Boolean) ? monthly : undefined })}
        ${statCard({ label: LABEL.pagesRead, value: pages > 0 ? pages.toLocaleString() : null, hint: pages > 0 ? `in ${year}` : 'Page counts not tracked', icon: 'file-text', delta: pagesDelta, spark: pageSeries.length > 1 ? pageSeries : undefined })}
        ${statCard({ label: LABEL.averageRating, value: stats.avgRating ? stats.avgRating.toFixed(1) : null, hint: 'across all reads', icon: 'star' })}
        ${statCard({ label: 'Reading now', value: stats.currentlyReading ?? 0, hint: compact ? undefined : 'books in progress', icon: 'book-open', href: compact ? undefined : '#library/status/reading' })}
      </div>

      ${(goalHtml || streakHtml) ? html`<div class="grid gap-3 md:gap-4 lg:grid-cols-12">
        ${goalHtml ? html`<div class="${streakHtml ? 'lg:col-span-8' : 'lg:col-span-12'}">${goalHtml}</div>` : ''}
        ${streakHtml ? html`<div class="${goalHtml ? 'lg:col-span-4' : 'lg:col-span-12'}">${streakHtml}</div>` : ''}
      </div>` : ''}

      ${(!compact && absConnected) ? listeningCardHTML(stats, year) : ''}

      <div class="grid gap-3 md:gap-4 lg:grid-cols-12">
        <section class="${genres.length ? 'lg:col-span-8' : 'lg:col-span-12'}" aria-labelledby="${monthlyId}">
          ${sectionHeader({ title: LABEL.finishedByMonth, id: monthlyId })}
          ${card({ cls: 'h-[calc(100%-3rem)]', content: html`<div class="relative h-60"><canvas data-chart="monthly" role="img" aria-label="${monthlySummary}"></canvas></div>` })}
        </section>
        ${genres.length ? html`<section class="lg:col-span-4" aria-labelledby="${genresId}">
          ${sectionHeader({ title: LABEL.genres, id: genresId })}
          ${card({ cls: 'h-[calc(100%-3rem)]', content: html`
            <div class="relative h-44"><canvas data-chart="genres" data-total="${genreTotal}" role="img" aria-label="${genreSummary}"></canvas></div>
            ${genreLegendHTML(genres)}` })}
        </section>` : ''}
      </div>

      ${Object.keys(daily).length ? html`<section aria-labelledby="${activityId}">
        ${sectionHeader({ title: LABEL.readingActivity, id: activityId })}
        ${card({ content: heatmapHTML(daily) })}
      </section>` : ''}
    </div>`;
}

/**
 * Renders the overview (year selector + body + charts) into `container`.
 * `goalFor(year)` → Promise<goal|null> (cached by the caller). Returns cleanup.
 */
function mountOverview(container, { stats, goalFor, absConnected = false, compact = false, year, onYear }) {
  const scope = createScope();
  const years = yearsOf(stats);
  let selected = pickYear(year, years);
  if (!years.includes(selected)) years.unshift(selected);   // requested / current year without data still gets a segment
  years.sort((a, b) => b - a);

  container.innerHTML = String(html`
    <div class="space-y-4 md:space-y-6">
      <div class="flex justify-end" data-year-chips>${yearSelector(years, selected)}</div>
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
    const tick = { color: t.text, font: { family: t.font, size: 12 } };
    const tooltip = {
      backgroundColor: t.surface, titleColor: t.text1, bodyColor: t.text, borderColor: t.border, borderWidth: 1,
      padding: 10, cornerRadius: 10, displayColors: false, titleFont: { family: t.font, size: 12 }, bodyFont: { family: t.font, size: 12 },
    };

    const monthlyCanvas = body.querySelector('[data-chart="monthly"]');
    if (monthlyCanvas) {
      const counts = MONTHS.map((_, i) => stats.monthly?.[selected]?.[i + 1] ?? 0);
      // Months with no finished book get a 2 px baseline tick instead of an empty slot
      const baselineTicks = {
        id: 'baselineTicks',
        afterDatasetsDraw(chart) {
          const { ctx, scales: { y } } = chart;
          ctx.save();
          ctx.fillStyle = t.grid;
          chart.getDatasetMeta(0).data.forEach((bar, i) => {
            if (counts[i] === 0) ctx.fillRect(bar.x - 6, y.getPixelForValue(0) - 2, 12, 2);
          });
          ctx.restore();
        },
      };
      charts.push(new Chart(monthlyCanvas, {
        type: 'bar',
        data: {
          labels: MONTHS,
          datasets: [{
            label: String(selected), data: counts, maxBarThickness: 18, borderRadius: { topLeft: 6, topRight: 6 }, borderSkipped: false,
            backgroundColor: (ctx) => {
              const area = ctx.chart.chartArea;
              if (!area) return withAlpha(t.accent, 0.9);
              const g = ctx.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
              g.addColorStop(0, withAlpha(t.accent, 0.9));
              g.addColorStop(1, withAlpha(t.accent, 0.55));
              return g;
            },
          }],
        },
        options: {
          responsive: true, maintainAspectRatio: false, animation,
          plugins: {
            legend: { display: false },
            tooltip: { ...tooltip, callbacks: { label: (ctx) => ` ${plural(ctx.parsed.y, 'book')}` } },
          },
          scales: {
            x: { grid: { display: false }, border: { display: false }, ticks: { ...tick, maxRotation: 0, autoSkip: true } },
            y: { beginAtZero: true, border: { display: false }, grid: { color: t.grid, borderDash: [4, 4], drawTicks: false }, ticks: { ...tick, stepSize: 1, precision: 0, padding: 8 } },
          },
        },
      }));
    }

    const genreCanvas = body.querySelector('[data-chart="genres"]');
    if (genreCanvas) {
      const rows = genresForYear(stats, selected);
      const total = rows.reduce((n, g) => n + g.count, 0);
      const colors = rows.map((g, i) => (g.other ? t.text3 : t.series[i % 7]));
      const centre = {
        id: 'centreTotal',
        afterDraw(chart) {
          const arc = chart.getDatasetMeta(0).data[0];
          if (!arc) return;
          const { ctx } = chart;
          ctx.save();
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = t.text1;
          ctx.font = `700 28px ${t.font}`;
          ctx.fillText(String(total), arc.x, arc.y - 6);
          ctx.fillStyle = t.text;
          ctx.font = `500 12px ${t.font}`;
          ctx.fillText('genre tags', arc.x, arc.y + 16);
          ctx.restore();
        },
      };
      charts.push(new Chart(genreCanvas, {
        type: 'doughnut',
        data: { labels: rows.map(g => g.name), datasets: [{ data: rows.map(g => g.count), backgroundColor: colors, borderColor: t.surface, borderWidth: 3 }] },
        options: {
          responsive: true, maintainAspectRatio: false, animation, cutout: '72%',
          plugins: { legend: { display: false }, tooltip: { ...tooltip, callbacks: { label: (ctx) => ` ${ctx.label}: ${ctx.parsed}` } } },
        },
        plugins: [centre],
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

function firstsOf(feed, year) {
  const inYear = (feed ?? []).filter(r => r.finished_at && new Date(r.finished_at).getFullYear() === year)
    .sort((a, b) => new Date(a.finished_at) - new Date(b.finished_at));
  if (!inYear.length) return [];
  const first = inYear[0];
  const last = inYear[inYear.length - 1];
  const rows = [{ label: 'First finish', book: first }];
  if (last.session_id !== first.session_id) rows.push({ label: 'Latest finish', book: last });
  return rows;
}

function yearBodyHTML({ stats, feed, person, year, headingLevel, shareUrl, own }) {
  const finished = stats.perYear?.[year] ?? 0;
  const pages = stats.pagesByYear?.[year] ?? 0;
  const author = stats.favoriteAuthorByYear?.[year] ?? null;
  const topGenre = genresForYear(stats, year).find(g => !g.other)?.name ?? null;
  const audioBooks = stats.absSessionsByYear?.[year] ?? 0;
  const monthly = MONTHS.map((_, i) => stats.monthly?.[year]?.[i + 1] ?? 0);
  const maxMonth = Math.max(0, ...monthly);
  const peak = maxMonth > 0 ? MONTHS[monthly.indexOf(maxMonth)] : null;
  const top = topBooksOf(feed, year);
  const firsts = firstsOf(feed, year);
  const hasAny = finished > 0 || audioBooks > 0;

  const barsId = uid('yir-months');
  const topId = uid('yir-top');
  const firstsId = uid('yir-firsts');
  const heading = headingLevel === 1 ? 'h1' : 'h2';

  if (!hasAny) {
    return html`<div class="rounded-[24px] bg-surface-2 p-5 md:p-10">${emptyState({ icon: 'calendar', title: `Nothing finished in ${year}`, body: own ? 'Finish a book to start your year in review.' : 'No finished books for this year yet.', size: 'sm' })}</div>`;
  }

  const story = storyCard({
    year, username: person.username, avatarUrl: person.avatarUrl,
    stats: { finished, pages, avgRating: stats.avgRating },
    topBooks: top, favouriteAuthor: author ?? undefined, topGenre: topGenre ?? undefined,
  });

  return html`
    <div class="rounded-[24px] bg-surface-2 p-4 md:p-10 grid gap-8 lg:grid-cols-[400px_minmax(0,1fr)] lg:gap-12 items-start">
      <div class="flex flex-col items-center gap-5 max-md:-mx-4 max-md:-mt-4 max-md:mb-0">
        ${story}
        <div class="w-full max-w-[400px] flex flex-col items-center gap-3 max-md:px-4">
          <div class="flex flex-wrap justify-center gap-2">
            ${button({ label: ACTION.share, variant: 'primary', icon: 'share-2', attrs: 'data-action="share"' })}
            ${button({ label: ACTION.copyLink, variant: 'secondary', icon: 'link', attrs: 'data-action="copy-link"' })}
          </div>
          ${(own && getState().user && getState().user.isPublic === false)
    ? html`<p class="text-small text-text-2 text-center">Your profile is private, so only you can open this link.</p>` : ''}
          <p class="text-small text-text-3 break-all text-center"><a class="hover:text-accent-text hover:underline" href="${safeUrl(shareUrl)}">${shareUrl}</a></p>
        </div>
      </div>

      <div class="min-w-0 space-y-8">
        ${raw(`<${heading} class="h2">`)}${NAV.yearInReview} ${year}${raw(`</${heading}>`)}

        <section aria-labelledby="${barsId}">
          <div class="flex items-center justify-between gap-3 mb-3">
            <h3 class="h3" id="${barsId}">${LABEL.finishedByMonth}</h3>
            ${peak ? badge({ label: `Peak: ${peak}`, variant: 'accent' }) : ''}
          </div>
          ${card({ content: html`
            <div class="flex items-end gap-1.5 h-36" role="img" aria-label="${`Books finished by month in ${year}: ${MONTHS.map((m, i) => `${m} ${monthly[i]}`).join(', ')}`}">
              ${monthly.map((count, i) => {
    const pct = count ? Math.max(8, Math.round((count / maxMonth) * 100)) : 0;
    const isPeak = count === maxMonth && count > 0;
    return html`<div class="flex-1 h-full flex flex-col justify-end items-center gap-1.5">
                  <div class="w-full max-w-[18px] rounded-t-[6px]" style="${count ? `height:${pct}%;background:linear-gradient(to bottom, var(--chart-1), color-mix(in srgb, var(--chart-1) 55%, transparent));${isPeak ? '' : 'opacity:.8'}` : 'height:2px;background:var(--chart-grid)'}" title="${MONTHS[i]}: ${plural(count, 'book')}"></div>
                  <span class="text-caption ${isPeak ? 'text-accent-text' : 'text-text-3'}" aria-hidden="true">${MONTHS[i][0]}</span>
                </div>`;
  })}
            </div>` })}
        </section>

        ${top.length ? html`<section aria-labelledby="${topId}">
          <h3 class="h3 mb-3" id="${topId}">Top books</h3>
          ${card({ padding: 'sm', content: html`<ol class="divide-y divide-border-1">
            ${top.map((b, i) => html`<li class="flex items-center gap-3 py-3 px-1">
              <span class="w-5 text-center text-small text-text-3 tabular-nums" aria-hidden="true">${i + 1}</span>
              ${cover({ url: b.cover_url, bookId: b.book_id, title: b.title, size: 'xs' })}
              <div class="min-w-0 flex-1">
                <a class="block truncate font-medium hover:text-accent-text" href="#book/${b.book_id}">${b.title}</a>
                <p class="truncate text-small text-text-2">${formatAuthors(b.authors)}</p>
              </div>
              ${b.rating ? stars({ value: b.rating, size: 14 }) : ''}
            </li>`)}
          </ol>` })}
        </section>` : ''}

        ${firsts.length ? html`<section aria-labelledby="${firstsId}">
          <h3 class="h3 mb-3" id="${firstsId}">Firsts</h3>
          <div class="grid gap-3 sm:grid-cols-2">
            ${firsts.map(({ label, book }) => card({ padding: 'sm', content: html`
              <div class="flex items-center gap-3">
                ${cover({ url: book.cover_url, bookId: book.book_id, title: book.title, size: 'xs' })}
                <div class="min-w-0">
                  <span class="label">${label}</span>
                  <a class="block truncate font-medium hover:text-accent-text" href="#book/${book.book_id}">${book.title}</a>
                  <p class="text-small text-text-2">${formatDate(book.finished_at)}</p>
                </div>
              </div>` }))}
          </div>
        </section>` : ''}
      </div>
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
    <div class="space-y-4 md:space-y-6">
      <div class="flex flex-wrap items-center justify-between gap-3">
        ${backHref ? html`<a class="inline-flex items-center gap-1.5 text-small text-text-2 hover:text-text-1" href="${safeUrl(backHref)}">${icon('arrow-left', { size: 16 })}Back to profile</a>` : html`<span></span>`}
        <div data-year-chips>${yearSelector(years, selected)}</div>
      </div>
      <div data-yir-body></div>
    </div>`);
  const body = container.querySelector('[data-yir-body]');

  let storyCleanup = null;
  const renderBody = () => {
    storyCleanup?.();
    body.innerHTML = String(yearBodyHTML({ stats, feed, person, year: selected, headingLevel, shareUrl: shareUrlFor(selected), own }));
    storyCleanup = mountStoryCard(body);
  };
  scope.add(() => { storyCleanup?.(); storyCleanup = null; });

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
    try { await navigator.clipboard.writeText(url); if (!scope.disposed) toast(TOAST.linkCopied); } catch { toast("Couldn't copy the link — try again", { type: 'error' }); }
  }));
  scope.add(delegate(container, 'click', '[data-action="copy-link"]', async () => {
    try { await navigator.clipboard.writeText(shareUrlFor(selected)); if (!scope.disposed) toast(TOAST.linkCopied); } catch { toast("Couldn't copy the link — try again", { type: 'error' }); }
  }));

  renderBody();
  return scope.dispose;
}

// ── Exported views ───────────────────────────────────────────────────────────

function pageShell(inner) {
  return html`<div class="max-w-[1120px] mx-auto space-y-4 md:space-y-6">${inner}</div>`;
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
      wrap.className = 'max-w-[1120px] mx-auto';
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
