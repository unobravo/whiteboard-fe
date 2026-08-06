/**
 * Which upstream Excalidraw features this fork ships.
 *
 * A plain object on purpose. Flipping one is a code change and a review, not a
 * deploy-time environment variable — there is no configuration to get wrong, no
 * precedence to reason about, and no way for a build to disagree with what this
 * file says.
 *
 * Every gate only ever *removes* something. Turning one back to `true` restores
 * upstream behaviour; it never enables anything upstream does not already do.
 *
 * `unobravo/FORK.md` lists which upstream file each gate touches.
 */
export const FEATURES = {
  /**
   * Excalidraw+ — the commercial product.
   *
   * The promo banner in the top-right, the whole promo sidebar, the
   * "Excalidraw+" and "Sign up" entries in the hamburger menu, the welcome
   * screen's sign-up link, the "Export to Excalidraw+" card in the export
   * dialog and its command-palette entry, and the `/excalidraw-plus-export`
   * postMessage bridge.
   *
   * Off: none of those render, and the bridge route serves nothing.
   */
  plus: false,

  /**
   * The hosted AI features, which all POST to `VITE_APP_AI_BACKEND`.
   *
   * Text-to-diagram, diagram-to-code, and the magic frame tool. Passed to the
   * editor as `aiEnabled`, which also removes the toolbar trigger and the AI
   * command-palette entries.
   *
   * Not Mermaid: that runs locally, has its own toolbar entry, and stays.
   */
  ai: false,

  /**
   * The shape library.
   *
   * The Library tab of the right sidebar and everything reachable from it —
   * "Browse libraries" (libraries.excalidraw.com), "Publish library" (which
   * uploads to Excalidraw's servers), "Add to library" in the context menu, the
   * command-palette entry, and `?addLibrary=` install links.
   *
   * Off also refuses library *writes*, so dropping a `.excalidrawlib` file does
   * not silently populate a store the user has no UI to reach.
   */
  library: false,

  /**
   * Outbound links to Excalidraw-owned properties.
   *
   * The GitHub / X / Discord / YouTube items, the help dialog's link row
   * (docs, the Excalidraw+ blog, the issue tracker, YouTube), the footer's
   * end-to-end-encryption link, the "open an issue" button on the crash screen,
   * and the Brave text-measurement notice's links.
   *
   * Off keeps the surrounding copy — the Brave notice still says what is wrong
   * and what to do — and drops only the anchors.
   */
  socials: false,

  /**
   * Offering to publish a shareable link.
   *
   * The "Export to link" section of the share dialog, its command-palette
   * entry, and the export handler that POSTs the scene to
   * `VITE_APP_BACKEND_V2_POST_URL`.
   *
   * It does **not** stop the app opening a link someone sends: a `#json=` or
   * `?id=` URL still loads, exactly as upstream. Collaboration is always
   * enabled and leans on the same backends, so refusing inbound links would
   * have been inconsistent rather than safer.
   */
  shareLinks: false,

  /**
   * The live-collaboration UI affordances.
   *
   * The share button in the top-right of the canvas and the "Live
   * collaboration" entry in both the hamburger menu and the welcome screen.
   *
   * Off removes those affordances only. The collaboration engine stays: a
   * `#room=` URL someone sends still starts a session, exactly as upstream.
   */
  collaboration: false,

  /**
   * The "Open" (load scene from file) menu entry.
   *
   * The `LoadScene` item in both the hamburger menu and the welcome screen.
   *
   * Off removes the menu entries only. The `Cmd/Ctrl+O` shortcut and the
   * underlying action stay, exactly as upstream.
   */
  loadScene: false,

  /**
   * The welcome screen's Excalidraw branding.
   *
   * The centre logo/wordmark and the browser-storage warning heading beneath
   * it. Off drops both; the hints and the remaining menu entries stay.
   */
  welcomeLogo: false,
};

export type UnobravoFeatures = typeof FEATURES;
