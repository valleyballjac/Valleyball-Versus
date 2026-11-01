# Valleyball Versus: How to Play explainer, draft 1

Two deliverables from one shoot:

- **Long cut**, 16:9 1920×1080, about 2:50 (3:00 approved).
- **TikTok series**, native 9:16 1080×1920, 8 parts of 18–35 s.

Text cards only, in the official trailer's card style: kicker line, Syncopate headline, one-line body, chip row, spectral rule.

**Working assumptions** (change any of these and I'll re-cut the plan):

- Every card runs 9.0 s by default: 5 bars at 133.33 BPM, which is the tempo of both Neon Velocity and the in-game Arena of Frost. Durations snap to whichever track we pick.
- Each control chip shows both inputs, gamepad first: `RB · V`.
- Every claim below was checked against the code, not the How to Play screen or the Argon cards. Where those disagree with the code, the code wins. The conflicts are listed at the end.

---

## Card system

**Lower-third (16:9).** The trailer's card, unchanged, plus one new element: a control chip on the left of the chip row (e.g. `RB · V  CUT`). Body copy stays at 20 words or fewer so it reads in about 6 s.

**Portrait (9:16).** Two blocks, both kept inside TikTok's safe area:

- **Hook block, top third.** Headline only, large (Syncopate ~64 px). It sits below the For You / Following tabs.
- **Card, lower middle.** Body plus up to two chips plus the control chip. It ends above the caption, username and sound strip, and stays clear of the right-hand like/comment/share rail.
- **Safe-area margins.** Approximate keep-out: top ~200 px, bottom ~450 px, right ~130 px. I'll check these against TikTok's current safe-zone template before rendering anything final.

**Split demos.** Three beats compare takes: timing (B10), aim (B11) and the three balls (B15). These play side by side in 16:9 and stacked top-to-bottom in 9:16, which suits portrait well.

---

## Long cut (16:9)

Each beat lists the card, the demo, and how the portrait framing differs. Demos are staged and scripted per tick, then rendered once per aspect ratio from the same deterministic run.

### B00 · Cold open (0:00–0:06), no card
- **Demo:** the best goal of the shoot. A spike through the North ring from a 3/4 flank camera (X ≈ 15 m), ring flare, scoreboard ticks.
- **9:16:** a low camera under the ring, with the arch filling the frame top to bottom as the ball passes through.

### Title slate (0:06–0:10)
`VALLEYBALL VERSUS` / `HOW TO PLAY`, over gameplay, in the trailer's hollow impact-word style (the one used for PLAY! and WIN!).

### B01 · THE OBJECT // 01 · ONE POINT PER RING
- **Headline:** PUT THE BALL THROUGH THE RING.
- **Body:** Two giant rings rise from the high ground at each end of the valley. Through the ring is one point.
- **Chips:** TWO RINGS · ONE POINT · EITHER SIDE COUNTS
- **Demo:** a medium-ball volley arcing through the South ring, flank camera so the opening reads.
- **9:16:** the ring alone, framed tall, with the ball entering from the top of frame.
- **Source:** [scoring.js](../../src/mechanics/scoring.js), around line 156. A crossing in either direction scores, and the opening reaches below the turf, so a rolling ball can score.

### B02 · THE FLIP // 02 · NO RESET
- **Headline:** SCORE, THEN SWITCH ENDS.
- **Body:** Every goal flips the target. You now attack the far ring and defend the one you just scored on.
- **Chips:** INSTANT FLIP · NO KICKOFF · PLAY ON
- **Demo:** goal → scoreboard "now attacking" banner → the scorer turns and sprints the other way while the ball is still live.
- **9:16:** a whip-pan from the scored ring down the length of the valley to the far ring.
- **Source:** the flip is unconditional in `recordGoal` (scoring.js:241). The ball is only reset on a manual serve or if it leaves the world ([main.js:1951](../../src/main.js:1951)).

### B03 · THE CLOCK // 03 · REGULATION
- **Headline:** FIVE MINUTES. MOST GOALS WINS.
- **Body:** The clock runs for five minutes of live play. Whoever leads at full time takes the match.
- **Chips:** 5:00 REGULATION · LIVE CLOCK · FULL TIME
- **Demo:** the jumbotron clock ticking under live play, then the full-time buzzer and the victory orbit camera.
- **9:16:** a tight shot on the jumbotron, then the victory orbit.
- **Source:** `durationSeconds: 300`. Overtime is an upcoming feature and isn't in the game yet, so the card says nothing about ties.

### B04 · THE VALLEY // 04 · SUNKEN BASIN
- **Headline:** THE COURT IS A BOWL.
- **Body:** Flat through the middle, climbing steeply toward each ring. Attacks go uphill, and loose balls roll back to the center.
- **Chips:** SUNKEN BASIN · UPHILL ATTACKS · ROLLING RETURNS
- **Demo:** a slow crane down the long axis, then a loose ball rolling back down off the high ground.
- **9:16:** a tall shot looking down the slope from beside the ring, which shows the height change best.

### B05 · ALWAYS LIVE // 05 · GLASS PERIMETER
- **Headline:** NO OUT OF BOUNDS. NO WHISTLES.
- **Body:** Glass walls surround the court, so the ball is always live. Banks off the walls are fair game.
- **Chips:** GLASS WALLS · BALL ALWAYS LIVE · BANK SHOTS
- **Demo:** a hard shot that banks off the side glass and across the goal mouth past a defender.
- **9:16:** a camera behind the defender, with the ball coming off the glass toward the lens.

### B06 · MOVEMENT // 06 · LIVE MOMENTUM
- **Headline:** RUN. SPRINT. JUMP.
- **Body:** Your athlete is a live physics body. Momentum carries, slopes push back, and every landing has weight.
- **Control chips:** `L-STICK · WASD  MOVE` · `LT · SHIFT  SPRINT` · `A · SPACE  JUMP`
- **Demo:** an over-the-shoulder sprint up the slope, then a jump and landing.
- **9:16:** low and behind, with the athlete in the bottom third and the slope rising above.

### B07 · THE CUT // 07 · PLANT & REDIRECT
- **Headline:** OVERRAN IT? CUT.
- **Body:** Plant a foot to kill your momentum and push off in a new direction. It's how you get behind the ball.
- **Chips:** `RB · V  CUT` · PLANT & PUSH · GRIPS ON SLOPES
- **Demo:** a sprint past the ball, a cut, a re-approach from behind it, then a strike. All in one continuous take, shown twice: wide, then tight on the plant foot.
- **9:16:** top-down or high-angle, so the change of direction reads as a sharp V.
- **Source:** `action.cut`: it absorbs 95% of momentum, pushes off in the stick direction, and holds a cleat grip on slopes. It has an 80-tick (1.3 s) cooldown.

### B08 · STRIKING // 08 · KICK OR VOLLEY
- **Headline:** ONE BUTTON. TWO STRIKES.
- **Body:** Ball at your feet? Volley becomes a lofted kick. Ball above your hips? It's a two-handed volley.
- **Chips:** `B · E / L-CLICK  VOLLEY` · LOW = KICK · HIGH = VOLLEY
- **Demo:** a kick that lifts a rolling ball, then a volley of the same ball on its way down.
- **9:16:** a side-on profile, with the athlete in the bottom half and the ball's arc rising through the top.
- **Source:** `strike.kickBelowHips`, the kick row (55° loft) and the volley row (46°).

### B09 · THE SPIKE // 09 · AIR TIMING
- **Headline:** GET UP. SPIKE DOWN.
- **Body:** The spike drives the ball downward. Jump, meet it at the top of your leap, and hammer it at the ring.
- **Chips:** `Y · R / R-CLICK  SPIKE` · JUMP + SPIKE · DRIVEN DOWN
- **Demo:** the vertical spike camera looking up at about 35°, with the athlete against the arena ceiling.
- **9:16:** this is portrait's best shot. Full jump height in frame, from feet to apex.
- **Source:** spike row, launched 18° below horizontal. (A spike is not faster than a volley, which launches at 24.5 m/s against the spike's 22, so no "hardest hit" claims.)

### B10 · TIMING // 10 · SWEET SPOT
- **Headline:** HIT THE SWEET SPOT.
- **Body:** Every strike has a perfect moment. Nail it for full power. Mistime it and the ball leaves at a third of the speed.
- **Chips:** PERFECT WINDOW · FULL POWER · LATE = WEAK
- **Demo:** split screen. The same setup run twice from the same seed: a perfect press against a late press.
- **9:16:** stacked, perfect on top and late on the bottom.
- **Source:** `strike.qualityPerfectTicks` (±5 ticks) and `qualityFloor: 0.35`.

### B11 · AIM // 11 · NO AUTO-AIM
- **Headline:** NOBODY AIMS FOR YOU.
- **Body:** The ball goes where you're facing and steering when you press. Get your feet right before you swing.
- **Chips:** YOUR AIM ONLY · POSITION FIRST · ZERO MAGNETISM
- **Demo:** split screen. A volley from a square stance goes in, and the same volley from a sideways stance goes wide.
- **9:16:** stacked.
- **Source:** the aim latches at the press (60% stick heading, 40% facing), and `aimMagnetism` is 0 in all three assist presets. See open item 4 for the wording on "forgiveness".

### B12 · THE DIVE // 12 · LAST-DITCH SAVE
- **Headline:** LAY OUT FOR IT.
- **Body:** Dive to throw your whole body at a ball you can't reach on foot. A good dive pops it back into play.
- **Chips:** `X · Q  DIVE` · FULL LAYOUT · 1 S RECOVERY
- **Demo:** a low turf camera as a falling spike is dug off the turf.
- **9:16:** low and head-on, with the athlete flying toward the lens.

### B13 · THE BRACE // 13 · AGILE BLOCK (pending open item 5)
- **Headline:** BRACE. KEEP MOVING.
- **Body:** Hold Brace to get your hands up. The ball rebounds off you, and you never stop moving.
- **Chips:** `LB · G  BRACE` · MOVE WHILE BRACED · BRACE + DIVE = INTERCEPT
- **Demo:** a braced athlete shuffles across and blocks a shot back out, then a brace-dive intercept.
- **9:16:** front-on, from the shooter's side.
- **Source:** `action.brace*`: redirects at a 25° loft, and pose share is capped at 0.4 so locomotion stays live. The intercept dive is the brace + dive combo.

### B14 · CONTACT // 14 · FULL PHYSICS
- **Headline:** IT'S FULL CONTACT.
- **Body:** Slide in at speed to sweep an opponent's legs. Big hits put athletes down, and they climb back up on their own.
- **Chips:** `RT · C  SLIDE` · SLIDE TACKLES · KNOCKDOWNS
- **Demo:** a slide tackle, the ragdoll collapse, then the physical stand-up.
- **9:16:** low side-on for the tackle, then a tight shot on the stand-up.
- **Source:** the slide tackle triggers above 5.5 m/s ([main.js:1606](../../src/main.js:1606)). Impact knockdowns are weighted by body part, with head hits counting double.

### B15 · THE BALLS // 15 · THREE SIZES (10.8 s)
- **Headline:** THREE BALLS. THREE GAMES.
- **Body:** Small is quick and twitchy. Medium is the match ball. Large is huge, forgiving, and made for long rallies.
- **Chips:** SMALL 0.4 M · MEDIUM 1.0 M · LARGE 1.5 M
- **Demo:** a triptych. The same staged kick on each ball, side by side.
- **9:16:** a vertical stack of three.

### B16 · PUT IT TOGETHER // 16 · THE CLASSIC GOAL
- **Headline:** VOLLEY IT UP. SPIKE IT IN.
- **Body:** Pop the ball high with a volley, chase it down, jump, and spike it through the ring.
- **Chips:** VOLLEY · JUMP · SPIKE · GOAL
- **Demo:** the full combo in one take, then a replay from the flank camera.
- **9:16:** a single take with the camera rising alongside the jump.
- **Source:** this is the first tip on the in-game How to Play screen.

### B17 · MODES // 17 · PICK YOUR FIGHT
- **Headline:** PLAY YOUR WAY.
- **Body:** Go 1v1 against the AI on Easy, Medium or Hard, take on a friend locally, or train in Practice with all three balls.
- **Chips:** VS AI · LOCAL 1V1 · PRACTICE
- **Demo:** quick menu flashes, then gameplay.
- **9:16:** the same.
- **2v2:** upcoming and not in the game yet, so the card doesn't mention it.

### Outro (about 8 s)
The trailer's galaxy title card, unchanged (`captures/trailer/title_card_galaxy.png`). It already reads PLAY FREE NOW! VALLEYBALLVS.COM and INAUGURAL CHAMPIONSHIP DECEMBER 27, 2026.

---

## TikTok series (9:16)

Each part opens on its best moment with the hook headline and no setup. Then come the beats, then a 2–3 s end slate on the vertical galaxy card, which already carries the logo, the CTA and the championship date. Above the logo it shows `PART n/8 · NEXT UP` and the next part's hook. Part 8 ends on `SERIES COMPLETE` / `NOW GO PLAY.`

| Part | Hook headline | Beats | Length |
|---|---|---|---|
| 1 | HOW DO YOU EVEN SCORE? | B01, B02, B03 | ~32 s |
| 2 | THERE'S NO OUT OF BOUNDS | B04, B05 | ~24 s |
| 3 | THE MOVE EVERY PRO USES | B06, B07 | ~24 s |
| 4 | KICK OR VOLLEY? | B08, B10 | ~24 s |
| 5 | HOW TO SPIKE | B09, B11, B16 | ~32 s |
| 6 | HOW TO DEFEND | B12, B13 | ~24 s |
| 7 | CAN YOU TACKLE? | B14 | ~18 s |
| 8 | PICK YOUR BALL | B15, B17 | ~25 s |

Portrait copy is the long cut's headline plus body. `scripts/generate_explainer_cards.mjs` fails the render if any block outgrows its line budget: 2 headline lines and 4 body lines in portrait, 1 and 2 in landscape. Three headlines needed a shorter portrait version:

- **B01:** THROUGH THE RING.
- **B03:** 5 MINUTES. MOST GOALS WINS.
- **B05:** NO OUT OF BOUNDS.

Each part label reads `PART n/8 · <topic>`. The topics are SCORING, THE COURT, MOVEMENT, STRIKING, ATTACKING, DEFENDING, CONTACT, and BALLS & MODES.

---

## Music

The game's music folder holds one real song, not five. `track_01` through `track_05` are byte-identical copies of "Arena of Frost (Debut Anthem)": 3:54 long, about 133 BPM, and flat loudness (−14.1 LUFS, loudness range 2.2 LU). It is a different song from Neon Velocity, though the two share a tempo.

- **Recommendation:** use Arena of Frost under the long cut. It's long enough for 3:00 without looping, it's the game's own music, and it sits on the same 1.8 s bar grid as the trailer. Its even loudness suits a bed for reading.
- **Not recommended:** looping Neon Velocity (1:30). Its build-and-drop shape is made for a trailer and would fight the explainer's pacing.
- **When to get a fresh track:** only if Arena of Frost doesn't suit the explainer when you listen to it. These numbers came from measuring the files; I can't listen.
- **TikTok:** render each part twice, once with the music and once with game sound only, so you can add a trending sound in the app.
- **Rights:** whichever track goes on TikTok has to be one you hold the rights to, or TikTok may mute it.

## Open items, where the existing copy disagrees with the code

1. **Overtime: resolved.** Overtime is upcoming, so B03 says nothing about it. The in-game How to Play screen still advertises "Golden Goal Overtime" as if it exists today (the code ends at FULL TIME whatever the score, [scoring.js:146](../../src/mechanics/scoring.js:146)), so that screen needs a separate fix.
2. **Slide tackle speed.** How to Play says tackles need more than 7 m/s; the code uses 5.5. The cards give no number.
3. **CTA: resolved.** ValleyballVS.com and the December 27, 2026 championship are confirmed, and both are already on the galaxy outro cards. The "3,500 years / ancient stone-ring" lore is still unconfirmed and isn't used anywhere in the explainer.
4. **Assist default.** AGENTS.md says Pure Sim is the default. tuning.js ships Standard as the default, which adds 0.45 m of reach forgiveness but no aim help. The cards claim only "no auto-aim", which is true for all three presets.
5. **Brace.** It's implemented (G / RB) but missing from the How to Play controller diagram, and AGENTS.md still lists it as roadmap. Should B13 stay in?
6. **2v2: resolved.** Upcoming, so B17 leaves it out.
7. **Jump height.** How to Play says "Hold Space/A to jump higher". I couldn't find variable jump height: the jump is a fixed impulse. Worth checking before anyone quotes it.
8. **Argon trailer copy, dropped.** "Small Football for aerial speed / Big Ball for heavy hits" contradicts the in-game ball descriptions, and "carve the channels" describes no mechanic I could find (the streams are visual). Neither is used here.

---

## Production v1: full-length cut on "Maximum Velocity" (3:40)

This cut uses the whole song, with no splice: 137.57 BPM, bar 1 at 0.192 s, 125 bars plus a hard stop. Each card starts on a bar line, and each section of the song carries one chapter. The card order changed in two places:
- **Modes is now card 16.**
- **Card 17 is now a goal montage on the MAXIMUM DROP:** "POSITION. STRIKE. SCORE." The game has no soft touch, so the self-set "volley it up, spike it in" isn't something a player can do.

| Segment | Time | Card | Shots |
|---|---|---|---|
| cold open + title | 0:00–0:14.2 | HOW TO PLAY slate | crane → goal (ring cam) → ring orbit |
| b01 | 0:14.2–0:22.9 | The object | approach → ring |
| b02 | 0:22.9–0:31.6 | The flip | goal → valley view as play turns |
| b03 | 0:31.6–0:42.1 | The clock | north jumbotron → live play |
| b04 (drop) | 0:42.1–0:52.5 | The valley | crane along the bowl |
| b05 | 0:52.5–1:03.0 | Always live | bank off the east glass |
| b06 | 1:03.0–1:13.5 | Movement | sprint + jump, over the shoulder |
| b07 | 1:13.5–1:23.9 | The cut | 123° cut at 5.3 m/s, high side |
| b08 (hook) | 1:23.9–1:34.4 | Strikes | kick → volley |
| b09 | 1:34.4–1:44.9 | The spike | lead-in → low spike angle (staged) |
| b10 | 1:44.9–1:55.3 | Timing | split: q 1.0 volley vs q 0.35 volley |
| b11 | 1:55.3–2:05.8 | Aim | striker from behind → ring |
| b12 (rally) | 2:05.8–2:16.3 | The dive | low front angle, dive touches the ball |
| b13 | 2:16.3–2:26.7 | The brace | lead-in → block and rebound (staged) |
| b14 | 2:26.7–2:37.2 | Contact | slide tackle, knockdown, stand-up |
| b15 | 2:37.2–2:49.4 | The balls | triptych: kicks with small / medium / large |
| rally montage | 2:49.4–3:01.6 | — | 7 one-bar cuts |
| b16 | 3:01.6–3:13.8 | Modes | three pairings |
| recap (breakdown) | 3:13.8–3:19.1 | — | 12 one-beat cuts |
| b17 (MAXIMUM DROP) | 3:19.1–3:33.0 | Position. Strike. Score. | 4 goals, 2 bars each |
| outro | 3:33.0–3:39.8 | galaxy card (CTA + Dec 27) | — |

**Footage.**
- **Real bot play:** almost everything is unedited hard-vs-hard bot play, recorded from nine deterministic matches. Each moment is rendered twice from the same simulation, with a camera authored for 16:9 and another for 9:16.
- **Staged shots:** the bots never spiked and never brace, so three shots are staged. Even then, every outcome is real physics through the game's normal input path.
  - **The spike (b09):** a scripted player input (jump, then spike) on a lobbed setup ball.
  - **The spike goal (b17, first goal):** the same scripted jump and spike on a lobbed setup ball.
  - **The brace (b13):** brace is held, and the ball is fired at the athlete.
- **The lobbed goal (b17, third goal):** a lobbed setup ball, then a natural bot volley.
- **Hidden placements:** every placement of the setup ball sits behind a cut.

**TikTok.** Eight parts of 2 + 4n + 2 bars, each cut from the same 9:16 footage. Each part opens on a moment it doesn't repeat, and its music excerpt comes from the song section that matches its energy. Every part also comes in a no-music version. Two bonus shorts sit at the same music position as in the long cut:
- **The payoff:** the recap plus the goal montage on the MAXIMUM DROP.
- **No whistles:** the rally montage.
