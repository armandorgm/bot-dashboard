/**
 * Global Performance & Timing Constants (Alpha Architecture)
 * Centralizes frame rate limiting across all UI components and renderers.
 * Target: Maximum 4 Frames Per Second (250ms interval).
 */
export const TARGET_MAX_FPS = 4;
export const FRAME_BUDGET_MS = 1000 / TARGET_MAX_FPS; // 250 ms
