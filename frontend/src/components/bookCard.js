import { starRatingHTML } from './starRating.js';

export function bookCardHTML(book, { showStatus = false, searchMode = false } = {}) {
  const coverImg = book.cover_url
    ? `<img src="${book.cover_url}" alt="${escHtml(book.title)}" class="w-full h-full object-cover" loading="lazy" />`
    : `<div class="cover-placeholder w-full h-full font-serif text-xs">${escHtml(book.title)}</div>`;

  const authors = Array.isArray(book.authors) ? book.authors.join(', ') : (book.authors ?? '');

  const rating = book.rating
    ? `<div class="flex gap-0.5 mt-1">${starRatingHTML(book.rating)}</div>`
    : '';

  const statusBadge = showStatus
    ? `<span class="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm font-medium
        ${book.status === 'reading' ? 'bg-amber-500/20 text-amber-400' : book.status === 'done' ? 'bg-green-500/20 text-green-400' : 'bg-stone-700 text-stone-400'}">
        ${book.status === 'to_read' ? 'To Read' : book.status === 'reading' ? 'Reading' : 'Done'}
       </span>`
    : '';

  const addButtons = searchMode
    ? `<div class="flex gap-1 mt-2 flex-wrap" data-google-id="${escHtml(book.googleId ?? '')}">
        <button class="add-btn text-[11px] px-2 py-1 rounded bg-stone-700 hover:bg-amber-500 hover:text-stone-950 transition-colors" data-status="to_read">+ To Read</button>
        <button class="add-btn text-[11px] px-2 py-1 rounded bg-stone-700 hover:bg-amber-500 hover:text-stone-950 transition-colors" data-status="reading">+ Reading</button>
        <button class="add-btn text-[11px] px-2 py-1 rounded bg-stone-700 hover:bg-amber-500 hover:text-stone-950 transition-colors" data-status="done">+ Done</button>
       </div>`
    : '';

  return `
    <article class="book-card group relative flex flex-col cursor-pointer"
             data-book-id="${book.book_id ?? ''}"
             data-lib-id="${book.id ?? ''}"
             data-google-id="${escHtml(book.googleId ?? '')}">
      <div class="relative w-full aspect-[2/3] rounded overflow-hidden bg-stone-800 shadow-lg
                  ring-1 ring-white/5 group-hover:ring-amber-500/40 transition-all">
        ${coverImg}
        <div class="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
      </div>
      <div class="mt-2 flex-1 flex flex-col">
        <h3 class="font-serif text-sm font-semibold leading-tight line-clamp-2 group-hover:text-amber-400 transition-colors">${escHtml(book.title)}</h3>
        ${authors ? `<p class="text-xs text-stone-400 mt-0.5 line-clamp-1">${escHtml(authors)}</p>` : ''}
        ${rating}
        ${statusBadge}
        ${addButtons}
      </div>
    </article>`;
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
