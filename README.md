# Valleyball Versus (v0.2.0)

**Valleyball Versus** is a high-velocity 3D arcade sports game built with deterministic [Rapier3D](https://rapier.rs/) physics, [Three.js](https://threejs.org/) WebGL rendering, and procedural ragdoll animation.

🎮 **[Play Live on GitHub Pages](https://valleyballjac.github.io/Valleyball-Versus/)**

---

## Features & Modes

- **1v1 Local Versus Match**:
  - Full two-player splitscreen multiplayer with independent player cameras and customizable athlete builds (`Classic`, `Masculine`, `Feminine`).
  - Match Ball selection (`Official Match`, `Heavy Striker`, `Float Server`).
  - Dynamic Target Goal Switching: Attacking ends flip dynamically across the arena after every goal scored, synchronized across end boards, ribbon scoreboards, and player cameras.
- **Practice Sandbox**:
  - Solo training mode to master movement, slides, dives, volleys, and aerial power spikes.
- **Hustle Board Telemetry**:
  - Post-match performance analytics across a 10-metric ROYGBIV spectrum: Goals, Power Spikes, Opp Circle Attacks, Sweet Spot Hits, Strikes (Hits/Whiffs), Own Circle Defense, Strike Accuracy, Touches, Ground Dives, and Diving Hits/Saves.
- **Performance Engineering**:
  - Decoupled Micro-Clock Overlay architecture providing hitch-free 60+ FPS gameplay with 99.5% scoreboard PCIe bus bandwidth reduction.
- **Visual Design**:
  - Sleek Black & White high-contrast interface accented with signature iridescent Valleyball rainbow styling.

---

## Controls Reference

Valleyball Versus supports full dual-gamepad input (Xbox, PlayStation, standard XInput) as well as split-keyboard and mouse controls.

| Action | Player 1 (Keyboard & Mouse) | Player 2 (Keyboard) | Gamepad (Xbox / PlayStation) |
|---|---|---|---|
| **Move** | <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> | <kbd>I</kbd> <kbd>J</kbd> <kbd>K</kbd> <kbd>L</kbd> | Left Stick |
| **Look / Aim** | Mouse Look | <kbd>Arrow Keys</kbd> | Right Stick |
| **Jump** | <kbd>Space</kbd> | <kbd>Num 0</kbd> | <kbd>A</kbd> / <kbd>✕</kbd> |
| **Sprint** | <kbd>Shift</kbd> (Hold) | <kbd>Right Ctrl</kbd> | Left Trigger (<kbd>LT</kbd> / <kbd>L2</kbd>) |
| **Slide** | <kbd>C</kbd> | <kbd>Num .</kbd> | Right Trigger (<kbd>RT</kbd> / <kbd>R2</kbd>) |
| **Dive** | <kbd>Q</kbd> | <kbd>U</kbd> | <kbd>X</kbd> / <kbd>□</kbd> |
| **Volley / Kick** | <kbd>E</kbd> | <kbd>O</kbd> | <kbd>B</kbd> / <kbd>○</kbd> |
| **Power Spike** | <kbd>R</kbd> | <kbd>P</kbd> | <kbd>Y</kbd> / <kbd>△</kbd> |
| **Camera Toggle** | <kbd>Tab</kbd> | <kbd>]</kbd> | D-Pad Up / Down |
| **Splitscreen Mode** | <kbd>V</kbd> | — | — |
| **Pause / Menu** | <kbd>Esc</kbd> | — | <kbd>Start</kbd> / <kbd>Options</kbd> |
| **Reset Ball (Practice)** | <kbd>B</kbd> | — | <kbd>Back</kbd> / <kbd>Select</kbd> |

---

## Development & Local Setup

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- `npm`

### Installation & Run
```bash
# Clone the repository
git clone https://github.com/valleyballjac/Valleyball-Versus.git
cd Valleyball-Versus

# Install dependencies
npm install

# Start local dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

---

## Deployment

Valleyball Versus is deployed to GitHub Pages using Vite:
```bash
npm run deploy
```
This builds the production bundle with the `/Valleyball-Versus/` base path and publishes the distribution to the `gh-pages` branch.
