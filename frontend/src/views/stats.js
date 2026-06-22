import { api } from '../api.js';

export async function renderStats(container) {
  container.innerHTML = `<p class="text-stone-400 text-center py-20">Loading stats…</p>`;
  try {
    const s = await api.getStats();
    const years = Object.entries(s.perYear).sort((a, b) => b[0] - a[0]);
    const maxCount = Math.max(...years.map(([, v]) => v), 1);

    container.innerHTML = `
      <div class="max-w-2xl mx-auto space-y-8 fade-in">

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
          ${statCard('Books Read', s.totalBooks, '📚')}
          ${statCard('Read-throughs', s.totalSessions, '🔁')}
          ${statCard('Reading Now', s.currentlyReading, '📖')}
          ${statCard('Avg Rating', s.avgRating ? s.avgRating.toFixed(1) + ' ★' : '—', '⭐')}
        </div>

        ${years.length ? `
        <section>
          <h2 class="font-serif text-xl font-semibold mb-4">Books Finished Per Year</h2>
          <div class="space-y-2">
            ${years.map(([year, count]) => `
              <div class="flex items-center gap-3">
                <span class="text-sm text-stone-400 w-10 flex-shrink-0">${year}</span>
                <div class="flex-1 bg-stone-800 rounded-full h-5 overflow-hidden">
                  <div class="h-full bg-amber-500 rounded-full transition-all duration-500"
                       style="width: ${(count / maxCount * 100).toFixed(1)}%"></div>
                </div>
                <span class="text-sm font-semibold text-stone-300 w-6 text-right">${count}</span>
              </div>`).join('')}
          </div>
        </section>` : `
        <p class="text-stone-500 text-center italic py-8">Finish some books to see stats here!</p>`}
      </div>`;
  } catch (err) {
    container.innerHTML = `<p class="text-red-400 text-center py-20">${err.message}</p>`;
  }
}

function statCard(label, value, icon) {
  return `
    <div class="bg-stone-800 rounded-xl p-4 text-center ring-1 ring-white/5">
      <div class="text-2xl mb-1">${icon}</div>
      <div class="font-serif text-3xl font-bold text-amber-400">${value}</div>
      <div class="text-xs text-stone-400 mt-1 uppercase tracking-wider">${label}</div>
    </div>`;
}
