/**
 * TEST FIXTURES — harness-only ball placement for scripted scenarios.
 *
 * The court drops balls from 10 m at seeded-random spots, which is right for
 * play and useless for a test that needs a ball to arrive at hand height on a
 * known tick. A fixture places a ball exactly, on a tick boundary, from the URL:
 *
 *   ?balls=1                     only ball 1 (the medium) is live; the others are
 *                                parked and disabled at boot
 *   ?serve=1:0,3.2,0.9@60        at tick 60, ball 1 to (0, 3.2, 0.9), at rest
 *   ?serve=1:0,3.2,0.9:0,2,0@60  ...with velocity (0, 2, 0)
 *   several serves separated by ';'
 *
 * SANCTIONED BY THE SAME RULE AS ?captureTick: it is per-run harness config, it
 * is honoured ONLY in an armed capture run, it acts on a tick boundary before any
 * athlete code runs, and nothing reachable from play input can trigger it. It
 * never touches an athlete body (LAW 1), only balls, through resetBall — the
 * existing sanctioned site — plus one setLinvel for the serve velocity.
 */

function parseVec(text) {
  const parts = text.split(',').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return { x: parts[0], y: parts[1], z: parts[2] };
}

/**
 * @param {string} [search]
 * @returns {{ onlyBalls: number[] | null, serves: {index:number,tick:number,pos:object,vel:object|null}[] } | null}
 */
export function readFixture(search) {
  const params = new URLSearchParams(search ?? window.location.search);
  const onlyRaw = params.get('balls');
  const serveRaw = params.get('serve');
  if (!onlyRaw && !serveRaw) return null;

  const onlyBalls = onlyRaw ? onlyRaw.split(',').map(Number).filter(Number.isInteger) : null;
  const serves = [];
  for (const chunk of (serveRaw || '').split(';')) {
    if (!chunk.trim()) continue;
    const [body, tickText] = chunk.split('@');
    const [indexText, posText, velText] = body.split(':');
    const index = Number(indexText);
    const tick = Number(tickText);
    const pos = posText ? parseVec(posText) : null;
    const vel = velText ? parseVec(velText) : null;
    if (!Number.isInteger(index) || !Number.isInteger(tick) || !pos) {
      console.warn(`[fixture] ignoring malformed serve "${chunk}"`);
      continue;
    }
    serves.push({ index, tick, pos, vel });
  }
  console.log(`[fixture] balls ${onlyBalls ? onlyBalls.join(',') : 'all'}, ${serves.length} serve(s)`);
  return { onlyBalls, serves };
}

/**
 * Called from fixedUpdate step 2, after the watchdog, in armed runs only.
 * @param {ReturnType<typeof readFixture>} fixture
 * @param {number} tick
 * @param {object[]} balls
 * @param {(ball: object, tick: number, pos: object) => void} resetBall
 */
export function applyFixtureServes(fixture, tick, balls, resetBall) {
  if (!fixture) return;
  for (const s of fixture.serves) {
    if (s.tick !== tick) continue;
    const b = balls[s.index];
    if (!b) continue;
    resetBall(b, tick, s.pos);
    if (s.vel) b.body.setLinvel(s.vel, true);
    console.log(`[fixture] serve ball:${b.id} at tick ${tick}`);
  }
}

/** True when the fixture parks this ball for the whole run. */
export function fixtureParksBall(fixture, index) {
  return !!(fixture && fixture.onlyBalls && !fixture.onlyBalls.includes(index));
}
