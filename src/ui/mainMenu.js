/**
 * @file mainMenu.js
 * Responsibility: Public UI entry point re-exporting the modular Main Menu & Player Setup system.
 * Upstream: Imported by `src/main.js`, `src/ui/inGameMenu.js`, and `src/ui/victoryScreen.js`.
 * Downstream: Re-exports `src/features/ui/mainMenu/index.js`.
 * Key invariants:
 * - Preserves backwards-compatible import path `src/ui/mainMenu.js` for callers across `src/ui/` and `src/main.js`.
 */
export * from '../features/ui/mainMenu/index.js';
