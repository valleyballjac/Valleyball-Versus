import sys
from playwright.sync_api import sync_playwright
exec(open('capture.py').read().split('with sync_playwright()')[0])

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=[
        "--enable-unsafe-swiftshader","--use-gl=angle","--use-angle=swiftshader",
        "--enable-webgl","--no-sandbox","--disable-renderer-backgrounding"])
    ctx = b.new_context(viewport={"width":1280,"height":720}, device_scale_factor=1)
    ctx.add_init_script(DRIVER)
    pg = ctx.new_page(); pg.set_default_timeout(120000)
    pg.goto(URL, wait_until="load", timeout=120000)
    pg.wait_for_timeout(14000); step(pg, 40)

    js_click(pg, "PLAY MATCH (1v1 VERSUS)"); pg.wait_for_timeout(3200); step(pg, 20)
    for lbl in ["READY UP (P1)","READY UP (P2)"]:
        js_click(pg, lbl); pg.wait_for_timeout(800)
    js_click(pg, "START MATCH"); pg.wait_for_timeout(4000)
    step(pg, 40)

    # skip the aerial intro sweep
    for _ in range(4):
        pg.keyboard.press(" "); step(pg, 25)
    step(pg, 120)
    pg.evaluate(HIDE)

    def shot(n, note=""):
        pg.evaluate(HIDE); pg.screenshot(path=n, timeout=120000)
        print("  ->", n, note); sys.stdout.flush()

    shot("n1_live.png", "live single-cam")
    pg.keyboard.press("v"); step(pg, 45)
    shot("n2_split.png", "splitscreen")

    pg.keyboard.down("w"); pg.keyboard.down("i"); step(pg, 60)
    shot("n3_split_run.png", "both moving")
    pg.keyboard.down("Shift"); step(pg, 50)
    shot("n4_split_sprint.png", "sprint")
    pg.keyboard.up("Shift"); pg.keyboard.up("w"); pg.keyboard.up("i")
    step(pg, 16); pg.keyboard.press(" "); step(pg, 12); pg.keyboard.press("r"); step(pg, 6)
    shot("n5_split_spike.png", "spike")
    b.close()
