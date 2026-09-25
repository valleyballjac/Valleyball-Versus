# The 10 Architectural & Physics Invariants

Every engineer, AI model, or contributor working on Valleyball must adhere to these 10 non-negotiable invariants. Any code that violates them must be rejected.

---

## The 7 Core Laws of the Simulation

### Law 1 — Physics Owns Momentum; Animation Owns Pose
* The athlete's base is a dynamic Rapier rolling sphere driven **solely by torque and physical impulses**.
* **Forbidden**: Never write position (`setTranslation`) or velocity (`setLinvel`) directly to an athlete body during active gameplay. These calls are permitted only during initial match spawn or catastrophic out-of-bounds watchdog teleports.
* In a strike, the physical impulse is applied **to the ball**, never directly to the striking hand or athlete root.

### Law 2 — World-Space PD Tracking Only
* The physical ragdoll chases the invisible kinematic ghost rig exclusively via proportional-derivative (PD) servos in world space.
* **No Joint Motors**: Do not use Rapier joint motors or local-frame torque servos. All tracking impulses are evaluated pre-impulse and scaled by individual bone mass ($F = m \cdot a$).

### Law 3 — Clamped Damping Discipline
* All gameplay damping must pass through `applyClampedLinearDamping` and `applyClampedAngularDamping` (`src/sim/damping.js`).
* Damping impulses can at most cancel existing relative velocity; they can **never** inject energy, reverse direction, or overshoot zero.

### Law 4 — One Scalar Balance Authority; No Boolean State Machines
* `tracker.weight` ($0.0 \to 1.0$) is the sole balance and recovery authority.
* **Forbidden**: Never introduce boolean state machines for the character (e.g. `isJumping`, `isKnockedDown`, `isRecovering`). Use continuous phase floats (`slidePhase`, `divePhase`) and integer tick timestamps (`lastJumpTick`).
* Blend shares must continuously sum to 1.0:
  $$\text{standUp} > \text{action} > \text{airborne} > \text{locomotion} + \text{idle}$$

### Law 5 — Zero Root Motion (L5 Invariant)
* The horizontal translation axes of the character's hips bone are stripped to bind space on every tick.
* Residual horizontal root motion must measure strictly `0.0000 m`.

### Law 6 — Absolute Determinism & Fixed 60 Hz Timestep
* The simulation steps strictly at 60 Hz ($dt = 1/60\,\text{s}$).
* **Forbidden**: Never use `Date.now()`, `performance.now()`, `Math.random()`, or non-deterministic hash iteration inside `src/sim/`, `src/mechanics/`, or `src/ai/`.
* All simulation timing is tracked via integer tick counters (`tick`). Physics verification runs (`npm run determinism`) must yield byte-identical SHA-256 hashes across independent runs.

### Law 7 — Decoupled High-Frequency HUD
* High-frequency telemetry (game clock, coordinates, speedometers) must never force re-renders or texture uploads of background meshes.
* Clocks and dynamic HUD elements must use dedicated micro-canvases, shared textures, or DOM overlay elements.

---

## The 3 Modern Additions & Post-Mortem Hard Rules

### Invariant 8 — Jumbotron Upload Budget & Zero Goal GPU Stalls
* **Post-Mortem Finding**: During celebrations, flashing scoreboard canvases triggered synchronous `gl.texImage2D` uploads across 6 high-resolution stadium displays ($1024 \times 512$ and $2048 \times 256$), causing massive multi-frame PCIe stalls.
* **The Rule**: Scoreboard texture uploads must strictly adhere to the `displayCoordinator` round-robin budget (at most 1 texture upload per frame). Flash effects during goals must be driven by material uniforms (color / emissive intensity), **never** by redrawing full canvas pixel buffers in the render loop.
* Pre-warm all celebration lights at scene boot; never toggle dynamic `PointLight.visible` at runtime to prevent shader recompilation stalls.

### Invariant 9 — Procedural IK Limitations on Mixamo Armatures
* **Post-Mortem Finding**: Applying unconstrained two-bone procedural IK to Mixamo shoulder bones (`mixamorig:LeftArm` on $+X$ vs `mixamorig:RightArm` on $-X$) conflicted violently with 2D blend-space cycles, creating 180° quaternion singularities and ragdoll flailing.
* **The Rule**: Do not attach procedural reaching IK to upper-body limbs without dedicated, authored base poses and explicit joint angle limits. Athletes must never be locked into rigid, non-mobile defensive poses that interrupt locomotion.

### Invariant 10 — Court Floor Trimesh Weld (`FIX_INTERNAL_EDGES`)
* All authored trimesh colliders for the playing court surface must be initialized with `RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES`.
* Internal edges between adjacent coplanar triangles create ghost contact ridges that inject phantom kinetic energy. `FIX_INTERNAL_EDGES` welds internal edges into smooth collision manifolds.
* All line-decal visual meshes (`M_Lines*`) must remain classified as **scenery / render-only** and excluded from Rapier physics colliders.

---

## 🧹 Memory & Zero Allocation Invariant in Tick Loops

To ensure locked 60+ FPS on all devices without garbage collection spikes:
* **Zero Allocations in Fixed Update**: Never allocate `new THREE.Vector3()`, `new THREE.Quaternion()`, `new Array()`, or closure functions inside `fixedUpdate`, `applyTracking`, `runActions`, or `runStrikes`.
* Use module-scoped scratch variables (`_v1`, `_q1`, `_matrix`) initialized at file boot.
