/**
 * Requirement-driven opaque-box E2E test suite across Tiers 1 to 4
 * covering Features 2 through 18 for Valleyball Versus v0.4.2.2.
 */

import {
  assert,
  buildAppUrl,
  captureScreenshot,
  driveMatchToVictory,
  padConnect,
  padDisconnect,
  padPress,
  padSetAxes,
  padSetButtons,
  padSwap,
  padWake,
  runStep,
  skipFlyover,
  waitForBoot,
  waitForCountdownDone,
  waitForGameState,
  waitForTicks,
  withIsolatedScenario,
} from './harness.mjs';

const HUD_PREFS_KEY = 'valleyball_hud_prefs_v1';

async function openPlayMatchAssignment(page, format = '1v1') {
  const selector = format === '2v2' ? '#btn-play-match-2v2' : '#btn-play-match';
  await page.locator(selector).click();
  await page.waitForFunction(() => {
    const el = document.getElementById('controller-assignment-screen');
    return el && getComputedStyle(el).display === 'flex';
  });
}

async function openPracticeSetup(page) {
  await page.locator('#btn-practice-sandbox').click();
  await page.waitForFunction(() => {
    const el = document.getElementById('player-setup-screen');
    return el && getComputedStyle(el).display === 'flex';
  });
}

async function openTitleSettings(page) {
  await page.locator('#btn-title-settings').click();
  await page.waitForFunction(() => {
    const el = document.getElementById('main-menu-settings-modal');
    return el && getComputedStyle(el).display === 'flex';
  });
}

async function closeTitleSettings(page) {
  await page.locator('#btn-close-main-menu-settings').click();
  await page.waitForFunction(() => {
    const el = document.getElementById('main-menu-settings-modal');
    return !el || getComputedStyle(el).display === 'none';
  });
}

async function proceedToSetupPage1(page) {
  await page.locator('#assignment-btn-proceed').click();
  await page.waitForFunction(() => {
    const el = document.getElementById('player-setup-screen');
    return el && getComputedStyle(el).display === 'flex';
  });
}

async function advanceSetupToPage2(page) {
  await page.locator('#btn-setup-next').click();
  await page.waitForFunction(() => {
    const el = document.getElementById('match-rules-box');
    return el && getComputedStyle(el).display === 'flex';
  });
}

async function quickStartFromAssignment(page) {
  await page.locator('#assignment-btn-quick-start').click();
  await page.waitForFunction(() => {
    const gs = window.__vb?.getGameState?.();
    return gs === 'flyover' || gs === 'match';
  });
}

