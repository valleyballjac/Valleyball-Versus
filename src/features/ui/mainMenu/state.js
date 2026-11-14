/**
 * Module: features/ui/mainMenu/state
 * Role: Shared cross-screen state for the Main Menu subsystem (Title Screen, Controller Assignment, Player Setup, and Menu Navigation).
 * Frame Phase: UI Event / Polling
 * Active Architectural Laws:
 *   - LAW 1 (Single Authority): `state.playerConfigs` (length 4) is the single source of truth for P1–P4 lobby configuration
 *     across Controller Assignment and Player Setup.
 */

/**
 * Shared mutable state container for the Main Menu screens.
 */
export const state = {
  /** @type {HTMLElement|null} Root overlay element (`#main-menu-root`) */
  rootEl: null,
  /** @type {HTMLElement|null} Title Screen container element */
  titleScreenEl: null,
  /** @type {HTMLElement|null} Controller Assignment screen container element */
  controllerAssignmentEl: null,
  /** @type {object|null} Interactive 3D brand ball instance on the Title Screen */
  titleBrandBall: null,

  /**
   * Canonical 4-slot player configuration array shared between Controller Assignment and Player Setup.
   * Never truncated below length 4 so 2v2 slot settings persist across format switches.
   */
  playerConfigs: [
    {
      name: 'Player 1',
      type: 'human',
      difficulty: 'medium',
      aggressiveness: 0.60,
      team: 'home',
      headwear: 'wrestler_bands',
      variant: 'classic',
      primaryColor: 0xd90429,
      cameraMode: 'chase',
      assistPreset: 'standard',
    },
    {
      name: 'Player 2',
      type: 'human',
      difficulty: 'medium',
      aggressiveness: 0.60,
      team: 'away',
      headwear: 'wicket_grill',
      variant: 'classic',
      primaryColor: 0x1d4ed8,
      cameraMode: 'chase',
      assistPreset: 'standard',
    },
    {
      name: 'Player 3',
      type: 'ai',
      difficulty: 'medium',
      aggressiveness: 0.60,
      team: 'home',
      headwear: 'wrestler_bands',
      variant: 'classic',
      primaryColor: 0xd90429,
      cameraMode: 'chase',
      assistPreset: 'standard',
    },
    {
      name: 'Player 4',
      type: 'ai',
      difficulty: 'medium',
      aggressiveness: 0.60,
      team: 'away',
      headwear: 'wicket_grill',
      variant: 'classic',
      primaryColor: 0x1d4ed8,
      cameraMode: 'chase',
      assistPreset: 'standard',
    },
  ],

  /** @type {HTMLElement[]} Focusable buttons on the Title Screen */
  titleButtons: [],
  /** @type {number} Active focus index on the Title Screen */
  titleFocusIndex: 1,
  /** @type {number|null} Interval ID for menu gamepad polling */
  gamepadPollHandle: null,
};
