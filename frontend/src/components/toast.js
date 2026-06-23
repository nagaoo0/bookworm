let _container = null;

function getContainer() {
  if (!_container || !document.body.contains(_container)) {
    _container = document.createElement('div');
    _container.id = 'toast-container';
    _container.style.cssText = 'position:fixed;bottom:1.25rem;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;gap:0.5rem;align-items:center;pointer-events:none';
    document.body.appendChild(_container);
  }
  return _container;
}

export function showToast(message, type = 'success') {
  const el = document.createElement('div');
  const bg = type === 'error' ? '#450a0a' : '#1c1917';
  const border = type === 'error' ? '#7f1d1d' : '#44403c';
  const color = type === 'error' ? '#fca5a5' : '#e7e5e4';
  el.style.cssText = `background:${bg};border:1px solid ${border};color:${color};padding:0.6rem 1rem;border-radius:0.75rem;font-size:0.875rem;max-width:320px;text-align:center;pointer-events:auto;box-shadow:0 4px 20px rgba(0,0,0,0.5);opacity:0;transform:translateY(8px);transition:opacity 0.2s,transform 0.2s`;
  el.textContent = message;
  getContainer().appendChild(el);
  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translateY(0)';
  });
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';
    setTimeout(() => el.remove(), 200);
  }, 3000);
}
