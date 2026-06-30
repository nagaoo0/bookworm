import { api } from '../api.js';
import { Chart, ArcElement, BarElement, CategoryScale, LinearScale, Tooltip, Legend, PieController, BarController } from 'chart.js';

Chart.register(ArcElement, BarElement, CategoryScale, LinearScale, Tooltip, Legend, PieController, BarController);

export async function renderStats(container) {
  container.innerHTML = `<div class="flex justify-center py-20"><div class="spinner"></div></div>`;
  try {
    const currentYear = new Date().getFullYear();
    const [s, goal] = await Promise.all([
      api.getStats(),
      api.getGoal(currentYear).catch(() => null),
    ]);
    render(container, s, {}, goal);
  } catch (err) {
    container.innerHTML = `<p class="text-red-400 text-center py-20">${err.message}</p>`;
  }
}

export function render(container, s, opts = {}, goal = null) {
  const years = Object.keys(s.perYear).map(Number).sort((a, b) => b - a);
  const currentYear = years[0] ?? new Date().getFullYear();

  const hasCats = Object.keys(s.categoriesByYear ?? {}).length > 0;

  // Reading goal progress bar for the current year (only shown on non-compact / full stats page)
  const goalSection = (!opts.compact && goal?.target) ? (() => {
    const pct = Math.min(100, Math.round((goal.booksRead / goal.target) * 100));
    return `
      <section class="bg-surface rounded-xl p-5 ring-1 ring-border/20">
        <div class="flex items-center justify-between mb-3">
          <h2 class="font-serif text-lg font-semibold">${currentYear} Reading Goal</h2>
          <span class="text-sm text-muted">${goal.booksRead} / ${goal.target} books</span>
        </div>
        <div class="w-full bg-surface-2 rounded-full h-3 overflow-hidden">
          <div class="h-3 rounded-full transition-all" style="width:${pct}%;background:var(--color-accent,#f59e0b)"></div>
        </div>
        <p class="text-xs text-muted mt-2">${pct}% complete${pct >= 100 ? ' 🎉' : ''}</p>
      </section>`;
  })() : '';

  container.innerHTML = `
    <div class="${opts.compact ? '' : 'max-w-2xl mx-auto '}space-y-8 fade-in">

      ${!opts.compact ? `<div class="flex items-center justify-between"><h1 class="font-serif text-2xl font-bold">Stats</h1><a href="#wrapped" class="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-150 hover:bg-surface-2/60 border border-border/50" style="color:var(--color-accent)">✨ Year in Review</a></div>` : ''}

      ${goalSection}

      <!-- Summary cards -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
        ${statCard('Books Read', s.totalBooks)}
        ${statCard('Read-throughs', s.totalSessions)}
        ${statCard('Reading Now', s.currentlyReading)}
        ${statCard('Avg Rating', s.avgRating ? s.avgRating.toFixed(1) + ' ★' : '—')}
      </div>

      <!-- Year selector -->
      ${years.length ? `
      <div class="flex items-center gap-3">
        <label class="text-sm text-muted font-medium">Year</label>
        <select id="${opts.yearSelectId ?? 'year-select'}"
          class="field-input rounded-lg px-3 py-1.5 text-sm">
          ${years.map(y => `<option value="${y}" ${y === currentYear ? 'selected' : ''}>${y}</option>`).join('')}
        </select>
      </div>` : ''}

      <!-- Monthly bar chart -->
      <section>
        <h2 class="font-serif text-xl font-semibold mb-4">Books Finished by Month</h2>
        <div class="bg-surface rounded-xl p-4 ring-1 ring-border/20" style="height:220px">
          <canvas id="${opts.barCanvasId ?? 'monthly-chart'}"></canvas>
        </div>
      </section>

      <!-- Categories pie chart -->
      ${hasCats ? `
      <section id="${opts.pieSectionId ?? 'pie-section'}">
        <h2 class="font-serif text-xl font-semibold mb-4">Genres / Categories</h2>
        <div class="bg-surface rounded-xl p-4 ring-1 ring-border/20 flex items-center justify-center" style="height:280px">
          <canvas id="${opts.pieCanvasId ?? 'pie-chart'}"></canvas>
        </div>
      </section>` : ''}

      <!-- Reading heatmap -->
      ${Object.keys(s.dailySessions ?? {}).length ? `
      <section>
        <h2 class="font-serif text-xl font-semibold mb-4">Reading Activity</h2>
        <div id="${opts.heatmapId ?? 'reading-heatmap'}" class="bg-surface rounded-xl p-4 ring-1 ring-border/20 overflow-x-auto"></div>
      </section>` : ''}

    </div>`;

  const barId  = opts.barCanvasId ?? 'monthly-chart';
  const pieId  = opts.pieCanvasId ?? 'pie-chart';
  const yearId = opts.yearSelectId ?? 'year-select';

  drawMonthlyChart(s.monthly ?? {}, currentYear, barId);
  drawPieChart(s.categoriesByYear ?? {}, currentYear, pieId);
  drawHeatmap(s.dailySessions ?? {}, opts.heatmapId ?? 'reading-heatmap');

  container.querySelector(`#${yearId}`)?.addEventListener('change', e => {
    const y = Number(e.target.value);
    drawMonthlyChart(s.monthly ?? {}, y, barId);
    drawPieChart(s.categoriesByYear ?? {}, y, pieId);
  });
}

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const PALETTE = [
  '#f59e0b','#3b82f6','#22c55e','#ec4899','#a78bfa','#f97316',
  '#06b6d4','#84cc16','#e879f9','#fb923c','#34d399','#38bdf8',
];

