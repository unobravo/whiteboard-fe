# Fork register

Every file outside our own directories that this fork modifies, and why.

`yarn fork:check` reads the two tables below and fails when reality drifts from them. Nothing here is decorative: if you touch an upstream file, you add a row, and the review that follows is the moment somebody decides whether the fork should grow.

## Why the register exists

The failure mode we are guarding against is not a merge conflict. It is a merge that resolves _cleanly_ while quietly dropping a gate, because upstream moved the line it was attached to. A conflict is loud; a silently re-enabled Excalidraw+ banner is not.

So the layering rule is: for each thing we want to remove, use the **first** mechanism that suffices.

| Level | Mechanism | Merge cost |
| --- | --- | --- |
| 1 | A public `<Excalidraw>` prop | none |
| 2 | An overlay component in `excalidraw-app/components/unobravo/`, swapped in via one import | one import line |
| 3 | A new upstream-shaped prop or optional prop, sent upstream as a PR | small, and shrinking |
| 4 | An inline `{features.x && …}` gate marked `// UNOBRAVO:` | one line, and fragile |

## Directories we own

`unobravo/` (flags and build plugins — it imports nothing from the app, so the dependency runs one way) and `excalidraw-app/components/unobravo/` (the overlays, which do need app-shell pieces). `scripts/fork-check.js` is ours too. `fork-check` skips all three; everything else must be registered.

## Modified upstream files

<!-- fork-check:files:start -->

| File | Level | Why | Upstream candidate |
| --- | --- | --- | --- |
| `.env.production` | — | Sentry disabled, notes on the endpoints still pointing at Excalidraw | no |
| `tsconfig.json` | — | adds `unobravo` to `include` | no |
| `package.json` | — | adds `fork:check` and runs it from `test:all` | no |
| `.github/workflows/lint.yml` | — | runs `fork:check` in CI, with the upstream remote it needs | no |
| `excalidraw-app/package.json` | — | drops the `VITE_APP_ENABLE_TRACKING=true` that overrode `.env.production` | no |
| `excalidraw-app/vite.config.mts` | — | copies the fonts into the build, drops the excalidraw.com sitemap | no |
| `scripts/woff2/woff2-vite-plugins.js` | — | serves the fonts from this origin instead of Excalidraw's CDN | no |
| `excalidraw-app/App.tsx` | 1, 2, 4 | imports the overlays, passes `aiEnabled` / `libraryEnabled` / `externalLinksEnabled`, gates the Excalidraw+, social and share-link surfaces | no |
| `excalidraw-app/index.html` | — | removes the Excalidraw+ auto-redirect, the Simple Analytics loader, the excalidraw.com canonical/OG urls and the dead Google Fonts preconnects | no |
| `excalidraw-app/share/ShareDialog.tsx` | 3 | `onExportToBackend` becomes optional; the link section and the dialog itself follow from it | yes |
| `excalidraw-app/components/TopErrorBoundary.tsx` | 4 | gates the "open an issue on github.com/excalidraw" button, and stops claiming a crash was reported when Sentry is off | no |
| `excalidraw-app/sentry.ts` | 4 | exports whether errors are actually transmitted | no |
| `public/robots.txt` | — | drops the `Sitemap:` line pointing crawlers at excalidraw.com | no |
| `excalidraw-app/data/LocalData.ts` | 4 | never persists a sidebar tab this build cannot render | no |
| `packages/excalidraw/types.ts` | 3 | declares `libraryEnabled` and `externalLinksEnabled` | yes |
| `packages/excalidraw/index.tsx` | 3 | defaults and forwards both props | yes |
| `packages/excalidraw/components/App.tsx` | 3 | clamps a restored `openSidebar` pointing at the removed library tab | yes |
| `packages/excalidraw/components/DefaultSidebar.tsx` | 3 | drops the library tab and its trigger | yes |
| `packages/excalidraw/components/LayerUI.tsx` | 3 | points the sidebar trigger at the search tab, gates the fallback menu's "Excalidraw links" group | yes |
| `packages/excalidraw/components/HelpDialog.tsx` | 3 | gates the row of links to Excalidraw-owned properties | yes |
| `packages/excalidraw/components/BraveMeasureTextError.tsx` | 3 | gates the docs/issue/Discord paragraphs | yes |
| `packages/excalidraw/components/CommandPalette/CommandPalette.tsx` | 3 | gates the library command | yes |
| `packages/excalidraw/actions/actionAddToLibrary.ts` | 3 | gates "Add to library" in the context menu | yes |
| `packages/excalidraw/data/library.ts` | 3 | refuses library writes when the library is disabled | yes |
| `packages/excalidraw/tests/__snapshots__/contextmenu.test.tsx.snap` | 3 | records the `predicate` field now present on the action object | yes |

<!-- fork-check:files:end -->

Eleven of the twenty-five rows exist only to carry the two new props. Upstream already ships `aiEnabled` with exactly this shape, so both are natural PRs — landing them would cut this table roughly in half.