function makeScenarioList(port, outDir) {
  const baseUrl = buildAppUrl(port);

  return [
    // TIER 1: FEATURE COVERAGE (FEATURES 2 TO 18)
    {
      tier: 1,
      id: 'T1.1',
      feature: 'Features 2, 3: Controller drop-in, P1-P4 ownership, Home/Away swap, Solo Away Host',
      async run(browser) {
        await withIsolatedScenario(browser, baseUrl, async ({ page }) => {
          await padConnect(page, 0, { id: 'Xbox Pad 1' });
          await padConnect(page, 1, { id: 'DualSense Pad 2' });
          await openPlayMatchAssignment(page, '1v1');

          const info = await page.evaluate(() => {
            const c1 = document.getElementById('col-team1')?.textContent || '';
            const c2 = document.getElementById('col-team2')?.textContent || '';
            const colBench = document.getElementById('col-bench')?.textContent || '';
            const s0 = document.querySelector('#team1-slots-container [data-slot-idx="0"]')?.textContent || '';
            const s1 = document.querySelector('#team2-slots-container [data-slot-idx="1"]')?.textContent || '';
            return { c1, c2, colBench, s0, s1 };
          });
          assert(info.c1.includes('HOME (SOUTH)'), 'Expected Team 1 header to include HOME (SOUTH)');
          assert(info.c2.includes('AWAY (NORTH)'), 'Expected Team 2 header to include AWAY (NORTH)');
          assert(info.s0.includes('P1') && info.s0.includes('HOST'), 'Expected slot 0 to show P1 and HOST chip');
          assert(info.s1.includes('P2'), 'Expected slot 1 to show P2');
          assert(info.colBench.includes('PRESS A / ANY BUTTON TO JOIN'), 'Expected bench column header to display PRESS A / ANY BUTTON TO JOIN');

          // Toggle 2v2 first while only Pads 0 and 1 are connected so P3 and P4 start empty
          await page.locator('#assignment-btn-toggle').click();
          const badge2v2 = await page.locator('#assignment-mode-badge').textContent();
          assert(badge2v2.includes('2v2'), 'Expected mode badge to switch to 2v2');
          const p3Prompt = await page.locator('[data-slot-idx="2"]').textContent();
          assert(p3Prompt.includes('PRESS A / ANY BUTTON'), 'Expected empty P3 slot to show join prompt');

          // Connect 3rd and 4th pads onto the bench, verify bench join prompt, then seat into P3 and P4
          await padConnect(page, 2, { id: 'Switch Pad 3' });
          await padConnect(page, 3, { id: 'Fighting Pad 4' });
          await page.waitForFunction(() => Boolean(
            document.querySelector('#bench-slots-container [data-pad-index="2"]')
            && document.querySelector('#bench-slots-container [data-pad-index="3"]'),
          ));
          const benchPad2Text = await page.locator('#bench-slots-container [data-pad-index="2"]').textContent();
          const benchPad3Text = await page.locator('#bench-slots-container [data-pad-index="3"]').textContent();
          assert(
            benchPad2Text.includes('PRESS A / ANY BUTTON TO JOIN')
            && benchPad3Text.includes('PRESS A / ANY BUTTON TO JOIN'),
            'Expected gamepad bench cards for Pad 2 and Pad 3 to display PRESS A / ANY BUTTON TO JOIN',
          );

          await padPress(page, 2, 0);
          await padPress(page, 3, 0);
          await page.waitForFunction(() => (
            document.querySelector('[data-slot-idx="2"]')?.getAttribute('data-pad-index') === '2'
            && document.querySelector('[data-slot-idx="3"]')?.getAttribute('data-pad-index') === '3'
          ));
          const p34Text = await page.evaluate(() => ({
            p3: document.querySelector('[data-slot-idx="2"]')?.textContent || '',
            p4: document.querySelector('[data-slot-idx="3"]')?.textContent || '',
          }));
          assert(p34Text.p3.includes('P3') && p34Text.p4.includes('P4'), 'Expected full P1 to P4 ownership in 2v2');

          await padDisconnect(page, 2);
          await padDisconnect(page, 3);
          await page.waitForFunction(() => (
            !document.querySelector('#controller-assignment-screen [data-pad-index="2"]')
            && !document.querySelector('#controller-assignment-screen [data-pad-index="3"]')
          ));
          await page.locator('#assignment-btn-toggle').click();

          // Swap sides button and keyboard shortcut
          const padBefore0 = await page.locator('[data-slot-idx="0"]').getAttribute('data-pad-index');
          const padBefore1 = await page.locator('[data-slot-idx="1"]').getAttribute('data-pad-index');
          await page.locator('#assignment-btn-swap-sides').click();
          const callout = await page.locator('#assignment-live-callout').textContent();
          assert(callout.includes('SWAPPED SIDES'), 'Expected swap sides callout');
          const padAfter0 = await page.locator('[data-slot-idx="0"]').getAttribute('data-pad-index');
          const padAfter1 = await page.locator('[data-slot-idx="1"]').getAttribute('data-pad-index');
          assert(padAfter0 === padBefore1 && padAfter1 === padBefore0, 'Expected Home and Away seats to trade pads');

          await page.keyboard.press('KeyS');
          const padAfterKey = await page.locator('[data-slot-idx="0"]').getAttribute('data-pad-index');
          assert(padAfterKey === padBefore0, 'Expected KeyS to swap sides back');

          // Solo Away Host: unassign P1 so only P2 remains on Away
          await page.locator('[data-slot-idx="0"] [data-action="unassign"]').click();
          const s1Solo = await page.locator('[data-slot-idx="1"]').textContent();
          assert(s1Solo.includes('HOST'), 'Expected P2 to acquire HOST chip as Solo Away Host');

          await proceedToSetupPage1(page);
          await advanceSetupToPage2(page);
          const hint = await page.locator('#match-rules-header-hint').textContent();
          assert(hint.includes('HOST (P2)'), `Expected rules header hint for Solo Away Host (P2), got: ${hint}`);
        });
      },
    },

    {
      tier: 1,
      id: 'T1.2',
      feature: 'Feature 6: P2-P4 keyboard/mouse Ready unblock and gamepad slot guard',
      async run(browser) {
        await withIsolatedScenario(browser, baseUrl, async ({ page }) => {
          await openPlayMatchAssignment(page, '1v1');
          // Seat kb2 into Team 2 (Away)
          await page.locator('#bench-slots-container [data-claim="team2"]').last().click();
          await proceedToSetupPage1(page);
          await advanceSetupToPage2(page);

          const readyTextBefore = await page.locator('#btn-ready-p2').textContent();
          assert(readyTextBefore.includes('ENTER / CLICK READY') || readyTextBefore.includes('CLICK READY'), `Unexpected P2 keyboard ready hint: ${readyTextBefore}`);

          await page.locator('#btn-ready-p2').click();
          const p2ReadyKb = await page.evaluate(() => Boolean(window.playerSetup?.playerReadyState?.[1]));
          assert(p2ReadyKb, 'Expected clicking #btn-ready-p2 to ready up keyboard P2');

          // Unready P2, go back to Assignment, seat Pad 1 on P2, verify mouse click guard
          await page.locator('#btn-ready-p2').click();
          await page.locator('#btn-setup-back').click();
          await page.locator('#btn-setup-back').click();
          await page.waitForFunction(() => {
            const el = document.getElementById('controller-assignment-screen');
            return el && getComputedStyle(el).display === 'flex';
          });
          await padConnect(page, 1, { id: 'Xbox P2 Guard Pad' });
          await page.waitForFunction(() => Boolean(document.querySelector('#bench-slots-container [data-pad-index="1"]')));
          await page.locator('[data-slot-idx="1"] [data-action="unassign"]').click();
          await page.locator('#bench-slots-container [data-pad-index="1"] [data-claim="team2"]').click();
          await page.waitForFunction(() => document.querySelector('[data-slot-idx="1"]')?.getAttribute('data-pad-index') === '1');

          await proceedToSetupPage1(page);
          await advanceSetupToPage2(page);

          await page.locator('#btn-ready-p2').click();
          const p2Blocked = await page.evaluate(() => Boolean(window.playerSetup?.playerReadyState?.[1]));
          assert(!p2Blocked, 'Expected mouse click on gamepad-owned #btn-ready-p2 to be blocked');
          const toastSeen = await page.evaluate(() => document.body.textContent.includes('must Ready Up on their own controller'));
          assert(toastSeen, 'Expected toast reminding P2 to Ready Up on their own controller');

          await padPress(page, 1, 0);
          const p2ReadyPad = await page.evaluate(() => Boolean(window.playerSetup?.playerReadyState?.[1]));
          assert(p2ReadyPad, 'Expected pressing A on Pad 1 to Ready Up P2');
        });
      },
    },

    {
      tier: 1,
      id: 'T1.3',
      feature: 'Features 7, 8, 9: 3-tier HUD presets, localStorage persistence, deterministic override',
      async run(browser) {
        await withIsolatedScenario(browser, baseUrl, async ({ page }) => {
          const initialPrefs = await page.evaluate(() => window.__vb.getHudPrefs());
          assert(initialPrefs.scorebugMode === 'splitscreen', 'Expected Standard default scorebugMode splitscreen');
          assert(initialPrefs.ballDropRing === true, 'Expected Standard default ballDropRing true');
          assert(initialPrefs.orientationCues === true, 'Expected Standard default orientationCues true');
          assert(initialPrefs.strikeRangeGuide === false, 'Expected Standard default strikeRangeGuide false');
          assert(initialPrefs.controlsOverlay === false, 'Expected Standard default controlsOverlay false');

          await openTitleSettings(page);
          const initBadge = await page.locator('#settings-hud-preset-badge').textContent();
          assert(initBadge.trim() === 'Standard', `Expected Standard preset badge, got ${initBadge}`);

          await page.locator('#btn-hud-preset-minimal').click();
          const minPrefs = await page.evaluate(() => window.__vb.getHudPrefs());
          assert(minPrefs.scorebugMode === 'off' && !minPrefs.ballDropRing && !minPrefs.orientationCues && !minPrefs.strikeRangeGuide && !minPrefs.controlsOverlay, 'Expected Minimal preset to disable all optional HUD guides');

          await page.locator('#btn-hud-preset-rookie').click();
          const rookiePrefs = await page.evaluate(() => window.__vb.getHudPrefs());
          assert(rookiePrefs.scorebugMode === 'always' && rookiePrefs.ballDropRing && rookiePrefs.orientationCues && rookiePrefs.strikeRangeGuide && rookiePrefs.controlsOverlay, 'Expected Rookie preset to enable all HUD guides');
          await closeTitleSettings(page);

          // Reload and verify persistence
          await page.reload({ waitUntil: 'commit' });
          await waitForBoot(page);
          const reloadedPrefs = await page.evaluate(() => window.__vb.getHudPrefs());
          assert(reloadedPrefs.scorebugMode === 'always' && reloadedPrefs.controlsOverlay === true, 'Expected Rookie preset to survive page reload');

          // Deterministic URL runs force Clean Broadcast without clobbering saved Rookie prefs
          const detFixture = encodeURIComponent(JSON.stringify({
            version: 1,
            id: 'e2e_det',
            seed: 42,
            mode: '1v1',
            flyover: false,
            home: { controller: 'bot' },
            away: { controller: 'bot' },
          }));
          const captureStub = (route) => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: '{"path":"captures/auto_t1.png"}',
          });
          for (const flag of ['?captureTick=1', '?stateTrace=1', `?fixture=${detFixture}`]) {
            if (flag === '?captureTick=1') {
              await page.route('**/__capture', captureStub);
            }
            try {
              await page.goto(buildAppUrl(port, flag), { waitUntil: 'commit' });
              await waitForBoot(page);
              const detPrefs = await page.evaluate(() => window.__vb.getHudPrefs());
              assert(detPrefs.scorebugMode === 'off' && detPrefs.ballDropRing === false && detPrefs.controlsOverlay === false, `Expected ${flag} to force CLEAN_HUD_PREFS`);
              const storedRaw = await page.evaluate((k) => window.localStorage.getItem(k), HUD_PREFS_KEY);
              const stored = JSON.parse(storedRaw);
              assert(stored.scorebugMode === 'always' && stored.controlsOverlay === true, `Expected ${flag} not to overwrite saved localStorage prefs`);
            } finally {
              if (flag === '?captureTick=1') {
                await page.unroute('**/__capture', captureStub).catch(() => {});
              }
            }
          }
        });
      },
    },

    {
      tier: 1,
      id: 'T1.4',
      feature: 'Feature 10: Victory Pick Sides / Swap Controllers preserves seats and mode',
      async run(browser) {
        await withIsolatedScenario(browser, baseUrl, async ({ page }) => {
          await padConnect(page, 0, { id: 'PickSides Pad 1' });
          await padConnect(page, 1, { id: 'PickSides Pad 2' });
          await openPlayMatchAssignment(page, '1v1');
          await quickStartFromAssignment(page);
          await skipFlyover(page);
          await driveMatchToVictory(page, { homeScore: 2, awayScore: 0 });

          const pickBtn = page.locator('#btn-victory-pick-sides');
          assert(await pickBtn.isVisible(), 'Expected #btn-victory-pick-sides visible on victory screen');
          const btnText = await pickBtn.textContent();
          assert(btnText.includes('PICK SIDES / SWAP CONTROLLERS'), `Unexpected Pick Sides label: ${btnText}`);

          await pickBtn.click();
          await page.waitForFunction(() => {
            const el = document.getElementById('controller-assignment-screen');
            return el && getComputedStyle(el).display === 'flex';
          });

          const preserved = await page.evaluate(() => ({
            p1Pad: document.querySelector('[data-slot-idx="0"]')?.getAttribute('data-pad-index'),
            p2Pad: document.querySelector('[data-slot-idx="1"]')?.getAttribute('data-pad-index'),
            mode: document.getElementById('assignment-mode-badge')?.textContent || '',
          }));
          assert(preserved.p1Pad === '0' && preserved.p2Pad === '1', 'Expected Pick Sides to preserve P1 and P2 pad seats');
          assert(preserved.mode.includes('1v1'), 'Expected Pick Sides to preserve 1v1 mode');
        });
      },
    },

    {
      tier: 1,
      id: 'T1.5',
      feature: 'Feature 11: local_warmup multi-pad activation and sparring_bot P2 enablement',
      async run(browser) {
        // Part A: local_warmup with 3 pads
        await withIsolatedScenario(browser, baseUrl, async ({ page }) => {
          await padConnect(page, 0, { id: 'Warmup Pad 1' });
          await padConnect(page, 1, { id: 'Warmup Pad 2' });
          await padConnect(page, 2, { id: 'Warmup Pad 3' });
          await openPracticeSetup(page);
          await page.locator('#practice-drill-card-local_warmup').click();
          await page.locator('#btn-start-match').click();
          await waitForGameState(page, 'practice');
          await waitForTicks(page, 4);

          const setupState = await page.evaluate(() => ({
            enabled: window.__vb.athletes.map((a) => Boolean(a.isEnabled)),
            split: Boolean(window.__vb.tuning.camera.splitscreen),
            dividerVisible: getComputedStyle(document.getElementById('splitscreen-divider')).display !== 'none',
            frameCount: Array.from(document.querySelectorAll('.splitscreen-viewport-frame')).filter((el) => getComputedStyle(el).display !== 'none').length,
            p1Pos: window.__vb.probe(1)?.pelvis,
            p2Pos: window.__vb.probe(2)?.pelvis,
          }));
          assert(setupState.enabled[0] && setupState.enabled[1] && setupState.enabled[2] && !setupState.enabled[3], 'Expected local_warmup with 3 pads to enable athletes 0, 1, 2');
          assert(setupState.split && setupState.dividerVisible && setupState.frameCount === 3, 'Expected 3-way splitscreen frames in local_warmup');

          await padSetAxes(page, 1, [0.95, 0, 0, 0]);
          await padSetAxes(page, 2, [-0.95, 0, 0, 0]);
          await waitForTicks(page, 24);

          const moved = await page.evaluate(() => ({
            slot1: window.__vb.getInputSlot(1)?.moveX || 0,
            slot2: window.__vb.getInputSlot(2)?.moveX || 0,
            p1Pos: window.__vb.probe(1)?.pelvis,
            p2Pos: window.__vb.probe(2)?.pelvis,
          }));
          assert(Math.abs(moved.slot1) > 0.2, 'Expected Pad 1 input routed to slot 1 in local_warmup');
          assert(Math.abs(moved.slot2) > 0.2, 'Expected Pad 2 input routed to slot 2 in local_warmup');
          const d1 = Math.hypot(moved.p1Pos.x - setupState.p1Pos.x, moved.p1Pos.z - setupState.p1Pos.z);
          const d2 = Math.hypot(moved.p2Pos.x - setupState.p2Pos.x, moved.p2Pos.z - setupState.p2Pos.z);
          assert(d1 > 0.01 && d2 > 0.01, 'Expected athletes 1 and 2 to displace in local_warmup');
        });

        // Part B: sparring_bot
        await withIsolatedScenario(browser, baseUrl, async ({ page }) => {
          await openPracticeSetup(page);
          await page.locator('#practice-drill-card-sparring_bot').click();
          await page.locator('#btn-start-match').click();
          await waitForGameState(page, 'practice');
          await waitForTicks(page, 4);

          const sparState = await page.evaluate(() => ({
            enabled: window.__vb.athletes.map((a) => Boolean(a.isEnabled)),
            split: Boolean(window.__vb.tuning.camera.splitscreen),
          }));
          assert(sparState.enabled[0] && sparState.enabled[1] && !sparState.enabled[2], 'Expected sparring_bot to enable athletes 0 and 1 only');
          assert(!sparState.split, 'Expected sparring_bot to run single-screen');
        });
      },
    },

    {
      tier: 1,
      id: 'T1.6',
      feature: 'Features 14, 15, 16, 17, 18: drillBox, medium ball default, practiceHud, copy, kit colors',
      async run(browser) {
        // Part A: Practice drillBox and practiceHud
        await withIsolatedScenario(browser, baseUrl, async ({ page }) => {
          await openPracticeSetup(page);
          const drillBoxVisible = await page.evaluate(() => {
            const b = document.getElementById('practice-drill-selector-box');
            return b && getComputedStyle(b).display === 'flex';
          });
          assert(drillBoxVisible, 'Expected #practice-drill-selector-box visible in Practice setup');

          const drillIds = ['sandbox', 'newcomer_drill', 'ball_feeder', 'sparring_bot', 'local_warmup'];
          for (const d of drillIds) {
            await page.locator(`#practice-drill-card-${d}`).click();
          }
          await page.locator('#practice-drill-card-newcomer_drill').click();
          await page.locator('#row-physique-p1 button', { hasText: 'MASC' }).click();
          const titleAfterCust = await page.locator('#team-header-title-1').textContent();
          assert(titleAfterCust.includes('NEWCOMER CHECKLIST'), 'Expected athlete customization to preserve selected drill label');

          await page.locator('#btn-start-match').click();
          await waitForGameState(page, 'practice');
          await waitForTicks(page, 4);

          const hudText = await page.evaluate(() => {
            const el = document.getElementById('practice-mode-hud');
            return el && getComputedStyle(el).display === 'flex' ? el.textContent : '';
          });
          assert(hudText.includes('KEY B / SELECT'), `Expected practiceHud to include KEY B / SELECT, got: ${hudText}`);
          assert(hudText.includes('NEWCOMER CHECKLIST'), 'Expected newcomer drill checklist in practiceHud');
        });

        // Part B: Medium ball default, stale copy absence, unified kit colors in Match
        await withIsolatedScenario(browser, baseUrl, async ({ page }) => {
          const titleCopy = await page.locator('#title-screen').textContent();
          assert(!titleCopy.includes('v0.2.2'), 'Title screen must not contain stale v0.2.2 copy');

          await openPlayMatchAssignment(page, '1v1');
          // Seat kb2 on Away so Match runs 2P splitscreen for camera toast P1 kit-color verification
          await page.locator('#bench-slots-container [data-claim="team2"]').last().click();
          await proceedToSetupPage1(page);

          // Select Purple for Team 1 and Teal for Team 2
          await page.locator('#row-team-color-p1 button[title="Purple"]').click();
          await page.locator('#row-team-color-p2 button[title="Teal"]').click();

          const kitSync = await page.evaluate(() => {
            const badge1 = document.getElementById('viewport-badge-p1')?.innerHTML || '';
            const col1Border = document.getElementById('player-setup-col-1')?.style.borderTopColor || '';
            const casualDesc = window.__vb?.tuning?.strike?.assistPresets?.casual?.desc || '';
            const setupText = document.getElementById('player-setup-screen')?.textContent || '';
            return { badge1, col1Border, casualDesc, setupText };
          });
          assert(
            (kitSync.badge1.toLowerCase().includes('#9064f6') || kitSync.badge1.includes('144, 100, 246'))
            && (kitSync.col1Border.includes('144, 100, 246') || kitSync.col1Border.toLowerCase().includes('#9064f6')),
            `Expected P1 setup badge and column border to reflect readable Purple kit color (#9064f6), got badge=${kitSync.badge1} border=${kitSync.col1Border}`,
          );
          assert(kitSync.casualDesc === '0.65m reach · Wide hit timing window', `Expected updated casual copy, got: ${kitSync.casualDesc}`);
          assert(!kitSync.setupText.includes('360') && !kitSync.setupText.includes('v0.2.2'), 'Setup must not include stale copy');

          await advanceSetupToPage2(page);
          const medSelected = await page.evaluate(() => {
            const card = document.getElementById('match-ball-card-medium');
            return card ? card.style.borderColor : '';
          });
          assert(medSelected === 'rgb(255, 255, 255)' || medSelected === '#ffffff', `Expected medium ball selected by default, got borderColor=${medSelected}`);

          await page.locator('#btn-ready-p1').click();
          await page.locator('#btn-ready-p2').click();
          await page.locator('#btn-start-match').click();
          await page.waitForFunction(() => {
            const gs = window.__vb?.getGameState?.();
            return gs === 'flyover' || gs === 'match';
          });
          await skipFlyover(page);
          await waitForCountdownDone(page);

          // Trigger P1 camera toast via Tab in Match mode
          await page.keyboard.press('Tab');
          await page.waitForFunction(() => {
            const t = document.getElementById('camera-toast');
            return t && getComputedStyle(t).display === 'block';
          });
          const toastHtml = await page.evaluate(() => document.getElementById('camera-toast')?.innerHTML || '');
          assert(
            toastHtml.includes('P1') && (toastHtml.toLowerCase().includes('rgb(144, 100, 246)') || toastHtml.toLowerCase().includes('#9064f6')),
            `Expected #camera-toast in match mode to color P1 Purple (#9064f6), got: ${toastHtml}`,
          );
        });

        // Part C: Practice 'all' ball selection resolves to 'medium' on Match Quick Start
        await withIsolatedScenario(browser, baseUrl, async ({ page }) => {
          await openPracticeSetup(page);
          await page.locator('#btn-setup-back').click();
          await page.waitForFunction(() => getComputedStyle(document.getElementById('title-screen')).display === 'flex');

          await openPlayMatchAssignment(page, '1v1');
          await quickStartFromAssignment(page);
          await skipFlyover(page);
          const fallbackBall = await page.evaluate(() => ({
            count: window.__vb?.balls?.length ?? 0,
            id: window.__vb?.balls?.[0]?.id || '',
          }));
          assert(fallbackBall.count === 1 && fallbackBall.id === 'medium', `Expected Practice 'all' ball to resolve to 'medium' on Match launch, got ${JSON.stringify(fallbackBall)}`);
        });
      },
    },

    {
      tier: 1,
      id: 'T1.7',
      feature: 'Feature 13: First gamepad input invokes AudioContext resume safely',
      async run(browser) {
        await withIsolatedScenario(browser, baseUrl, async ({ page }) => {
          const before = await page.evaluate(() => ({
            unlocked: Boolean(window.__vb?.sound?.unlocked),
            audio: window.__vbE2EAudio.snapshot(),
          }));
          assert(!before.unlocked, 'Expected soundManager.unlocked to start false before user gesture');
          assert(before.audio.resumeCalls === 0, 'Expected 0 AudioContext.resume calls before gesture');

          await padConnect(page, 0, { id: 'Audio Unlock Pad' });
          await padPress(page, 0, 0);

          await page.waitForFunction(
            () => (window.__vbE2EAudio?.snapshot?.().resumeCalls ?? 0) >= 1 || Boolean(window.__vb?.sound?.unlocked),
            null,
            { timeout: 5000 },
          );
          const after = await page.evaluate(() => ({
            unlocked: Boolean(window.__vb?.sound?.unlocked),
            ctxState: window.__vb?.sound?.ctx?.state || null,
            audio: window.__vbE2EAudio.snapshot(),
          }));
          assert(after.audio.resumeCalls >= 1 || after.unlocked, 'Expected gamepad input to trigger AudioContext resume or unlock');
          if (after.ctxState === 'running') {
            assert(after.unlocked, 'Expected soundManager.unlocked === true once AudioContext is running');
          }
        });
      },
    },

    // TIER 2: BOUNDARY & CORNER CASES
    {
      tier: 2,
      id: 'T2.1',
      feature: 'Feature 2: Dormant USB wake-press edge vs already-held suppression',
      async run(browser) {
        await withIsolatedScenario(browser, baseUrl, async ({ page }) => {
          // Case A: Pad absent when assignment opens, wakes on Poll 1 with A pressed
          await openPlayMatchAssignment(page, '1v1');
          await padWake(page, 0, [0], { id: 'Dormant Wake Pad' });
          await page.waitForTimeout(180);

          const wakeState = await page.evaluate(() => ({
            assignmentVisible: getComputedStyle(document.getElementById('controller-assignment-screen')).display === 'flex',
            p1Pad: document.querySelector('[data-slot-idx="0"]')?.getAttribute('data-pad-index'),
            callout: document.getElementById('assignment-live-callout')?.textContent || '',
          }));
          assert(wakeState.assignmentVisible, 'Expected wake-press auto-promote to keep player on assignment screen');
          assert(wakeState.p1Pad === '0', 'Expected waking Pad 0 to claim P1 slot');
          assert(wakeState.callout.includes('JOINED AS HOST'), `Expected JOINED AS HOST callout, got: ${wakeState.callout}`);

          // Release button, return to Title, hold X (button 2, ignored on Title) across reset -> must be suppressed until release
          await padSetButtons(page, 0, []);
          await page.waitForTimeout(100);
          await page.locator('#assignment-btn-back').click();
          await page.waitForFunction(() => getComputedStyle(document.getElementById('title-screen')).display === 'flex');

          await padSetButtons(page, 0, [2]);
          await openPlayMatchAssignment(page, '1v1');
          await page.waitForTimeout(180);
          const suppressed = await page.evaluate(() => ({
            assignVisible: getComputedStyle(document.getElementById('controller-assignment-screen')).display === 'flex',
            p1Pad: document.querySelector('[data-slot-idx="0"]')?.getAttribute('data-pad-index'),
          }));
          assert(suppressed.assignVisible && suppressed.p1Pad === '0', 'Expected button held at menuPads.reset() to be suppressed without firing setBothAI');

          await padSetButtons(page, 0, []);
          await page.waitForTimeout(120);
          await padPress(page, 0, 2);
          await page.waitForFunction(() => !document.querySelector('[data-slot-idx="0"]')?.getAttribute('data-pad-index'));
          const clearedAfterRelease = await page.evaluate(() => Boolean(document.querySelector('#bench-slots-container [data-pad-index="0"]')));
          assert(clearedAfterRelease, 'Expected X press after release to move Pad 0 to bench via setBothAI');
        });
      },
    },

    {
      tier: 2,
      id: 'T2.2',
      feature: 'Features 3, 4: Full-team non-displacement, spare-pad hot-swap (mismatched pad id), shifted-index reconnect',
      async run(browser) {
        await withIsolatedScenario(browser, baseUrl, async ({ page }) => {
          await padConnect(page, 0, { id: 'Pad-Alpha-1' });
          await padConnect(page, 1, { id: 'Pad-Beta-2' });
          await padConnect(page, 2, { id: 'Pad-Gamma-3' });
          await openPlayMatchAssignment(page, '1v1');

          // Pad 2 on bench attempts to join full Team 1 -> must NOT displace Pad 0
          await page.locator('#bench-slots-container [data-pad-index="2"] [data-claim="team1"]').click();
          const fullState = await page.evaluate(() => ({
            p1Pad: document.querySelector('[data-slot-idx="0"]')?.getAttribute('data-pad-index'),
            p2Pad: document.querySelector('[data-slot-idx="1"]')?.getAttribute('data-pad-index'),
            callout: document.getElementById('assignment-live-callout')?.textContent || '',
          }));
          assert(fullState.p1Pad === '0' && fullState.p2Pad === '1', 'Expected full team to refuse displacement');
          assert(fullState.callout.includes('FULL'), `Expected full team callout, got: ${fullState.callout}`);

          // Disconnect Pad 2 before starting 1v1 match with Pad 0 & Pad 1
          await padDisconnect(page, 2);
          await quickStartFromAssignment(page);
          await skipFlyover(page);
          await waitForCountdownDone(page);

          // Spare-pad hot-swap at same index 1 (mismatched pad id) with A (jump=0) held
          await padSwap(page, 1, 'Pad-Spare-Replacement', { buttons: [0] });
          await waitForTicks(page, 6);
          const afterSwapHeld = await page.evaluate(() => ({
            paused: Boolean(window.__vb.loop.paused),
            modalOpen: getComputedStyle(document.getElementById('controller-disconnect-overlay')).display !== 'none',
            jumpQueued: Boolean(window.__vb.getInputSlot(1)?.jumpQueued),
            lastJumpTick: window.__vb.athletes[1]?.motor?.lastJumpTick,
          }));
          assert(!afterSwapHeld.paused && !afterSwapHeld.modalOpen, 'Expected spare-pad swap at same index to stay unpaused without modal');
          assert(!afterSwapHeld.jumpQueued && afterSwapHeld.lastJumpTick === -Infinity, 'Expected latchPadPrev to prevent held-button jump misfire on swap frame');

          // Release A then press A cleanly using tick-synchronized hold and release
          await padSetButtons(page, 1, []);
          await waitForTicks(page, 4);
          await padSetButtons(page, 1, [0]);
          await waitForTicks(page, 4);
          await padSetButtons(page, 1, []);
          await waitForTicks(page, 3);
          const jumpedAfterRelease = await page.evaluate(() => window.__vb.athletes[1]?.motor?.lastJumpTick);
          assert(Number.isFinite(jumpedAfterRelease) && jumpedAfterRelease > 0, 'Expected swapped pad to jump cleanly after releasing and re-pressing A');

          // Shifted-index reconnect (same id moved from index 1 to index 2 in one atomic frame)
          await page.evaluate(() => {
            window.__vbE2EPads.disconnect(1);
            window.__vbE2EPads.connect(2, { id: 'Pad-Spare-Replacement' });
          });
          await waitForTicks(page, 4);
          const shifted = await page.evaluate(() => ({
            paused: Boolean(window.__vb.loop.paused),
            modalOpen: getComputedStyle(document.getElementById('controller-disconnect-overlay')).display !== 'none',
          }));
          assert(!shifted.paused && !shifted.modalOpen, 'Expected Pass 1b shifted-index reconnect to self-heal seamlessly');
        });
      },
    },

    {
      tier: 2,
      id: 'T2.3',
      feature: 'Feature 5: Mid-match disconnect pause, no keyboard fallback, all 5 modal recovery options',
      async run(browser) {
        // Sub-run A: No keyboard fallback + Option 1 (Reconnect) + Option 2 (Spare Pad) + Option 3 (Switch to KB1)
        await runStep('T2.3 Sub-run A', () => withIsolatedScenario(browser, baseUrl, async ({ page }) => {
          await padConnect(page, 0, { id: 'MatchPad-0' });
          await padConnect(page, 1, { id: 'MatchPad-1' });
          await openPlayMatchAssignment(page, '1v1');
          await quickStartFromAssignment(page);
          await skipFlyover(page);
          await runStep('Sub-run A countdown', () => waitForCountdownDone(page));

          // Disconnect Pad 1 -> match pauses and disconnect modal opens
          await padDisconnect(page, 1);
          await page.waitForFunction(() => {
            const ov = document.getElementById('controller-disconnect-overlay');
            return ov && getComputedStyle(ov).display === 'flex' && Boolean(window.__vb.loop.paused);
          });

          const posBefore = await page.evaluate(() => window.__vb.probe(1)?.pelvis);
          await page.keyboard.down('KeyA');
          await page.keyboard.down('KeyD');
          await page.keyboard.down('KeyJ');
          await page.keyboard.down('KeyL');
          await page.waitForTimeout(140);
          await page.keyboard.up('KeyA');
          await page.keyboard.up('KeyD');
          await page.keyboard.up('KeyJ');
          await page.keyboard.up('KeyL');

          const pausedCheck = await page.evaluate(() => {
            const ov = document.getElementById('controller-disconnect-overlay');
            const slot1 = window.__vb.getInputSlot(1);
            const kb1Btn = document.getElementById('disconnect-btn-kb1');
            return {
              paused: Boolean(window.__vb.loop.paused),
              modalOpen: Boolean(ov && getComputedStyle(ov).display === 'flex'),
              badge: document.getElementById('disconnect-slot-badge')?.textContent || '',
              kb1Enabled: Boolean(kb1Btn && !kb1Btn.disabled),
              slot1MoveX: slot1?.moveX ?? 0,
              slot1MoveZ: slot1?.moveZ ?? 0,
              slot1JumpQueued: Boolean(slot1?.jumpQueued),
              posAfter: window.__vb.probe(1)?.pelvis,
            };
          });
          assert(pausedCheck.paused && pausedCheck.modalOpen, 'Expected loop.paused === true and disconnect overlay open');
          assert(pausedCheck.badge.includes('P2'), `Expected P2 disconnect badge, got: ${pausedCheck.badge}`);
          assert(pausedCheck.kb1Enabled, 'Expected #disconnect-btn-kb1 enabled rather than silent keyboard fallback');
          assert(pausedCheck.slot1MoveX === 0 && pausedCheck.slot1MoveZ === 0 && !pausedCheck.slot1JumpQueued, 'Expected disconnected slot 1 input to remain zeroed');
          assert(pausedCheck.posAfter.x === posBefore.x && pausedCheck.posAfter.z === posBefore.z, 'Expected zero silent keyboard movement on disconnected pad');

          // Recovery 1: Reconnect same pad -> #disconnect-btn-resume appears and resumes
          await padConnect(page, 1, { id: 'MatchPad-1' });
          await page.waitForSelector('#disconnect-btn-resume', { state: 'visible' });
          await page.locator('#disconnect-btn-resume').click();
          await page.waitForFunction(() => !window.__vb.loop.paused);

          // Recovery 2: Disconnect Pad 1, connect spare Pad 2, assign #disconnect-btn-pad-2
          await padDisconnect(page, 1);
          await padConnect(page, 2, { id: 'Spare-Bar-Pad' });
          await page.waitForSelector('#disconnect-btn-pad-2', { state: 'visible' });
          await page.locator('#disconnect-btn-pad-2').click();
          await page.waitForFunction(() => !window.__vb.loop.paused);

          // Recovery 3: Disconnect Pad 2 (now assigned to P2), switch P2 to Keyboard 1 (#disconnect-btn-kb1)
          await padDisconnect(page, 2);
          await page.waitForSelector('#disconnect-btn-kb1', { state: 'visible' });
          await page.locator('#disconnect-btn-kb1').click();
          await page.waitForFunction(() => !window.__vb.loop.paused);
        }));

        // Sub-run B: Option 4 (Switch to AI Bot) & Option 5 (Return to Setup)
        await runStep('T2.3 Sub-run B', () => withIsolatedScenario(browser, baseUrl, async ({ page }) => {
          await padConnect(page, 0, { id: 'SubPad-0' });
          await padConnect(page, 1, { id: 'SubPad-1' });
          await openPlayMatchAssignment(page, '1v1');
          await quickStartFromAssignment(page);
          await skipFlyover(page);
          await runStep('Sub-run B countdown', () => waitForCountdownDone(page));

          // Recovery 4: Switch P2 to AI Bot
          await padDisconnect(page, 1);
          await page.waitForSelector('#disconnect-btn-ai', { state: 'visible' });
          await page.locator('#disconnect-btn-ai').click();
          await page.waitForFunction(() => !window.__vb.loop.paused);
          const p2IsAi = await page.evaluate(() => window.__vb.getPlayerConfigs()?.[1]?.type === 'ai');
          assert(p2IsAi, 'Expected #disconnect-btn-ai to convert P2 to AI bot');

          // Recovery 5: Disconnect P1 Pad 0 -> Return to Controller Setup (#disconnect-btn-setup)
          await padDisconnect(page, 0);
          await page.waitForSelector('#disconnect-btn-setup', { state: 'visible' });
          await page.locator('#disconnect-btn-setup').click();
          await page.waitForFunction(() => {
            const el = document.getElementById('controller-assignment-screen');
            return el && getComputedStyle(el).display === 'flex';
          });
        }));

        // Sub-run C: When kb1 and kb2 are both in use in 2v2, #disconnect-btn-kb-none is shown disabled
        await runStep('T2.3 Sub-run C', () => withIsolatedScenario(browser, baseUrl, async ({ page }) => {
          await padConnect(page, 0, { id: 'SubPadC-0' });
          await openPlayMatchAssignment(page, '2v2');
          await page.locator('#bench-slots-container button[data-claim="team1"]').first().click();
          await page.locator('#bench-slots-container button[data-claim="team2"]').first().click();
          await quickStartFromAssignment(page);
          await skipFlyover(page);

          const beforeTicks = await page.evaluate(() => ({
            tick: window.__vb?.loop?.tick ?? 0,
            cd: window.__vb?.matchState?.countdownTicksRemaining ?? 0,
            paused: Boolean(window.__vb?.loop?.paused),
          }));
          assert(!beforeTicks.paused, 'Expected 2v2 loop unpaused at countdown start');
          await waitForTicks(page, 4);
          const afterTicks = await page.evaluate(() => {
            const ms = window.__vb?.matchState;
            const cdAfter = ms?.countdownTicksRemaining ?? 0;
            if (ms && ms.isCountingDown && cdAfter > 6) {
              ms.countdownTicksRemaining = 6;
            }
            return {
              tick: window.__vb?.loop?.tick ?? 0,
              cdAfter,
              paused: Boolean(window.__vb?.loop?.paused),
            };
          });
          assert(
            !afterTicks.paused && afterTicks.cdAfter <= beforeTicks.cd - 4,
            `Expected 2v2 countdownTicksRemaining to advance across 4 real ticks (before=${beforeTicks.cd}, after=${afterTicks.cdAfter}, paused=${afterTicks.paused})`,
          );
          await runStep('Sub-run C countdown', () => waitForCountdownDone(page));

          await padDisconnect(page, 0);
          await page.waitForSelector('#disconnect-btn-kb-none', { state: 'visible' });
          const noKb = await page.evaluate(() => {
            const btn = document.getElementById('disconnect-btn-kb-none');
            return { disabled: Boolean(btn?.disabled), text: btn?.textContent || '' };
          });
          assert(noKb.disabled && noKb.text.includes('KEYBOARDS IN USE'), `Expected #disconnect-btn-kb-none disabled when kb1 and kb2 are occupied, got ${JSON.stringify(noKb)}`);
        }));
      },
    },

    {
      tier: 2,
      id: 'T2.4',
      feature: 'Features 7, 8: Explicit false boolean persistence and In-Game DPR/Shadow non-clobber',
      async run(browser) {
        await withIsolatedScenario(browser, baseUrl, async ({ page }) => {
          await openTitleSettings(page);
          await page.locator('#btn-hud-preset-rookie').click();

          // Toggle ballDropRing, orientationCues, and controlsOverlay explicitly to false
          const modal = page.locator('#main-menu-settings-modal');
          await modal.locator('button', { hasText: 'Hidden (Default)' }).click();
          await modal.locator('xpath=.//div[./span[normalize-space(text())="Ball Rainbow Halo"]]//button[normalize-space(text())="Off"]').click();
          await modal.locator('xpath=.//div[./span[normalize-space(text())="Ball Pip & Swap Cues"]]//button[normalize-space(text())="Off"]').click();
          await closeTitleSettings(page);

          await page.reload({ waitUntil: 'commit' });
          await waitForBoot(page);

          const prefsAfterReload = await page.evaluate(() => window.__vb.getHudPrefs());
          assert(prefsAfterReload.ballDropRing === false, 'Expected ballDropRing: false to persist across reload');
          assert(prefsAfterReload.orientationCues === false, 'Expected orientationCues: false to persist across reload');
          assert(prefsAfterReload.controlsOverlay === false, 'Expected controlsOverlay: false to persist across reload');
          assert(prefsAfterReload.strikeRangeGuide === true, 'Expected strikeRangeGuide: true to remain persisted');
          assert(prefsAfterReload.scorebugMode === 'always', 'Expected scorebugMode: always to remain persisted');

          // Now enable Rookie preset, change DPR & Shadow on Main Menu Graphics tab, enter Practice, verify ultra-lean pause menu & non-clobber
          await openTitleSettings(page);
          await page.locator('#btn-hud-preset-rookie').click();
          await page.locator('#settings-tab-graphics').click();
          await modal.locator('button', { hasText: '1.0x (Fast)' }).click();
          await modal.locator('button', { hasText: 'Balanced (1 Tower)' }).click();
          await closeTitleSettings(page);
          await openPracticeSetup(page);
          await page.locator('#btn-start-match').click();
          await waitForGameState(page, 'practice');
          await waitForTicks(page, 4);

          await page.keyboard.press('Escape');
          await page.waitForFunction(() => window.__vb.isInGameMenuOpen());
          const inGameCheck = await page.evaluate(() => {
            const card = document.getElementById('ingame-pause-card');
            const resume = document.getElementById('btn-ingame-resume');
            const badge = document.getElementById('ingame-hud-preset-badge')?.textContent || '';
            return {
              resumeFocused: resume?.dataset?.focused === 'true',
              noScroll: Boolean(card && card.scrollHeight <= card.clientHeight + 2),
              badge,
              controlsOverlay: Boolean(window.__vb.getHudPrefs().controlsOverlay),
            };
          });
          assert(inGameCheck.resumeFocused, 'Expected pause menu to focus #btn-ingame-resume at top');
          assert(inGameCheck.noScroll, 'Expected pause menu card to have zero vertical overflow');
          assert(inGameCheck.badge === 'Rookie' && inGameCheck.controlsOverlay === true, 'Expected DPR/Shadow toggles not to clobber Rookie controlsOverlay: true');
        });
      },
    },

    {
      tier: 2,
      id: 'T2.5',
      feature: 'Feature 18: Non-blocking colorblind-safe swatch contrast warning (normal and swapped teams)',
      async run(browser) {
        await withIsolatedScenario(browser, baseUrl, async ({ page }) => {
          await openPlayMatchAssignment(page, '1v1');
          await proceedToSetupPage1(page);

          // Select Red (Home) and Green (Away) -> triggers Red-Green CVD contrast warning
          await page.locator('#row-team-color-p1 button[title="Red"]').click();
          await page.locator('#row-team-color-p2 button[title="Green"]').click();

          const warn1 = await page.evaluate(() => {
            const el = document.getElementById('swatch-contrast-warning');
            const nextBtn = document.getElementById('btn-setup-next');
            return {
              display: el ? getComputedStyle(el).display : 'none',
              role: el?.getAttribute('role') || '',
              ratio: el?.dataset?.ratio || '',
              text: el?.textContent || '',
              nextDisabled: Boolean(nextBtn?.disabled),
            };
          });
          assert(warn1.display === 'flex', 'Expected #swatch-contrast-warning visible for Red vs Green');
          assert(warn1.role === 'status', 'Expected #swatch-contrast-warning role="status"');
          assert(warn1.ratio.length > 0 && warn1.text.includes('KIT CONTRAST WARNING'), `Unexpected warning text: ${warn1.text}`);
          assert(!warn1.nextDisabled, 'Expected contrast warning to be non-blocking on #btn-setup-next');

          // Swap teams (P1 -> AWAY, so P2 becomes HOME) and confirm warning still works
          await page.locator('#row-team-status-p1 button', { hasText: 'AWAY (NORTH)' }).click();
          await page.locator('#row-team-color-p2 button[title="Red"]').click();
          await page.locator('#row-team-color-p1 button[title="Green"]').click();
          const warnSwapped = await page.evaluate(() => getComputedStyle(document.getElementById('swatch-contrast-warning')).display);
          assert(warnSwapped === 'flex', 'Expected contrast warning to still evaluate Home vs Away when teams are swapped');

          // Verify high-contrast pair (Red vs Yellow) clears the warning
          await page.locator('#row-team-color-p1 button[title="Yellow"]').click();
          const warnCleared = await page.evaluate(() => getComputedStyle(document.getElementById('swatch-contrast-warning')).display);
          assert(warnCleared === 'none', 'Expected high-contrast pair to hide #swatch-contrast-warning');
        });
      },
    },

    {
      tier: 2,
      id: 'T2.6',
      feature: 'Feature 16: practiceHud vs #hud bounding-box non-overlap at 1280x720',
      async run(browser) {
        await withIsolatedScenario(browser, baseUrl, async ({ page }) => {
          await openPracticeSetup(page);
          await page.locator('#practice-drill-card-newcomer_drill').click();
          await page.locator('#btn-start-match').click();
          await waitForGameState(page, 'practice');
          await waitForTicks(page, 4);

          await page.keyboard.press('F3');
          await page.waitForFunction(() => {
            const hud = document.getElementById('hud');
            const phud = document.getElementById('practice-mode-hud');
            return hud && phud && getComputedStyle(hud).display !== 'none' && getComputedStyle(phud).display === 'flex';
          });

          const rects = await page.evaluate(() => {
            const a = document.getElementById('hud').getBoundingClientRect();
            const b = document.getElementById('practice-mode-hud').getBoundingClientRect();
            return {
              hud: { left: a.left, top: a.top, right: a.right, bottom: a.bottom, width: a.width, height: a.height },
              practice: { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height },
            };
          });
          assert(rects.hud.width > 0 && rects.practice.width > 0, 'Expected both #hud and #practice-mode-hud to have positive dimensions');
          const separated =
            rects.hud.right <= rects.practice.left ||
            rects.practice.right <= rects.hud.left ||
            rects.hud.bottom <= rects.practice.top ||
            rects.practice.bottom <= rects.hud.top;
          assert(separated, `Expected #hud and #practice-mode-hud not to overlap: hud=${JSON.stringify(rects.hud)} practice=${JSON.stringify(rects.practice)}`);
        });
      },
    },

    // TIER 3: CROSS-FEATURE COMBINATIONS
    {
      tier: 3,
      id: 'T3.1',
      feature: 'Features 8, 11, 18: Rookie preset + local_warmup multi-pad + kit colors',
      async run(browser) {
        await withIsolatedScenario(browser, baseUrl, async ({ page }) => {
          await openTitleSettings(page);
          await page.locator('#btn-hud-preset-rookie').click();
          await closeTitleSettings(page);

          await padConnect(page, 0, { id: 'Combo Pad 1' });
          await padConnect(page, 1, { id: 'Combo Pad 2' });
          await openPracticeSetup(page);
          await page.locator('#row-team-color-p1 button[title="Orange"]').click();
          await page.locator('#practice-drill-card-local_warmup').click();
          await page.locator('#btn-start-match').click();
          await waitForGameState(page, 'practice');
          await waitForTicks(page, 6);

          const state = await page.evaluate(() => {
            const ctrl = document.getElementById('controls-overlay');
            const strips = Array.from(document.querySelectorAll('#controls-overlay .controls-strip')).filter((s) => !s.hidden);
            const p1Frame = document.querySelector('.splitscreen-viewport-frame[data-player-slot="0"]');
            return {
              controlsVisible: Boolean(ctrl && !ctrl.hidden),
              stripCount: strips.length,
              practiceHudVisible: getComputedStyle(document.getElementById('practice-mode-hud')).display === 'flex',
              framesVisible: getComputedStyle(document.getElementById('splitscreen-viewport-frames')).display !== 'none',
              p1AthleteColor: window.__vb?.athletes?.[0]?.primaryColor,
              p1TuningColor: window.__vb?.tuning?.players?.[0]?.primaryColor,
              p1FrameColor: p1Frame?.dataset?.teamColor?.toLowerCase() || '',
            };
          });
          assert(state.controlsVisible && state.stripCount >= 2, 'Expected Rookie #controls-overlay visible with 2 human strips in local_warmup');
          assert(state.practiceHudVisible && state.framesVisible, 'Expected practice HUD and splitscreen viewport frames active together');
          assert(state.p1AthleteColor === 0xea580c && state.p1TuningColor === 0xea580c, `Expected Orange kit color 0xea580c on athlete and tuning, got athlete=${state.p1AthleteColor} tuning=${state.p1TuningColor}`);
          assert(state.p1FrameColor === '#ea580c', `Expected P1 splitscreen frame kit color #ea580c, got ${state.p1FrameColor}`);
        });
      },
    },

    {
      tier: 3,
      id: 'T3.2',
      feature: 'Features 10, 12: Victory Pick Sides -> swap sides & spare pad -> Rematch clean latches',
      async run(browser) {
        await withIsolatedScenario(browser, baseUrl, async ({ page }) => {
          await padConnect(page, 0, { id: 'Latch Pad 0' });
          await padConnect(page, 1, { id: 'Latch Pad 1' });
          await openPlayMatchAssignment(page, '1v1');
          await quickStartFromAssignment(page);
          await skipFlyover(page);
          await driveMatchToVictory(page, { homeScore: 1, awayScore: 0 });

          await page.locator('#btn-victory-pick-sides').click();
          await page.waitForFunction(() => getComputedStyle(document.getElementById('controller-assignment-screen')).display === 'flex');

          await page.locator('#assignment-btn-swap-sides').click();
          await padSwap(page, 1, 'Latch-Spare-Pad');
          await quickStartFromAssignment(page);
          await skipFlyover(page);
          await waitForCountdownDone(page);

          // After swapSides(), Pad 1 (Latch-Spare-Pad) owns slot 0 (athletes[0])
          // Build grounded speed, then fire Cut (RB=5), Slide+Jump cancel (RT=7 + A=0), and Dive (X=2) on Pad 1
          await padSetAxes(page, 1, [0, -1, 0, 0]);
          await padSetButtons(page, 1, [], { 6: 1 });
          await page.waitForFunction(() => {
            const p = window.__vb?.probe?.(0);
            return Boolean(p && p.grounded && p.motor.speed > 4.2);
          }, null, { timeout: 10_000 });

          await padSetButtons(page, 1, [5], { 6: 1 });
          await page.waitForFunction(() => {
            const a = window.__vb?.athletes?.[0];
            return Boolean(a && Number.isFinite(a.actionState?.lastCutTick));
          }, null, { timeout: 10_000 });
          await padSetButtons(page, 1, [], { 6: 1 });
          await page.waitForFunction(() => {
            const p = window.__vb?.probe?.(0);
            return Boolean(p && p.grounded && p.motor.speed > 4.2);
          }, null, { timeout: 10_000 });

          await padSetButtons(page, 1, [], { 6: 1, 7: 1 });
          await page.waitForFunction(() => {
            const a = window.__vb?.athletes?.[0];
            return Boolean(a && a.actionState?.slideTime > 0);
          }, null, { timeout: 10_000 });

          await padSetButtons(page, 1, [0], { 6: 1, 7: 1 });
          await page.waitForFunction(() => {
            const a = window.__vb?.athletes?.[0];
            return Boolean(
              a
              && a.actionState?.slideNeedsRelease === true
              && a.actionState?.slideTime === 0
              && a.motor?.grounded,
            );
          }, null, { timeout: 10_000 });
          await padSetButtons(page, 1, [], { 6: 1, 7: 1 });
          await page.waitForFunction(() => {
            const a = window.__vb?.athletes?.[0];
            return Boolean(a && a.motor?.grounded && a.actionState?.slideNeedsRelease === true);
          }, null, { timeout: 10_000 });

          await padSetButtons(page, 1, [2], { 6: 1, 7: 1 });
          await page.waitForFunction(() => {
            const a = window.__vb?.athletes?.[0];
            return Boolean(
              a
              && Number.isFinite(a.actionState?.lastDiveTick)
              && a.actionState?.slideNeedsRelease === true,
            );
          }, null, { timeout: 10_000 });

          // Keep RT=7 held cleanly so slideNeedsRelease stays true until rematch()
          await padSetButtons(page, 1, [], { 7: 1 });
          await padSetAxes(page, 1, [0, 0, 0, 0]);

          const preRematch = await page.evaluate(() => {
            const a = window.__vb.athletes[0];
            return {
              lastCutTick: a?.actionState?.lastCutTick,
              lastDiveTick: a?.actionState?.lastDiveTick,
              slideNeedsRelease: Boolean(a?.actionState?.slideNeedsRelease),
            };
          });
          assert(Number.isFinite(preRematch.lastCutTick), `Expected pre-rematch lastCutTick populated on athlete 0, got ${preRematch.lastCutTick}`);
          assert(Number.isFinite(preRematch.lastDiveTick), `Expected pre-rematch lastDiveTick populated on athlete 0, got ${preRematch.lastDiveTick}`);
          assert(preRematch.slideNeedsRelease === true, 'Expected pre-rematch slideNeedsRelease === true on athlete 0');

          await page.evaluate(() => window.__vb.rematch());
          await waitForGameState(page, 'match');
          await padSetButtons(page, 1, []);

          const latches = await page.evaluate(() => {
            return window.__vb.athletes.slice(0, 2).map((a) => ({
              lastDiveTick: a.actionState?.lastDiveTick,
              lastCutTick: a.actionState?.lastCutTick,
              lastInterceptDiveTick: a.actionState?.lastInterceptDiveTick,
              interceptDiveContactTick: a.actionState?.interceptDiveContactTick,
              slideNeedsRelease: a.actionState?.slideNeedsRelease,
              slideLowSpeedTicks: a.actionState?.slideLowSpeedTicks,
              prevGrounded: a.actionState?.prevGrounded,
              lastJumpTick: a.motor?.lastJumpTick,
            }));
          });
          for (let i = 0; i < latches.length; i++) {
            const s = latches[i];
            assert(s.lastDiveTick === -Infinity, `Expected athlete ${i} lastDiveTick reset`);
            assert(s.lastCutTick === -Infinity, `Expected athlete ${i} lastCutTick reset`);
            assert(s.lastInterceptDiveTick === -Infinity, `Expected athlete ${i} lastInterceptDiveTick reset`);
            assert(s.interceptDiveContactTick === -Infinity, `Expected athlete ${i} interceptDiveContactTick reset`);
            assert(s.slideNeedsRelease === false, `Expected athlete ${i} slideNeedsRelease === false`);
            assert(s.slideLowSpeedTicks === 0, `Expected athlete ${i} slideLowSpeedTicks === 0`);
            assert(s.prevGrounded === true, `Expected athlete ${i} prevGrounded === true`);
            assert(s.lastJumpTick === -Infinity, `Expected athlete ${i} motor.lastJumpTick reset`);
          }

          await waitForCountdownDone(page);
          const posBefore = await page.evaluate(() => window.__vb.probe(0).pelvis);
          await padSetAxes(page, 1, [0.95, 0, 0, 0]);
          await waitForTicks(page, 12);
          const posAfterMove = await page.evaluate(() => window.__vb.probe(0).pelvis);
          const disp = Math.hypot(posAfterMove.x - posBefore.x, posAfterMove.z - posBefore.z);
          assert(disp > 0.1, `Expected immediate horizontal movement after rematch, got disp=${disp}`);
          await padPress(page, 1, 0, 140, 60);
          await page.waitForFunction(() => Number.isFinite(window.__vb?.athletes?.[0]?.motor?.lastJumpTick));
          await padSetAxes(page, 1, [0, 0, 0, 0]);
        });
      },
    },

    {
      tier: 3,
      id: 'T3.3',
      feature: 'Features 5, 6: Disconnect modal -> Return to Setup -> re-Ready -> launch fresh match',
      async run(browser) {
        await withIsolatedScenario(browser, baseUrl, async ({ page }) => {
          await padConnect(page, 0, { id: 'T33 Pad 0' });
          await padConnect(page, 1, { id: 'T33 Pad 1' });
          await openPlayMatchAssignment(page, '1v1');
          await quickStartFromAssignment(page);
          await skipFlyover(page);
          await waitForCountdownDone(page);

          await padDisconnect(page, 1);
          await page.waitForSelector('#disconnect-btn-setup', { state: 'visible' });
          await page.locator('#disconnect-btn-setup').click();
          await page.waitForFunction(() => {
            const el = document.getElementById('controller-assignment-screen');
            const stale = document.querySelector('#team2-slots-container [data-pad-index="1"]');
            return el && getComputedStyle(el).display === 'flex' && !stale;
          });

          // Reconnect Pad 1 to bench, claim Away, proceed through Setup Page 1 -> Page 2 -> Ready -> Launch
          await padConnect(page, 1, { id: 'T33 Pad 1' });
          await page.waitForFunction(() => Boolean(document.querySelector('#bench-slots-container [data-pad-index="1"]')));
          await page.locator('#bench-slots-container [data-pad-index="1"] [data-claim="team2"]').click();
          await proceedToSetupPage1(page);
          await advanceSetupToPage2(page);
          await padPress(page, 0, 2);
          await padPress(page, 1, 0);
          await page.waitForFunction(() => {
            const btn = document.getElementById('btn-start-match');
            return Boolean(btn && !btn.disabled);
          });
          await page.locator('#btn-start-match').click();
          await page.waitForFunction(() => {
            const gs = window.__vb?.getGameState?.();
            return gs === 'flyover' || gs === 'match';
          });
          await skipFlyover(page);
          await waitForCountdownDone(page);
          const gs = await page.evaluate(() => window.__vb.getGameState());
          assert(gs === 'match', `Expected fresh match launch after disconnect return to setup, got ${gs}`);
        });
      },
    },

    // TIER 4: REAL-WORLD LIVE-ROOM SCENARIOS + SCREENSHOT CAPTURES
    {
      tier: 4,
      id: 'T4.1',
      feature: 'Live-Room Bar Playtest Flow + 4 Visual Verification Screenshots',
      async run(browser) {
        const shots = [];
        await withIsolatedScenario(browser, baseUrl, async ({ page }) => {
          // 1. Enable Rookie / Live Room preset
          await openTitleSettings(page);
          await page.locator('#btn-hud-preset-rookie').click();
          await closeTitleSettings(page);

          // 2. Walk-up controller drop-in with dormant wake-press + second challenger + side swap
          await openPlayMatchAssignment(page, '1v1');
          await padWake(page, 0, [0], { id: 'Bar Challenger 1' });
          await page.waitForFunction(() => document.querySelector('[data-slot-idx="0"]')?.getAttribute('data-pad-index') === '0');
          await padSetButtons(page, 0, []);
          await page.waitForTimeout(120);
          await padConnect(page, 1, { id: 'Bar Challenger 2' });
          await page.waitForFunction(() => Boolean(document.querySelector('#bench-slots-container [data-pad-index="1"]')));
          await padPress(page, 1, 0);
          await page.locator('#assignment-btn-swap-sides').click();
          await page.locator('#assignment-btn-swap-sides').click();

          const shot1 = await captureScreenshot(page, outDir, '01_setup_controller_assignment.png');
          if (shot1) shots.push(shot1);

          // 3. Pick distinct high-contrast kit colors, Ready both players, enter match
          await proceedToSetupPage1(page);
          await page.locator('#row-team-color-p1 button[title="Purple"]').click();
          await page.locator('#row-team-color-p2 button[title="Yellow"]').click();
          await advanceSetupToPage2(page);
          await padPress(page, 0, 2);
          await padPress(page, 1, 0);
          await page.waitForFunction(() => {
            const btn = document.getElementById('btn-start-match');
            return Boolean(btn && !btn.disabled);
          });
          await page.locator('#btn-start-match').click();
          await page.waitForFunction(() => {
            const gs = window.__vb?.getGameState?.();
            return gs === 'flyover' || gs === 'match';
          });
          await skipFlyover(page);
          await waitForCountdownDone(page);

          // 4. Mid-rally controller disconnect -> capture modal -> hot-swap spare pad -> finish set
          await padDisconnect(page, 1);
          await page.waitForFunction(() => {
            const ov = document.getElementById('controller-disconnect-overlay');
            return ov && getComputedStyle(ov).display === 'flex';
          });
          const shot2 = await captureScreenshot(page, outDir, '02_disconnect_modal.png');
          if (shot2) shots.push(shot2);

          await padConnect(page, 2, { id: 'Bar Spare Controller' });
          await page.waitForSelector('#disconnect-btn-pad-2', { state: 'visible' });
          await page.locator('#disconnect-btn-pad-2').click();
          await page.waitForFunction(() => !window.__vb.loop.paused);

          // 5. Finish match -> Victory Pick Sides screenshot
          await driveMatchToVictory(page, { homeScore: 3, awayScore: 1 });
          const shot3 = await captureScreenshot(page, outDir, '03_victory_pick_sides.png');
          if (shot3) shots.push(shot3);

          // 6. Pick Sides for challengers -> return to Title -> launch Rookie Practice Newcomer Drill screenshot
          await page.locator('#btn-victory-pick-sides').click();
          await page.waitForFunction(() => getComputedStyle(document.getElementById('controller-assignment-screen')).display === 'flex');
          await page.locator('#assignment-btn-back').click();
          await page.waitForFunction(() => getComputedStyle(document.getElementById('title-screen')).display === 'flex');

          await openPracticeSetup(page);
          await page.locator('#practice-drill-card-newcomer_drill').click();
          await page.locator('#btn-start-match').click();
          await waitForGameState(page, 'practice');
          await waitForTicks(page, 8);
          await page.waitForFunction(() => {
            const phud = document.getElementById('practice-mode-hud');
            const ctrl = document.getElementById('controls-overlay');
            return phud && getComputedStyle(phud).display === 'flex' && ctrl && !ctrl.hidden;
          });
          const shot4 = await captureScreenshot(page, outDir, '04_rookie_hud_practice.png');
          if (shot4) shots.push(shot4);
        });
        return { screenshots: shots };
      },
    },
  ];
}

export async function runE2ETiers({ browser, port, tierFilter = 'all', outDir }) {
  const all = makeScenarioList(port, outDir);
  const selected = tierFilter === 'all'
    ? all
    : all.filter((s) => String(s.tier) === String(tierFilter));

  const results = [];
  for (const scenario of selected) {
    const started = Date.now();
    console.log(`[e2e] RUN ${scenario.id} (Tier ${scenario.tier}): ${scenario.feature}`);
    try {
      const meta = (await scenario.run(browser)) || {};
      const durationMs = Date.now() - started;
      console.log(`[e2e] PASS ${scenario.id} (${durationMs}ms)`);
      results.push({
        tier: scenario.tier,
        id: scenario.id,
        feature: scenario.feature,
        passed: true,
        durationMs,
        error: null,
        screenshots: meta.screenshots || [],
      });
    } catch (err) {
      const durationMs = Date.now() - started;
      const msg = err?.message || String(err);
      console.error(`[e2e] FAIL ${scenario.id} (${durationMs}ms): ${msg}`);
      results.push({
        tier: scenario.tier,
        id: scenario.id,
        feature: scenario.feature,
        passed: false,
        durationMs,
        error: msg,
        screenshots: [],
      });
    }
  }
  return results;
}
