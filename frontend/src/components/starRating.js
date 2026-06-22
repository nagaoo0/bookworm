// Returns an HTML string for a 1-5 star rating display/input
// If onChange is provided, renders interactive buttons; otherwise static display.
export function starRatingHTML(value, { interactive = false, name = 'rating' } = {}) {
  return Array.from({ length: 5 }, (_, i) => {
    const n = i + 1;
    const filled = value >= n ? 'filled' : 'empty';
    if (interactive) {
      return `<button type="button" class="star-btn ${filled} text-xl" data-star="${n}" aria-label="${n} star${n > 1 ? 's' : ''}">★</button>`;
    }
    return `<span class="star-btn ${filled} text-lg">★</span>`;
  }).join('');
}

// Attach interactive star-click handlers to a container element
export function attachStarHandlers(container, onChange) {
  container.querySelectorAll('[data-star]').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = Number(btn.dataset.star);
      onChange(val);
      // Re-render stars in-place
      container.querySelectorAll('[data-star]').forEach(b => {
        b.classList.toggle('filled', Number(b.dataset.star) <= val);
        b.classList.toggle('empty', Number(b.dataset.star) > val);
      });
    });
  });
}