## Overlay drift references

`excalidraw-app/components/unobravo/Unobravo*.tsx` are edited copies of the upstream files below. They are swapped in by three import lines in `excalidraw-app/App.tsx`; the upstream originals stay in the tree, unmodified, purely as the reference.

The weakness of that pattern is silence: upstream adds a menu entry, our copy never gets it, nobody notices. The hashes below close it. When one stops matching, `yarn fork:check` fails, and the fix is to port the upstream change into the overlay and update the hash in the same commit.

<!-- fork-check:overlays:start -->

| Upstream file | Overlay | `git hash-object` |
| --- | --- | --- |
| `excalidraw-app/components/AppMainMenu.tsx` | `excalidraw-app/components/unobravo/UnobravoMainMenu.tsx` | `ad34d7da91e06974823efc7ee085c33f1fb1ab11` |
| `excalidraw-app/components/AppWelcomeScreen.tsx` | `excalidraw-app/components/unobravo/UnobravoWelcomeScreen.tsx` | `903af7a5f75a141753bc17e32241719b38324c98` |
| `excalidraw-app/components/AppFooter.tsx` | `excalidraw-app/components/unobravo/UnobravoFooter.tsx` | `5e2cb27cb3e2e1d3542e77cf473862a8499308d3` |

<!-- fork-check:overlays:end -->

Those three upstream files are now imported by nothing. That is deliberate — they are the reference the hashes above are taken from — and it is why they must not be deleted or edited.

## The flags are a plain object

`unobravo/config/features.ts` is five booleans with a paragraph each. No environment variables, no query-string overrides, no resolution order, no provider, no hook.

That is a deliberate trade. Flipping a feature is a code change and a review rather than a deploy-time setting, so there is no configuration to get wrong and no way for a build to disagree with what the file says. The price is that you cannot turn something on for one environment without shipping a commit — which, for a fork that gates five things and expects to gate them permanently, is the cheaper side of the trade.

Tests vary the flags by mocking the module, not by wrapping the tree in a provider; see `excalidraw-app/components/unobravo/dataEgress.test.tsx` for the pattern.

## What is deliberately _not_ gated

- **Mermaid.** It lives inside the TTD dialog. With `ai: false` the toolbar trigger is gone, but pasting mermaid text still opens the dialog's fallback, which renders the mermaid tab only — no text-to-diagram, no call to `VITE_APP_AI_BACKEND`.
- **Local libraries.** The IndexedDB store and `.excalidrawlib` import/export stay in the code. With `library: false` there is no UI reaching them, `useHandleLibrary` is inert, and `Library.updateLibrary` refuses writes, so nothing accumulates in a store the user cannot see.
- **`libraries.excalidraw.com` links inside `PublishLibrary` and `LibraryMenuBrowseButton`.** They are unreachable only because `libraryEnabled: false` removes the tab, not because `externalLinksEnabled` covers them. Turning `library` back on with `socials` off would bring them back.
- **Branding.** The app name, the page title, the OG/Twitter title and description text, and the PWA manifest still say Excalidraw. That is naming, and it is a separate piece of work. What _was_ removed from `index.html` is the part that is not naming: the Excalidraw+ auto-redirect, the Simple Analytics loader, the `rel="canonical"` and absolute `og:url`/`twitter:url` pointing at excalidraw.com, and the Google Fonts preconnects that nothing uses. Those are instructions and network calls, not labels, and none of them can be reached by a feature flag.
- **Third-party endpoints in `.env.production`.** They still point at Excalidraw. They are deliberately not blanked: an empty base URL turns `fetch(BACKEND_V2_POST)` into a same-origin POST of the user's scene, which is quieter and harder to spot than an obviously foreign host. The flags are the gate; the `TODO(unobravo)` markers say what has to change before each is switched back on.
- **`ExcalidrawFontFace.ASSETS_FALLBACK_URL`.** After `EXCALIDRAW_ASSET_PATH` fails, the editor falls back to `https://esm.sh/@excalidraw/excalidraw/dist/prod/`. Left alone: it is the published package's fallback for library consumers, and in this build it is only reachable if a same-origin font 404s — which `unobravo/vite/fontAssetsPlugin` prevents by failing the build when the font tree is missing.
- **Bundle size.** The flags are resolved at runtime, so the gated modules are still bundled — dead, but present. If size becomes a concern, stub them via `resolve.alias` in `excalidraw-app/vite.config.mts`; no other file changes.

## Known gap in the level-3 mechanism

`ActionManager.handleKeyDown` filters on `UIOptions.canvasActions` and `keyTest` only — it never evaluates `predicate`. `actionAddToLibrary` has no keybinding today, so nothing leaks, but the day upstream gives it one the gate is bypassed by keypress with no test failure. If the `libraryEnabled` prop goes upstream, that fix should go with it.

## Routine when syncing with upstream

```
git fetch excalidraw
git merge excalidraw/master
yarn fork:check      # register accurate? overlays still in sync?
yarn test:all
```
