# MASTER DIRECTORIAL & ENGINEERING HANDOVER PROMPT FOR GEMINI ARGON
## Project: Valleyball Versus — Official Debut Gameplay Trailer (Full Ground-Up Redirection)
**Target Model:** Gemini 4 Argon (Antigravity Agentic Directorial & Coding Mode)  
**Workspace Root:** `C:\Users\portt\Dev\Valleyball\Valleyball-Versus-AI`  
**Target Video Duration:** Exactly 94.500 Seconds (5,670 Frames @ 60.0000 FPS CFR)  
**Deliverables:**
1. Broadcast Master 1080p60 MP4: `captures/trailer/valleyball_versus_official_trailer_1080p60.mp4` (CRF 17, High Profile, 320k AAC)
2. Social Web Cut 1080p60 MP4: `captures/trailer/valleyball_versus_official_trailer_social_1080p.mp4` (CRF 24.5, <25 MB for Discord/Twitter)

---

## 1. Executive Mission & Directorial Mandate

You are taking over as the Lead Creative Director and Video Production Engineer for the official debut gameplay trailer of **Valleyball Versus** (v0.3.4)—a high-velocity, futuristic arcade volleyball game powered by deterministic 3D ragdoll physics in Three.js and Rapier 3D.

### The Directive: Scrap and Re-Record
**All previous trailer footage and the existing `src/visuals/trailerDirector.js` are to be scrapped.** 
The previous attempt failed because:
1. **Shots Lingered Too Long:** Camera angles were held for 10–11 seconds from far away, staring at mostly empty court space while high-energy 133 BPM electronic music played.
2. **Artificial Scripting on Camera:** The previous director attempted an unbroken 94-second match while forcing 6 goals on rigid timers. This required repeatedly teleporting athletes and hard-launching the ball on-screen, producing stiff, unnatural wooden mannequins waiting for cues rather than explosive physical action.
3. **Flawed Perspective on Torus Hoops:** The Torus goal hoops sit in the $X = 0$ plane (normal vector along the $X$-axis). Looking down the $Z$-axis shows the hoop *edge-on* as a thin arch. To see the monumental 3D ring and circular aperture opening, the camera **must always be positioned at a 3/4 flank ($X \approx 12\text{m} - 16\text{m}$)** looking into the aperture.

### The New Directorial Paradigm: Fast-Paced, Beat-Quantized Rhythmic Action
Your mission is to rewrite `src/visuals/trailerDirector.js` from scratch and execute a fresh, deterministic offline capture that feels like an authentic, high-octane sports music video (EA Sports / Rocket League / Nike commercial):
- **Cuts Are Locked to the Music Beat Grid:** 1 musical bar = **exactly 1.800 seconds** (108 frames @ 60 FPS at 133.333 BPM). After the beat drop at 44.20s, every single shot lasts only **1.800s (or 0.900s half-bars during the climax blitz)**.
- **Pre-Stage Off-Camera Before Cuts:** When a hard cut occurs, athletes and the ball are pre-staged with live physical velocity so the cut snaps directly to the peak kinetic impact of that stunt (a diving save, an aerial spike, a supersonic banked wall carom, or a through-aperture goal). The audience **never sees athletes setting up, idling, or teleporting**.
- **Close, Dynamic Cameras:** Ground-level low-turf raking glides ($y = 1.5\text{m} - 1.8\text{m}$), tight over-the-shoulder sprint chases, vertical aerial spike cams looking upward at 35°, and 3/4 flank Torus aperture views.

---

## 2. Invariable Technical Baseline & Court Geometry

Before authoring a single coordinate, you must understand the exact physics and asset dimensions measured from `public/models/arena.glb`:

### A. The Arena Bowl Elevation (The Court is NOT Flat!)
* The court floor is an inclined parabolic bowl:
  * Midcourt ($Z \approx 0$): $Y \approx 0.90\text{m} - 1.0\text{m}$.
  * At $Z = \pm 31.5\text{m}$: Turf rises to $Y \approx 5.08\text{m}$.
  * At $Z = \pm 35.8\text{m}$: Turf rises to $Y \approx 6.81\text{m}$.
  * Under the Torus Hoops ($Z = \pm 40.0\text{m}$): Turf peaks at **$Y = 8.212\text{m}$**!
* **CRITICAL INVARIANT:** Never author athlete feet or ball positions below the court terrain elevation `getCourtFloorY(x, z)`. Any coordinate authored below this elevation places the body inside the Rapier trimesh collider, causing violent physics repulsion or ground-clipping. Always maintain at least $0.9\text{m}$ clearance above the local floor.