const chartInstances = {};

function drawMonthlyChart(monthly, year, canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const cs = getComputedStyle(document.documentElement);
  const surface2 = cs.getPropertyValue('--color-surface-2').trim() || '#292524';
  const muted    = cs.getPropertyValue('--color-muted').trim()    || '#a8a29e';
  const accent   = cs.getPropertyValue('--color-accent').trim()   || '#f59e0b';

  const counts = MONTH_LABELS.map((_, i) => monthly[year]?.[i + 1] ?? 0);

  chartInstances[canvasId]?.destroy();
  chartInstances[canvasId] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: MONTH_LABELS,
      datasets: [{
        label: String(year),
        data: counts,
        backgroundColor: accent + '99',
        borderColor: accent,
        borderWidth: 1,
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: surface2 }, ticks: { color: muted } },
        y: {
          grid: { color: surface2 },
          ticks: { color: muted, stepSize: 1, precision: 0 },
          beginAtZero: true,
        },
      },
    },
  });
}

// Google Books nests broad labels like "Fiction / Science Fiction / Space Opera".
// For those, the top-level segment is meaningless — use the second segment instead.
const BROAD = new Set(['Fiction', 'Nonfiction', 'Juvenile Fiction', 'Juvenile Nonfiction', 'Young Adult Fiction', 'Young Adult Nonfiction']);

function normalizeCategory(raw) {
  const parts = raw.split(' / ');
  return (BROAD.has(parts[0]) && parts[1]) ? parts[1] : parts[0];
}

