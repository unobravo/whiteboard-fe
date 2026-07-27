/**
 * Board ids are the first path segment of the URL — the app is served at
 * `whiteboard.unobravo.com/{boardId}`. We deliberately avoid a router: the
 * app has a single view, so a pure function over `location.pathname` is
 * enough and adds no dependency (and no merge surface).
 */

const BOARD_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Paths owned by upstream Excalidraw, which must never be mistaken for a
 * board id.
 */
const RESERVED_SEGMENTS = new Set([
  "excalidraw-plus-export",
  "web-share-target",
]);

/**
 * Extracts the board id from a pathname, or `null` when the pathname carries
 * none (root, a reserved upstream path, a nested path, or an id that doesn't
 * match the expected shape).
 */
export const parseBoardId = (pathname: string): string | null => {
  const segments = pathname.split("/").filter((segment) => segment !== "");

  if (segments.length !== 1) {
    return null;
  }

  const [segment] = segments;

  if (RESERVED_SEGMENTS.has(segment) || !BOARD_ID_RE.test(segment)) {
    return null;
  }

  return segment;
};

let cachedBoardId: string | null | undefined;

/**
 * The board id of the current document, read once.
 *
 * Reading it lazily-but-once matters: `initializeScene` rewrites the URL to
 * the bare origin via `history.replaceState` when it finds `?id=`, `#json=`
 * or `#url=` (see `excalidraw-app/App.tsx`), so `location.pathname` is not
 * stable for the lifetime of the page.
 */
export const getCurrentBoardId = (): string | null => {
  if (cachedBoardId === undefined) {
    cachedBoardId = parseBoardId(window.location.pathname);
  }

  return cachedBoardId;
};
