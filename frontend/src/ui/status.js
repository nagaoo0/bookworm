// Single source of truth for reading-status keys, labels, icons and colour classes
// (design-system §2.5). Never spell a status label anywhere else.
// Status colours are fixed per theme and do NOT follow the accent.

export const STATUS = {
  to_read: { key: 'to_read', label: 'To read',  cls: 'status-to-read', icon: 'bookmark',       text: 'text-status-to-read', bg: 'bg-status-to-read-soft', color: 'var(--status-to-read-fg)' },
  reading: { key: 'reading', label: 'Reading',  cls: 'status-reading', icon: 'book-open',      text: 'text-status-reading', bg: 'bg-status-reading-soft', color: 'var(--status-reading-fg)' },
  done:    { key: 'done',    label: 'Finished', cls: 'status-done',    icon: 'check-circle-2', text: 'text-status-done',    bg: 'bg-status-done-soft',    color: 'var(--status-done-fg)' },
};

/** Display order wherever statuses are listed together (Library "All", filters, pickers). */
export const STATUS_ORDER = ['reading', 'to_read', 'done'];

export const isStatus = (key) => Object.prototype.hasOwnProperty.call(STATUS, key);

/** Meta for a status key; unknown/missing keys fall back to `to_read`. */
export function statusMeta(key) { return STATUS[key] ?? STATUS.to_read; }

export function statusLabel(key) { return statusMeta(key).label; }