function drawPieChart(categoriesByYear, year, canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const raw = categoriesByYear[year] ?? {};
  const categories = {};
  for (const [cat, count] of Object.entries(raw)) {
    const key = normalizeCategory(cat);
    categories[key] = (categories[key] ?? 0) + count;
  }
  const sorted = Object.entries(categories).sort((a, b) => b[1] - a[1]);

  if (!sorted.length) {
    chartInstances[canvasId]?.destroy();
    delete chartInstances[canvasId];
    const section = canvas.closest('section');
    if (section) section.style.display = 'none';
    return;
  }

  const section = canvas.closest('section');
  if (section) section.style.display = '';

  const top = sorted.slice(0, 10);
  const otherSum = sorted.slice(10).reduce((acc, [, v]) => acc + v, 0);
  if (otherSum > 0) top.push(['Other', otherSum]);

  const labels = top.map(([k]) => k);
  const data   = top.map(([, v]) => v);
  const colors = labels.map((_, i) => PALETTE[i % PALETTE.length]);

  const cs2 = getComputedStyle(document.documentElement);
  const surface   = cs2.getPropertyValue('--color-surface').trim()   || '#1c1917';
  const mutedPie  = cs2.getPropertyValue('--color-muted').trim()     || '#a8a29e';

  chartInstances[canvasId]?.destroy();
  chartInstances[canvasId] = new Chart(canvas, {
    type: 'pie',
    data: {
      labels,
      datasets: [{ data, backgroundColor: colors, borderColor: surface, borderWidth: 2 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: { color: mutedPie, boxWidth: 12, font: { size: 11 } },
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.label}: ${ctx.parsed} book${ctx.parsed !== 1 ? 's' : ''}`,
          },
        },
      },
    },
  });
}

function statCard(label, value) {
  return `
    <div class="bg-surface-2 rounded-xl p-4 text-center ring-1 ring-border/20">
      <div class="font-serif text-3xl font-bold text-amber-400">${value}</div>
      <div class="text-xs text-muted mt-1 uppercase tracking-wider">${label}</div>
    </div>`;
}

function drawHeatmap(dailySessions, containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;

  // Build a 52-week grid ending today
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Start from the Sunday 52 weeks ago
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - 364);
  // Rewind to previous Sunday
  startDate.setDate(startDate.getDate() - startDate.getDay());

  const csH = getComputedStyle(document.documentElement);
  const heatSurface2 = csH.getPropertyValue('--color-surface-2').trim() || '#292524';
  const heatAccent   = csH.getPropertyValue('--color-accent').trim()    || '#f59e0b';
  // Convert accent hex to rgba parts for opacity variation
  const accentRgb = heatAccent.startsWith('#') && heatAccent.length === 7
    ? `${parseInt(heatAccent.slice(1,3),16)},${parseInt(heatAccent.slice(3,5),16)},${parseInt(heatAccent.slice(5,7),16)}`
    : '245,158,11';

  const maxVal = Math.max(1, ...Object.values(dailySessions));

  // Build week columns
  const weeks = [];
  let cur = new Date(startDate);
  while (cur <= today) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      const key = cur.toISOString().slice(0, 10);
      const count = dailySessions[key] ?? 0;
      const isFuture = cur > today;
      week.push({ key, count, isFuture, date: new Date(cur) });
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push(week);
  }

  // Month labels
  const monthLabels = [];
  let lastMonth = -1;
  weeks.forEach((week, wi) => {
    const m = week[0].date.getMonth();
    if (m !== lastMonth) {
      monthLabels.push({ wi, label: week[0].date.toLocaleString('default', { month: 'short' }) });
      lastMonth = m;
    }
  });

  const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const cellSize = 12;
  const gap = 3;
  const labelW = 28;
  const labelH = 18;

  const totalW = labelW + weeks.length * (cellSize + gap);
  const totalH = labelH + 7 * (cellSize + gap);

  const cells = weeks.map((week, wi) =>
    week.map((day, di) => {
      if (day.isFuture) return '';
      const x = labelW + wi * (cellSize + gap);
      const y = labelH + di * (cellSize + gap);
      const intensity = day.count === 0 ? 0 : Math.max(0.15, day.count / maxVal);
      const fill = day.count === 0 ? heatSurface2 : `rgba(${accentRgb},${intensity.toFixed(2)})`;
      const label = `${day.key}: ${day.count} session${day.count !== 1 ? 's' : ''}`;
      return `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="2"
                fill="${fill}" class="heatmap-cell" data-tip="${label}">
                <title>${label}</title>
              </rect>`;
    }).join('')
  ).join('');

  const monthLabelsSVG = monthLabels.map(({ wi, label }) => {
    const x = labelW + wi * (cellSize + gap);
    return `<text x="${x}" y="${labelH - 4}" fill="${csH.getPropertyValue('--color-muted').trim() || '#78716c'}" font-size="10" font-family="sans-serif">${label}</text>`;
  }).join('');

  const dayLabelsSVG = [1, 3, 5].map(di => {
    const y = labelH + di * (cellSize + gap) + cellSize - 2;
    return `<text x="0" y="${y}" fill="${csH.getPropertyValue('--color-muted').trim() || '#78716c'}" font-size="10" font-family="sans-serif">${DAY_LABELS[di]}</text>`;
  }).join('');

  el.innerHTML = `
    <svg width="${totalW}" height="${totalH}" style="display:block">
      ${monthLabelsSVG}
      ${dayLabelsSVG}
      ${cells}
    </svg>
    <div class="flex items-center gap-1.5 mt-3 justify-end">
      <span class="text-xs text-muted">Less</span>
      ${[0, 0.25, 0.5, 0.75, 1].map(v =>
        `<div style="width:12px;height:12px;border-radius:2px;background:${v === 0 ? heatSurface2 : `rgba(${accentRgb},${v})`}"></div>`
      ).join('')}
      <span class="text-xs text-muted">More</span>
    </div>`;
}
