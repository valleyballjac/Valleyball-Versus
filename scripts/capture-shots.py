import sys
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8877/index.html"
W, H = 1280, 720

# Drive the whole clock from outside the page: rAF, performance.now and Date.now
# all advance exactly 1000/60 ms per stepped frame. Tick and frame then go 1:1,
# so injected input is a pure function of the tick.
DRIVER = """
window.__q = [];
window.__t = 0;
window.__realNow = performance.now.bind(performance);
performance.now = function () { return window.__t; };
Date.now = function () { return 1767225600000 + window.__t; };
window.requestAnimationFrame = function (cb) { window.__q.push(cb); return window.__q.length; };
window.cancelAnimationFrame = function () {};
window.__step = function (n) {
  for (let i = 0; i < n; i++) {
    const q = window.__q; window.__q = [];
    window.__t += 1000 / 60;
    for (const cb of q) { try { cb(window.__t); } catch (e) { window.__err = String(e); } }
  }
  return { t: Math.round(window.__t), queued: window.__q.length, err: window.__err || null };
};
"""

HIDE = """() => {
  let s = document.getElementById('cap-hide');
  if (!s) { s = document.createElement('style'); s.id = 'cap-hide'; document.head.appendChild(s); }
  s.textContent = '#hud,#controls-card,#splitscreen-divider{opacity:0!important;visibility:hidden!important}';
}"""


def step(pg, n):
    return pg.evaluate("(n) => window.__step(n)", n)


def hud(pg):
    return pg.evaluate("""() => ({
      tick:(document.getElementById('hud-tick')||{}).textContent,
      speed:(document.getElementById('hud-speed')||{}).textContent,
      cam:(document.getElementById('hud-cammode')||{}).textContent,
      ball:(document.getElementById('hud-ball')||{}).textContent,
    })""")


def js_click(pg, text):
    ok = pg.evaluate("""(t) => {
      const T = t.toUpperCase();
      const btns = Array.from(document.querySelectorAll('button'))
        .filter(e => e.offsetParent !== null && !e.disabled);
      const el = btns.find(e => (e.textContent||'').trim().toUpperCase() === T)
              || btns.find(e => (e.textContent||'').trim().toUpperCase().startsWith(T))
              || btns.find(e => (e.textContent||'').trim().toUpperCase().includes(T));
      if (el) { el.click(); return (el.id||'?') + ' | ' + el.textContent.trim().slice(0,30); }
      return null;
    }""", text)
    print("  click:", text, "->", ok); sys.stdout.flush()
    return ok


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=[
        "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader",
        "--enable-webgl", "--no-sandbox",
        "--disable-renderer-backgrounding", "--disable-background-timer-throttling"])
    ctx = b.new_context(viewport={"width": W, "height": H}, device_scale_factor=1)
    ctx.add_init_script(DRIVER)
    pg = ctx.new_page()
    pg.set_default_timeout(120000)
    pg.goto(URL, wait_until="load", timeout=120000)
    pg.wait_for_timeout(14000)
    print("boot step:", step(pg, 40)); sys.stdout.flush()

    js_click(pg, "PRACTICE SANDBOX")
    pg.wait_for_timeout(3500); step(pg, 20)
    js_click(pg, "REGULATION (MEDIUM)")
    pg.wait_for_timeout(600)
    js_click(pg, "START PRACTICE DRILL")
    pg.wait_for_timeout(4500)

    pg.evaluate(HIDE)
    print("post-start:", step(pg, 120), hud(pg)); sys.stdout.flush()

    def shot(name, note=""):
        pg.evaluate(HIDE)
        pg.screenshot(path=name, timeout=120000)
        print("  ->", name, note, hud(pg)); sys.stdout.flush()

    step(pg, 90)
    shot("c1_chase.png", "settled")

    # sprint at the ball
    pg.keyboard.down("w")
    step(pg, 40)
    pg.keyboard.down("Shift")
    step(pg, 45)
    shot("c2_sprint.png", "sprinting")
    pg.keyboard.up("Shift"); pg.keyboard.up("w")

    # jump then power spike near apex
    step(pg, 8)
    pg.keyboard.press(" ")
    step(pg, 13)
    pg.keyboard.press("r")
    step(pg, 5)
    shot("c3_spike.png", "spike contact")
    step(pg, 26)
    shot("c4_after.png", "follow-through")

    # dive
    step(pg, 45)
    pg.keyboard.down("w"); step(pg, 35)
    pg.keyboard.press("q"); pg.keyboard.up("w")
    step(pg, 11)
    shot("c5_dive.png", "dive")
    step(pg, 24)
    shot("c6_dive_land.png", "dive landing")

    # camera variants
    step(pg, 100)
    for nm in ["c7_cam2.png", "c8_cam3.png", "c9_cam4.png"]:
        pg.keyboard.press("Tab")
        step(pg, 50)
        shot(nm, "camera")

    b.close()
