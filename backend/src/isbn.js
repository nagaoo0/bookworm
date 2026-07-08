// Shared ISBN helpers for the book metadata providers.

// Strip dashes/spaces, uppercase the ISBN-10 check digit
export function normalizeIsbn(raw) {
  const s = String(raw ?? '').replace(/[^0-9Xx]/g, '').toUpperCase();
  return s.length === 10 || s.length === 13 ? s : null;
}

export function isValidIsbn13(isbn) {
  if (!/^97[89]\d{10}$/.test(isbn ?? '')) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += (i % 2 ? 3 : 1) * Number(isbn[i]);
  return sum % 10 === 0;
}

export function isValidIsbn10(isbn) {
  if (!/^\d{9}[\dX]$/.test(isbn ?? '')) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += (10 - i) * (isbn[i] === 'X' ? 10 : Number(isbn[i]));
  return sum % 11 === 0;
}

// Pick the first valid ISBN-13 and ISBN-10 out of a candidate list
export function pickIsbns(candidates) {
  let isbn13 = null;
  let isbn10 = null;
  for (const raw of candidates ?? []) {
    const s = normalizeIsbn(raw);
    if (!s) continue;
    if (!isbn13 && isValidIsbn13(s)) isbn13 = s;
    else if (!isbn10 && isValidIsbn10(s)) isbn10 = s;
    if (isbn13 && isbn10) break;
  }
  return { isbn13, isbn10 };
}
