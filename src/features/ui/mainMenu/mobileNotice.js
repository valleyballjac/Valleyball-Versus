/**
 * Mobile / touch device detection notice.
 */
let mobileNoticeEl = null;

export function initMobileNotice() {
  if (typeof window === 'undefined') return;
  if (sessionStorage.getItem('vy_mobile_notice_dismissed')) return;

  const isTouchOrMobile = (
    ('ontouchstart' in window) ||
    (navigator.maxTouchPoints > 0) ||
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    window.innerWidth < 768
  );

  if (!isTouchOrMobile) return;

  mobileNoticeEl = document.createElement('div');
  mobileNoticeEl.id = 'vy-mobile-notice';
  mobileNoticeEl.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 99999;
    background: linear-gradient(90deg, rgba(30, 58, 138, 0.96) 0%, rgba(15, 23, 42, 0.96) 100%);
    border-bottom: 2px solid rgba(59, 130, 246, 0.5);
    color: #e2e8f0;
    padding: 10px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.6);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 13px;
    line-height: 1.4;
  `;

  mobileNoticeEl.innerHTML = `
    <div style="display: flex; align-items: center; gap: 10px;">
      <span style="font-size: 18px;">📱</span>
      <span>
        <strong>Mobile / Touch Device Detected:</strong> Valleyball Versus is optimized for desktop browsers with 1–2 gamepads or keyboard. Touch controls are currently not supported.
      </span>
    </div>
    <button id="vy-mobile-dismiss" style="
      background: rgba(255, 255, 255, 0.12);
      border: 1px solid rgba(255, 255, 255, 0.25);
      color: #ffffff;
      padding: 4px 10px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 700;
      cursor: pointer;
      margin-left: 12px;
      white-space: nowrap;
    ">DISMISS ✕</button>
  `;

  document.body.appendChild(mobileNoticeEl);

  const dismissBtn = mobileNoticeEl.querySelector('#vy-mobile-dismiss');
  if (dismissBtn) {
    dismissBtn.onclick = () => {
      sessionStorage.setItem('vy_mobile_notice_dismissed', '1');
      mobileNoticeEl.remove();
      mobileNoticeEl = null;
    };
  }
}