### B. Torus Goal Hoop Geometry
* Both monolithic rings sit in the **$X = 0$ plane**:
  * North Torus Center: $(X = 0, Y = 10.000\text{m}, Z = -40.000\text{m})$
  * South Torus Center: $(X = 0, Y = 10.000\text{m}, Z = +40.000\text{m})$
  * Inner Aperture Radius: $R = 4.667\text{m}$ (Tube thickness: $0.333\text{m}$).
  * Top of inner rim: $Y = 14.667\text{m}$. Bottom of inner rim: $Y = 5.333\text{m}$.
* **Scoring Plane:** The disc is in the $X = 0$ plane. To pass cleanly through the hoop and trigger the scoring engine (`src/mechanics/scoring.js`), the ball must travel from $+X$ to $-X$ (or $-X$ to $+X$), crossing $X = 0$ inside $(Y - 10)^2 + (Z - (\pm 40))^2 \le (4.667)^2$.
* When a goal is scored:
  * `testHoopCrossing` registers the score.
  * `goalCelebration.js` ignites an additive energy flare ring at the aperture.
  * Stadium scoreboards flash celebratory banners.

### C. Character Builds & Series 1 Headwear Pack
* **Character Builds:** `masculine`, `feminine`, `classic`.
* **Headwear Pieces** (configured via `athlete.setHeadwear(id)`):
  * `wrestler_bands`: Football Helmet (Gridiron Horns) — **Reserved for Red Home Bot**.
  * `wicket_grill`: Cricket Helmet (Wicketkeeper Grill) — **Reserved for Blue Away Bot**.
  * `sensor_visor`: Cybernetic Wrap Visor.
  * `couture_wrap`: High-Fashion Headwrap / Scarf.
  * `rigger_band`: Industrial Welder Headband.
  * `ouendan_knot`: Japanese Cheer Bandana.
  * `terrace_visor`: Retro Translucent Sunshade.
  * `cursor_cap`: Athletic Baseball Cap.
  * `manager_cap`: Flat-Peaked Coaching Cap.
  * `broadcaster_mic`: Esports Headset & Boom Mic.
* **Official Brand Palettes:**
  * Crimson Red: `0xD90429` | Royal Blue: `0x1D4ED8`
  * Volt Gold: `0xFFD000` | Ion Cyan: `0x00E5FF`
  * Emerald Green: `0x10E56A` | Solar Blaze: `0xFF6B00`
  * Neon Violet: `0x8B5CF6` | Frost White: `0xF8FAFC`
  * Obsidian Black: `0x0F172A` | Deep Indigo: `0x6B11FF`

---

## 3. Audio Beat-Grid & Five-Phase Editorial Blueprint

The trailer is cut in mathematical sync with **"Neon Velocity"** (`public/audio/music/track_trailer_neon_velocity.mp3`):
* **BPM:** 133.333 (2.222 beats/sec)
* **Quarter Note (1 Beat):** 0.450s (27 frames @ 60 FPS)
* **Half-Bar (2 Beats):** 0.900s (54 frames @ 60 FPS)
* **1 Bar (4 Beats):** 1.800s (108 frames @ 60 FPS)
* **4 Bars (Phrase):** 7.200s (432 frames @ 60 FPS)

```
00:00.00 ──────────────────────────────── 00:44.20 ────────────── 01:02.20 ────────────── 01:16.60 ─────── 01:28.00 ───────── 01:34.50
[ PHASE 1: MONUMENTAL OVERTURE         ] [ THE DROP!             ] [ PHASE 3: STACCATO     ] [ PHASE 4:    ] [ PHASE 5: GALAXY ]
[ Architectural Sweeps + Hero Portraits ] [ 1-Bar Action Cuts     ] [ Half-Bar & 1/4 Blitz  ] [ Climax Goal ] [ Title Card Hold ]
[ Red vs Blue Rivalry Established       ] [ Rapid Stunt Escalation] [ Apex Rhythm Frenzy    ] [ & Ascension ] [ Platform Outro  ]
```

### Phase 1: Monumental Architectural Overture & Contender Intro (0:00.00 – 44.20s)
*Tone: Grand, atmospheric, Kubrickian geometric scale, rising tension.*
* **0:00.00 – 03.60s (2 Bars) | Shot 1: The North Torus Cathedral Arch**
  * Low-angle perspective looking North-Up through the towering Torus aperture.
* **03.60s – 07.20s (2 Bars) | Shot 2: Red Contender Macro Hero Portrait**
  * High-contrast golden-ratio closeup framing the Masculine Red Contender in the Football Helmet (`wrestler_bands`). Headroom $Y = 1.70\text{m} \to 2.05\text{m}$.
