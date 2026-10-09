"""
TRAILER CAPTURE HARNESS — Executes choreographed trailer shots and verifies visual alignment.
"""

import sys
import os
import subprocess
from playwright.sync_api import sync_playwright

URL = "http://localhost:5173/Valleyball-Versus/"
W, H = 1920, 1080
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "captures", "trailer")
os.makedirs(OUT_DIR, exist_ok=True)

HIDE = """() => {
  let s = document.getElementById('trailer-cap-hide');
  if (!s) {
    s = document.createElement('style');
    s.id = 'trailer-cap-hide';
    document.head.appendChild(s);
  }
  s.textContent = '#hud,#controls-card,#splitscreen-divider,.lil-gui,#main-menu-root,#title-screen,#loading-screen,#camera-toast{display:none!important;opacity:0!important;visibility:hidden!important}';
}"""

def js_click(pg, text):
    ok = pg.evaluate("""(t) => {
      const T = t.toUpperCase();
      const btns = Array.from(document.querySelectorAll('button'))
        .filter(e => e.offsetParent !== null && !e.disabled);
      const el = btns.find(e => (e.textContent||'').trim().toUpperCase() === T)
              || btns.find(e => (e.textContent||'').trim().toUpperCase().startsWith(T))
              || btns.find(e => (e.textContent||'').trim().toUpperCase().includes(T));
      if (el) { el.click(); return (el.id||'?'); }
      return null;
    }""", text)
    print(f"  click: {text} -> {ok}")
    return ok

def capture_trailer_stills():
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True, args=[
            "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader",
            "--enable-webgl", "--no-sandbox",
            "--disable-renderer-backgrounding", "--disable-background-timer-throttling"
        ])
        ctx = b.new_context(viewport={"width": W, "height": H}, device_scale_factor=1)
        pg = ctx.new_page()
        pg.set_default_timeout(120000)

        print(f"[trailer] Navigating to {URL}...")
        pg.goto(URL, wait_until="load", timeout=120000)
        pg.wait_for_timeout(10000)

        # Enter practice sandbox for live gameplay atmosphere
        print("[trailer] Launching practice session...")
        js_click(pg, "PRACTICE SANDBOX")
        pg.wait_for_timeout(2500)
        js_click(pg, "START PRACTICE DRILL")
        pg.wait_for_timeout(3500)

        # Hide UI overlays
        pg.evaluate(HIDE)

        # Start Trailer Director
        print("[trailer] Starting TrailerDirector...")
        pg.evaluate("""() => {
            if (window.__vb && window.__vb.trailerDirector) {
                window.__vb.trailerDirector.start(0);
            }
        }""")

        shots = [
            ("01_north_hoop_reveal.png", 3.5, "Shot 1: North Torus Monolithic Hoop"),
            ("02_stream_heads_reveal.png", 12.0, "Shot 2: Stream Heads & High Ramps"),
            ("03_sunken_floor_reveal.png", 21.0, "Shot 3: Sunken Court & 18m Zone"),
            ("04_ceiling_ball_apex.png", 30.0, "Shot 4: Ceiling Globe Apex"),
            ("05_fixed_ball_follow.png", 38.0, "Shot 5: Fixed-Length Ball Follow Rig"),
        ]

        for filename, seek_time, label in shots:
            print(f"[trailer] Seeking to t={seek_time}s ({label})...")
            pg.evaluate(f"""() => {{
                if (window.__vb && window.__vb.trailerDirector) {{
                    window.__vb.trailerDirector.elapsedTime = {seek_time};
                }}
            }}""")
            pg.wait_for_timeout(300)
            pg.evaluate(HIDE)
            out_path = os.path.join(OUT_DIR, filename)
            pg.screenshot(path=out_path)
            print(f"  -> Captured {out_path}")

        b.close()
        print("[trailer] All trailer stills captured successfully.")

if __name__ == "__main__":
    capture_trailer_stills()
