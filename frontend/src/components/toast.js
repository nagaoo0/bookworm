let _container = null;

function getContainer() {
  if (!_container || !document.body.contains(_container)) {
    _container = document.createElement('div');
    _container.id = 'toast-container';
    _container.style.cssText = [
      'position:fixed',
      'bottom:1.5rem',
      'left:50%',
      'transform:translateX(-50%)',
      'z-index:9999',
      'display:flex',
      'flex-direction:column-reverse',
      'gap:0.5rem',
      'align-items:center',
      'pointer-events:none',
    ].join(';');
    document.body.appendChild(_container);
  }
  return _container;
}

const ICONS = {
  success: `<svg style="width:15px;height:15px;flex-shrink:0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>`,
  error:   `<svg style="width:15px;height:15px;flex-shrink:0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>`,
  info:    `<svg style="width:15px;height:15px;flex-shrink:0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01"/><circle cx="12" cy="12" r="10"/></svg>`,
};

export function showToast(message, type = 'success') {
  const el = document.createElement('div');
  el.className = 'toast-item';

  const colors = {
    success: { bg: 'rgba(20,18,16,0.9)', border: 'rgba(245,158,11,0.3)', color: '#e7e5e4', icon: '#f59e0b' },
    error:   { bg: 'rgba(20,8,8,0.92)',  border: 'rgba(239,68,68,0.4)',  color: '#fecaca', icon: '#f87171' },
    info:    { bg: 'rgba(15,18,28,0.92)', border: 'rgba(96,165,250,0.3)', color: '#bfdbfe', icon: '#60a5fa' },
  };
  const c = colors[type] ?? colors.success;
  const icon = ICONS[type] ?? ICONS.success;

  el.style.cssText = [
    `background:${c.bg}`,
    `border:1px solid ${c.border}`,
    `color:${c.color}`,
    'padding:0.55rem 1rem 0.55rem 0.75rem',
    'border-radius:0.75rem',
    'font-size:0.875rem',
    'max-width:340px',
    'pointer-events:auto',
    'box-shadow:0 8px 32px rgba(0,0,0,0.4),0 1px 0 rgba(255,255,255,0.04) inset',
    'opacity:0',
    'transform:translateY(12px) scale(0.96)',
    'transition:opacity 0.22s cubic-bezier(0.22,1,0.36,1),transform 0.22s cubic-bezier(0.22,1,0.36,1)',
    'display:flex',
    'align-items:center',
    'gap:0.5rem',
    'cursor:pointer',
    'user-select:none',
  ].join(';');

  el.innerHTML = `<span style="color:${c.icon};display:flex">${icon}</span><span>${escHtml(message)}</span>`;
  el.addEventListener('click', () => dismiss(el));

  getContainer().appendChild(el);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.style.opacity = '1';
      el.style.transform = 'translateY(0) scale(1)';
    });
  });

  const timer = setTimeout(() => dismiss(el), 3500);
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', () => setTimeout(() => dismiss(el), 1500));
}

function dismiss(el) {
  if (el._dismissed) return;
  el._dismissed = true;
  el.style.opacity = '0';
  el.style.transform = 'translateY(8px) scale(0.95)';
  setTimeout(() => el.remove(), 220);
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
