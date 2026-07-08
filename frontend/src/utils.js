export function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Small pill identifying which metadata source a search result came from
export function sourceBadgeHTML(source) {
  if (source === 'google')
    return `<span class="text-[9px] uppercase tracking-wider bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/20 px-1.5 py-0.5 rounded-full whitespace-nowrap">Google</span>`;
  if (source === 'openlibrary')
    return `<span class="text-[9px] uppercase tracking-wider bg-teal-500/15 text-teal-300 ring-1 ring-teal-500/20 px-1.5 py-0.5 rounded-full whitespace-nowrap">Open Library</span>`;
  return '';
}
