/**
 * Toast Notification HUD System and Mobile Notice Banner
 */

let toastContainerEl = null;

function ensureToastContainer() {
  if (toastContainerEl && document.body.contains(toastContainerEl)) return toastContainerEl;
  toastContainerEl = document.createElement('div');
  toastContainerEl.id = 'vy-toast-container';
  toastContainerEl.style.cssText = `
    position: fixed;
    top: 24px;
    right: 24px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    z-index: 100000;
    pointer-events: none;
    max-width: 400px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  `;
  document.body.appendChild(toastContainerEl);
  return toastContainerEl;
}

export function showToast(message, type = 'info', duration = 3500) {
  if (typeof document === 'undefined') return;
  const container = ensureToastContainer();
  const toast = document.createElement('div');

  const borderColor = type === 'warning' ? 'rgba(245, 158, 11, 0.7)' : (type === 'error' ? 'rgba(239, 68, 68, 0.7)' : 'rgba(59, 130, 246, 0.7)');
  const bgColor = type === 'warning' ? 'rgba(30, 25, 15, 0.94)' : (type === 'error' ? 'rgba(30, 15, 15, 0.94)' : 'rgba(15, 23, 42, 0.94)');
  const textColor = type === 'warning' ? '#fde68a' : (type === 'error' ? '#fca5a5' : '#e2e8f0');

  toast.style.cssText = `
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 18px;
    background: ${bgColor};
    color: ${textColor};
    border: 1px solid ${borderColor};
    border-radius: 8px;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5), 0 0 15px rgba(59, 130, 246, 0.2);
    backdrop-filter: blur(10px);
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.3px;
    transform: translateX(100%);
    opacity: 0;
    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    pointer-events: auto;
  `;
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.transform = 'translateX(0)';
    toast.style.opacity = '1';
  });

  setTimeout(() => {
    toast.style.transform = 'translateX(100%)';
    toast.style.opacity = '0';
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 320);
  }, duration);
}

