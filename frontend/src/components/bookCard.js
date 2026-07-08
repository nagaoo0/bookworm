import { starRatingHTML } from './starRating.js';
import { escHtml, sourceBadgeHTML, coverProxySrc } from '../utils.js';

export function bookCardHTML(book, { showStatus = false, searchMode = false, isReading = false, readOnly = false, alsoRead = false } = {}) {
  const coverSrc = coverProxySrc(
    book.cover_url ?? book.coverUrl ?? null,
    book.book_id ?? (searchMode ? null : book.id)
  );
  const coverImg = coverSrc
    ? `<img src="${coverSrc}" alt="${escHtml(book.title)}" class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" loading="lazy" />`
    : `<div class="cover-placeholder w-full h-full font-serif text-xs">${escHtml(book.title)}</div>`;

  const authors = Array.isArray(book.authors) ? book.authors.join(', ') : (book.authors ?? '');

  const rating = book.rating
    ? `<div class="flex gap-0.5 mt-1.5">${starRatingHTML(book.rating)}</div>`
    : '';

  const statusBadge = showStatus
    ? `<span class="inline-flex items-center text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full font-semibold mt-1
        ${book.status === 'reading' ? 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30'
          : book.status === 'done'  ? 'bg-green-500/15 text-green-400 ring-1 ring-green-500/30'
          : 'bg-surface-2/60 text-muted ring-1 ring-border/40'}">
        ${book.status === 'to_read' ? 'To Read' : book.status === 'reading' ? 'Reading' : 'Done'}
       </span>`
    : '';

  const addButtons = searchMode
    ? `<div class="add-area mt-2 space-y-1.5"></div>`
    : '';

  const removeBtn = !searchMode && !readOnly
    ? `<button class="remove-card-btn absolute top-1.5 right-1.5 z-10
                      w-6 h-6 rounded-full bg-black/70 backdrop-blur-sm text-white text-xs
                      opacity-0 group-hover:opacity-100 transition-all duration-150
                      flex items-center justify-center hover:bg-red-600 hover:scale-110"
               title="Remove from library">✕</button>
       <button class="card-menu-btn absolute bottom-1.5 right-1.5 z-10
                      w-6 h-6 rounded-full bg-black/60 backdrop-blur-sm text-white text-xs
                      opacity-0 group-hover:opacity-100 transition-all duration-150
                      flex items-center justify-center hover:bg-stone-600 hover:scale-110"
               title="More options">⋯</button>`
    : '';

  const finishBtn = isReading && !readOnly
    ? `<button class="finish-reading-btn absolute top-1.5 left-1.5 z-10
                      w-6 h-6 rounded-full bg-green-700/80 backdrop-blur-sm text-white text-xs
                      opacity-0 group-hover:opacity-100 transition-all duration-150
                      flex items-center justify-center hover:bg-green-500 hover:scale-110"
               title="Mark as finished">✓</button>`
    : '';

  const pct = book.progress_pct ?? null;
  const progressBar = (isReading && pct !== null && !readOnly)
    ? `<div class="absolute bottom-0 left-0 right-0 h-1 bg-black/40">
         <div class="h-1 bg-amber-400 progress-fill" style="width:${pct}%"></div>
       </div>`
    : '';

  const absAvail = (book.availability ?? []).find(a => a.service === 'audiobookshelf');
  const absDurationMins = absAvail?.extra?.duration_minutes ?? null;
  const absPct = absAvail?.extra?.progress_pct ?? null;
  const remainingMins = (isReading && absDurationMins && absPct !== null && absPct < 100)
    ? Math.round(absDurationMins * (1 - absPct / 100)) : null;
  const remainingEta = remainingMins
    ? (remainingMins >= 60 ? `${Math.floor(remainingMins / 60)}h ${remainingMins % 60}m left` : `${remainingMins}m left`)
    : null;

  const alsoReadBadge = alsoRead
    ? `<div class="absolute top-1.5 left-1.5 text-[9px] bg-amber-500/90 text-stone-950 font-bold px-1.5 py-0.5 rounded-full leading-tight backdrop-blur-sm">✓ You read this</div>`
    : '';

  const availability = book.availability ?? [];
  const availabilityBadges = availability.length
    ? `<div class="flex flex-wrap gap-1 mt-1.5">
        ${availability.map(a => {
          if (a.service === 'audiobookshelf') return `<span title="In Audiobookshelf" class="text-[10px] bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/20 px-1 py-0.5 rounded-full">🎧 ABS</span>`;
          if (a.service === 'calibre') {
            const fmts = (a.formats ?? []).map(f => f.toUpperCase()).join(' · ');
            return `<span title="In Calibre library${fmts ? ': ' + fmts : ''}" class="text-[10px] bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/20 px-1 py-0.5 rounded-full">📚${fmts ? ' ' + fmts : ''}</span>`;
          }
          return '';
        }).join('')}
      </div>`
    : '';

  return `
    <article class="book-card group relative flex flex-col ${readOnly ? 'cursor-default' : 'cursor-pointer'}"
             data-book-id="${book.book_id ?? ''}"
             data-lib-id="${book.id ?? ''}"
             data-google-id="${escHtml(book.googleId ?? '')}"
             data-open-library-id="${escHtml(book.openLibraryId ?? '')}"
             data-apple-id="${escHtml(book.appleId ?? '')}"
             data-notes="${escHtml(book.notes ?? '')}"
             data-progress-pct="${pct ?? ''}">
      <div class="relative w-full aspect-[2/3] rounded-lg overflow-hidden bg-surface-2
                  shadow-md group-hover:shadow-xl group-hover:shadow-black/40
                  ring-1 ring-border/20 group-hover:ring-amber-500/40
                  transition-all duration-300">
        ${coverImg}
        <div class="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
        ${finishBtn}
        ${removeBtn}
        ${progressBar}
        ${alsoReadBadge}
      </div>
      <div class="mt-2 flex-1 flex flex-col">
        ${(book.book_id || book.id) && !searchMode
          ? `<a href="#book/${book.book_id ?? book.id}" class="font-serif text-sm font-semibold leading-tight line-clamp-2 group-hover:text-amber-400 transition-colors duration-150" onclick="event.stopPropagation()"><h3>${escHtml(book.title)}</h3></a>`
          : `<h3 class="font-serif text-sm font-semibold leading-tight line-clamp-2 group-hover:text-amber-400 transition-colors duration-150">${escHtml(book.title)}</h3>`
        }
        ${authors ? `<p class="text-xs text-muted mt-0.5 line-clamp-1">${escHtml(authors)}</p>` : ''}
        ${searchMode && book.source ? `<div class="mt-1">${sourceBadgeHTML(book.source)}</div>` : ''}
        ${rating}
        ${statusBadge}
        ${availabilityBadges}
        ${remainingEta ? `<p class="text-[10px] text-blue-300/80 mt-1">⏱ ${remainingEta}</p>` : ''}
        ${addButtons}
      </div>
    </article>`;
}

