import { STORAGE_KEYS } from "../../excalidraw-app/app_constants";

/**
 * Upstream persists the scene under fixed, per-origin localStorage keys, so
 * every board and every user in a browser profile shares one stored scene.
 *
 * Until board-scoped persistence lands, the layer records which
 * user + board the stored scene belongs to and discards it when it belongs to
 * someone else. Without this, a second user on a shared device (clinic
 * machine, family computer) is shown — and silently overwrites — the previous
 * user's board.
 *
 * Discarding is the safe direction: with no backend yet, local storage is a
 * convenience cache, not the source of truth.
 */
const SCENE_SCOPE_KEY = "unobravo-scene-scope";

/** Keys holding scene state, all of them unscoped upstream. */
const SCENE_STORAGE_KEYS = [
  STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS,
  STORAGE_KEYS.LOCAL_STORAGE_APP_STATE,
  STORAGE_KEYS.VERSION_DATA_STATE,
  STORAGE_KEYS.VERSION_FILES,
];

const buildScope = (userId: string, boardId: string | null): string =>
  JSON.stringify({ userId, boardId });

/**
 * Drops any stored scene that belongs to a different user or board, then
 * records the current scope.
 *
 * Must run before the editor mounts, since the scene is restored from
 * localStorage in the app's own init effect.
 */
export const enforceSceneScope = (
  userId: string,
  boardId: string | null,
): void => {
  const scope = buildScope(userId, boardId);

  try {
    const storedScope = window.localStorage.getItem(SCENE_SCOPE_KEY);

    if (storedScope !== scope) {
      for (const key of SCENE_STORAGE_KEYS) {
        window.localStorage.removeItem(key);
      }
      window.localStorage.setItem(SCENE_SCOPE_KEY, scope);
    }
  } catch {
    // localStorage can be unavailable (private mode, quota). The editor
    // already degrades gracefully in that case, and with no stored scene
    // there is nothing to leak.
  }
};