* **07.20s – 10.80s (2 Bars) | Shot 3: Blue Contender Macro Hero Portrait**
  * Symmetrical closeup framing the Masculine Blue Contender in the Cricket Helmet (`wicket_grill`).
* **10.80s – 18.00s (4 Bars) | Shot 4: Stream Heads & High Ramps Glide**
  * Sweeping elevated 3/4 banking descent along the high stream drop ramps into the valley basin.
* **18.00s – 25.20s (4 Bars) | Shot 5: Turf-Level Sideline Glide**
  * Ultra-low raking dolly at $Y = 1.85\text{m}$ tracking the 18m center tactical circle.
* **25.20s – 36.00s (6 Bars) | Shot 6: Monumental Stadium Boom Arc**
  * High orbital crane ($Y = 24\text{m} \to 18\text{m}$) sweeping 180° around the arena, displaying both glowing Torus hoops and stadium floodlights.
* **36.00s – 44.20s (4.5 Bars) | Shot 7: Low Pre-Drop Tension Push**
  * Low ground push tracking forward toward the center circle as the snare roll accelerates in tempo toward the drop.

### Phase 2: Rhythmic Action Escalation (44.20s – 62.20s | Exactly 1.800s per Cut)
*Tone: Maximum athletic velocity, razor-sharp hard cuts strictly quantized to 1.800s bars.*
* **44.20s – 46.00s | Cut 8 (THE DROP!): Over-the-Shoulder Attack Sprint**
  * Instant hard cut on the sub-bass explosion. Tight 3rd-person cam right behind Red sprinting at 15 m/s, launching into an aggressive volley.
* **46.00s – 47.80s | Cut 9 (Bar 1): Low Turf Diving Save**
  * Low-turf raking cam ($Y = 1.6\text{m}$). Blue executes a full-extension turf slide, digging the ball millimeters off the turf.
* **47.80s – 49.60s | Cut 10 (Bar 2): Vertical Aerial Spike Leap**
  * Vertical Spike Cam looking up at 35°. Attacker leaps 4 meters into the rafters against the neon arena ceiling and hammers the ball down.
* **49.60s – 51.40s | Cut 11 (Bar 3): Parabolic Banked Wall Carom**
  * Banked Wall Curve Cam. Ball rockets around the steep curved bowl wall at 28 m/s, leaving spark trails.
* **51.40s – 53.20s | Cut 12 (Bar 4): 3/4 Flank South Torus Aperture Goal**
  * 3/4 flank view looking cleanly through the South Torus ring ($X = 14\text{m}$). Ball blasts through the opening; gold celebratory shockwave detonates; scoreboard updates.
* **53.20s – 62.20s | Cuts 13–17 (Bars 5–9): Rapid Stunt Exchanges**
  * Cuts strictly every 1.800s (53.20s, 55.00s, 56.80s, 58.60s, 60.40s).
  * Rapidly cycles diverse team palettes (Volt Gold, Ion Cyan, Emerald, Obsidian) and headwear pieces (`sensor_visor`, `couture_wrap`, `ouendan_knot`, `broadcaster_mic`). Alternates Small Ball speed and Large Ball heavy impacts.

### Phase 3: Rapid Staccato Climax Blitz (62.20s – 76.60s)
*Tone: Sensory overload, strobe-like cutting cadence.*
* **62.20s – 73.00s | The Half-Bar Blitz (Cuts every 0.900s / 12 Cuts)**
  * Cuts on every half-bar: 62.20, 63.10, 64.00, 64.90, 65.80, 66.70, 67.60, 68.50, 69.40, 70.30, 71.20, 72.10.
  * Staccato athletic impacts: cleat cut, mid-air block clash, desperation dive, wall rebound, supersonic spike.
* **73.00s – 76.60s | Apex Eighth-Note Frenzy (Cuts every 0.450s down to 0.225s)**
  * Rapid micro-cuts matching the rising synth frenzy: ball compression, athlete eyes, turf tear, rim reflection.

### Phase 4: Climax Torus Goal & Celestial Ascension (76.60s – 83.80s)
*Tone: Epic release, athletic triumph.*
* **76.60s – 80.20s | Cut 18: Climax North Torus Goal (Red vs Blue Returns)**
  * Heavy downbeat impact. 3/4 Flank North Torus Cam ($X = 16\text{m}, Y = 9.5\text{m}, Z = -32\text{m}$, FOV 48°).
  * Red spikes from the flank; the ball rockets cleanly through the North Torus aperture at $Y = 10.3\text{m}$. Giant ring energy burst flares; stadium sirens sound; scoreboard hits 4-2.
* **80.20s – 83.80s | Cut 19: Celestial Ascension Arc**
  * Soaring orbital crane ascending from $Y = 16\text{m} \to 36\text{m}$, radius expanding to 38m, looking down on the lit stadium.

