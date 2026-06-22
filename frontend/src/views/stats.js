import { api } from '../api.js';
import { Chart, ArcElement, BarElement, CategoryScale, LinearScale, Tooltip, Legend, PieController, BarController } from 'chart.js';

Chart.register(ArcElement, BarElement, CategoryScale, LinearScale, Tooltip, Legend, PieController, BarController);

export async function renderStats(container) {
  container.innerHTML = `<p class="text-stone-400 text-center py-20">Loading stats…</p>`;
  try {
    const s = await api.getStats();
    render(container, s);
  } catch (err) {
    container.innerHTML = `<p class="text-red-400 text-center py-20">${err.message}</p>`;
  }
}

function render(container, s) {
  const years = Object.keys(s.perYear).map(Number).sort((a, b) => b - a);
  const currentYear = years[0] ?? new Date().getFullYear();

  container.innerHTML = `
    <div class="max-w-2xl mx-auto space-y-8 fade-in">

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
        <label class="text-sm text-stone-400 font-medium">Year</label>
        <select id="year-select"
          class="bg-stone-800 border border-stone-600 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-amber-500">
          ${years.map(y => `<option value="${y}" ${y === currentYear ? 'selected' : ''}>${y}</option>`).join('')}
        </select>
      </div>` : ''}

      <!-- Monthly bar chart -->
      <section>
        <h2 class="font-serif text-xl font-semibold mb-4">Books Finished by Month</h2>
        <div class="bg-stone-900 rounded-xl p-4 ring-1 ring-white/5" style="height:220px">
          <canvas id="monthly-chart"></canvas>
        </div>
      </section>

      <!-- Categories pie chart -->
      ${Object.keys(s.categories ?? {}).length ? `
      <section>
        <h2 class="font-serif text-xl font-semibold mb-4">Genres / Categories</h2>
        <div class="bg-stone-900 rounded-xl p-4 ring-1 ring-white/5 flex items-center justify-center" style="height:280px">
          <canvas id="pie-chart"></canvas>
        </div>
      </section>` : ''}

    </div>`;

  // Build charts
  drawMonthlyChart(s.monthly ?? {}, currentYear);
  if (Object.keys(s.categories ?? {}).length) drawPieChart(s.categories);

  // Year-switch handler
  container.querySelector('#year-select')?.addEventListener('change', e => {
    drawMonthlyChart(s.monthly ?? {}, Number(e.target.value));
  });
}

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const PALETTE = [
  '#f59e0b','#3b82f6','#22c55e','#ec4899','#a78bfa','#f97316',
  '#06b6d4','#84cc16','#e879f9','#fb923c','#34d399','#38bdf8',
];

let monthlyChartInst = null;
let pieChartInst = null;

function drawMonthlyChart(monthly, year) {
  const canvas = document.getElementById('monthly-chart');
  if (!canvas) return;

  const counts = MONTH_LABELS.map((_, i) => monthly[year]?.[i + 1] ?? 0);

  if (monthlyChartInst) monthlyChartInst.destroy();
  monthlyChartInst = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: MONTH_LABELS,
      datasets: [{
        label: String(year),
        data: counts,
        backgroundColor: '#f59e0b99',
        borderColor: '#f59e0b',
        borderWidth: 1,
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: '#292524' }, ticks: { color: '#a8a29e' } },
        y: {
          grid: { color: '#292524' },
          ticks: { color: '#a8a29e', stepSize: 1, precision: 0 },
          beginAtZero: true,
        },
      },
    },
  });
}

function drawPieChart(categories) {
  const canvas = document.getElementById('pie-chart');
  if (!canvas) return;

  // Sort by count desc, show top 10 + "Other"
  const sorted = Object.entries(categories).sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, 10);
  const otherSum = sorted.slice(10).reduce((acc, [, v]) => acc + v, 0);
  if (otherSum > 0) top.push(['Other', otherSum]);

  const labels = top.map(([k]) => k);
  const data   = top.map(([, v]) => v);
  const colors = labels.map((_, i) => PALETTE[i % PALETTE.length]);

  if (pieChartInst) pieChartInst.destroy();
  pieChartInst = new Chart(canvas, {
    type: 'pie',
    data: {
      labels,
      datasets: [{ data, backgroundColor: colors, borderColor: '#1c1917', borderWidth: 2 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: { color: '#a8a29e', boxWidth: 12, font: { size: 11 } },
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
    <div class="bg-stone-800 rounded-xl p-4 text-center ring-1 ring-white/5">
      <div class="font-serif text-3xl font-bold text-amber-400">${value}</div>
      <div class="text-xs text-stone-400 mt-1 uppercase tracking-wider">${label}</div>
    </div>`;
}