### Phase 5: Brand Galaxy Outro & Title Card Lock (83.80s – 94.50s)
* **83.80s – 94.50s:** Fade into cosmic deep space galaxy title card with *Valleyball Versus* logo lock and platform availability tags as final synth chords ring out.

---

## 4. Engineering Architecture & Capture Harness

The project uses an offline, deterministic frame-by-frame stepping pipeline that guarantees **zero dropped frames, zero duplicate frames, and 60.0000 FPS CFR**:

### Key Files in Codebase:
1. `src/visuals/trailerDirector.js`: The class that controls camera transforms, shot cut states, and athlete/ball staging at each elapsed time `t`.
2. `scripts/capture-trailer-video.mjs`: The Node.js harness that orchestrates Vite, GPU-accelerated Chromium (Playwright), the HTTP frame streaming receiver, and FFmpeg assembly.
3. `src/main.js`: Boots the game and exposes `window.__vb` (`startMatch`, `stepDeterministicFrame`, `trailerDirector`, `primaryBall`, `athletes`, `scoreboards`).
4. `src/mechanics/scoring.js`: Rapier scoring engine (`testHoopCrossing`).

### How Deterministic Capture Works:
1. `scripts/capture-trailer-video.mjs` spawns Chromium with hardware acceleration locked to NVIDIA GPU:
   `--force_high_performance_gpu`, `--use-gl=angle`, `--use-angle=d3d11`.
2. Chromium navigates to `http://localhost:5183/Valleyball-Versus/`.
3. In-page script halts the real-time loop: `window.__vb.loop.stop()`.
4. The harness steps the engine frame-by-frame for exactly **5,028 gameplay frames** ($dt = 1/60\text{ s}$):
   ```javascript
   window.__vb.stepDeterministicFrame(1 / 60);
   const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.94));
   await fetch('http://127.0.0.1:5189/frame', { method: 'POST', body: blob });
   ```
5. Node HTTP receiver streams binary frames directly into FFmpeg `stdin` (`-f image2pipe -vcodec mjpeg -r 60 -i pipe:0`).
6. FFmpeg post-processing filter composites the 83.8s gameplay stream (5,028 frames) with the 10.7s galaxy title card (642 frames) and audio track (`Neon Velocity`), outputting:
   - **Broadcast Master**: `captures/trailer/valleyball_versus_official_trailer_1080p60.mp4` (CRF 17).
   - **Social Cut**: `captures/trailer/valleyball_versus_official_trailer_social_1080p.mp4` (CRF 24.5, <25 MB).
   - Extracts milestone verification frames to `captures/trailer/milestone_frames/`.

---

## 5. Your Step-by-Step Execution Plan

As Gemini Argon, execute this turnaround systematically:

### Step 1: Wipe Legacy Footage & Clean State
* Clean out stale video deliverables and temporary frame dumps in `captures/trailer/`.
* Preserve only reference stills and audio assets.

### Step 2: Implement the New `TrailerDirector` (`src/visuals/trailerDirector.js`)
* Rewrite `TrailerDirector` following the 5-Phase Rhythmic Blueprint above.
* Implement instantaneous snap cuts on the exact beat timestamps (0.00s, 3.60s, 7.20s, 10.80s, 18.00s, 25.20s, 36.00s, 44.20s, 46.00s, 47.80s, 49.60s, 51.40s, 53.20s, etc.).
* Ensure every shot pre-stages athletes above `getCourtFloorY(x, z)` with forward momentum off-camera, so every cut immediately displays peak physical action.
* Frame all Torus hoop actions from the 3/4 flank ($X \approx 14\text{m} - 16\text{m}$) so the aperture opening is fully visible.

### Step 3: Run Deterministic Capture
* Execute `node scripts/capture-trailer-video.mjs`.
* Ensure all 5,028 frames step deterministically and pipe without errors into FFmpeg.

### Step 4: Verify Deliverables & Quality Gates
* Verify `valleyball_versus_official_trailer_1080p60.mp4` with `ffprobe`:
  - Exactly 5,670 frames (94.500s @ 60.0000 FPS CFR).
  - Audio/visual sync locked to the beat drop at 44.20s.
* Verify `valleyball_versus_official_trailer_social_1080p.mp4`:
  - File size strictly under 25.0 MB (for Discord/Twitter direct upload).
* Inspect milestone stills in `captures/trailer/milestone_frames/`:
  - Contender portraits have golden-ratio headroom.
  - Every goal shot passes cleanly through the Torus aperture.
  - Scoreboards accurately display the match progression.
* Run `npm test` to guarantee all engine tests, character skeleton contracts, and physics boundary checks pass.

Begin execution now.
