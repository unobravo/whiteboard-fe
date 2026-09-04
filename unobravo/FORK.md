# Fork register

Every file outside our own directories that this fork modifies, and why. `yarn fork:check` reads the two tables below and fails when reality drifts from them: touch an upstream file, add a row. The failure it guards against is not a conflict but a merge that resolves _cleanly_ while dropping a gate — a silently re-enabled Excalidraw+ banner is not loud.

The rule: for each thing we remove, use the **first** mechanism that suffices.

| Level | Mechanism | Merge cost |
| --- | --- | --- |
| 1 | A public `<Excalidraw>` prop | none |
| 2 | An overlay component in `excalidraw-app/components/unobravo/`, swapped in via one import | one import line |
| 3 | A new upstream-shaped prop, sent upstream as a PR | small, and shrinking |
| 4 | An inline `{FEATURES.x && …}` gate marked `// UNOBRAVO:` | one line, and fragile |

## Directories we own

`unobravo/`, `excalidraw-app/components/unobravo/` (the overlays), `scripts/fork-check.js`, `.zed/` (editor settings, a path upstream has no opinion about), `.claude/skills/` (the agent skills that operate the fork), and the five `.github/workflows/unobravo-*.yml` files (see [Deploy](#deploy)). `fork-check` skips these; everything else must be registered. The deploy workflows are listed one file at a time, not by directory, because GitHub allows no subdirectories under `.github/workflows/` and owning the directory would hide an edit to one of upstream's eleven workflows. It is `.claude/skills/`, not `.claude/`: the rest is per-machine Claude Code state that `.gitignore` drops, and an owned path must not also be ignored — `fork-check` reads that pairing as a file missing from every clone.

## Modified upstream files

<!-- fork-check:files:start -->

| File | Level | Why | Upstream candidate |
| --- | --- | --- | --- |
| `.env.production` | — | Sentry disabled, notes on endpoints still pointing at Excalidraw | no |
| `.env.development` | — | points the collaboration socket at the Unobravo relay | no |
| `excalidraw-app/collab/Collab.tsx` | 4 | two lines: the relay rejects a handshake without a Firebase ID token, and the socket URL is read from `unobravo/collab/relayUrl.ts` instead of `import.meta.env` directly | no |
| `.gitignore` | — | narrows upstream's wholesale `.claude` ignore to `.claude/*` + `!.claude/skills/` | no |
| `CLAUDE.md` | — | says this is a fork and how to keep a change merge-friendly | no |
| `tsconfig.json` | — | adds `unobravo` to `include` | no |
| `excalidraw-app/tsconfig.json` | — | new file: scopes the editor's TypeScript project to the app instead of the whole monorepo, so the language server stays inside its memory budget. Its `include` also lists `../packages/excalidraw/vite-env.d.ts` — load-bearing, as it pulls in `vite/client` (the `ImportMetaEnv` index signature + `*.woff2` module decls); if a sync moves/renames that file or drops its `vite/client` reference, the app build regresses. | no |
| `package.json` | — | adds `fork:check` and runs it from `test:all` | no |
| `.github/workflows/lint.yml` | — | runs `fork:check` in CI, with the upstream remote it needs | no |
| `packages/excalidraw/.size-limit.json` | — | repoints the budgets at the esbuild output; the CRA-era paths matched nothing | yes |
| `excalidraw-app/package.json` | — | drops the `VITE_APP_ENABLE_TRACKING=true` that overrode `.env.production` | no |
| `excalidraw-app/vite.config.mts` | — | copies the fonts into the build, drops the excalidraw.com sitemap; PWA manifest name/short_name/description say Unobravo Whiteboard | no |
| `scripts/woff2/woff2-vite-plugins.js` | — | serves the fonts from this origin instead of Excalidraw's CDN | no |
| `excalidraw-app/App.tsx` | 1, 2, 4 | imports the overlays, passes the four props, gates Excalidraw+/social/share-link and both the live-collaboration UI and the `<Collab>` mount itself (an iframe embed carrying a relay `authToken` still gets it — see `unobravo/collab/relayAuth.ts` — a bare unauthenticated iframe embed does not, so `#room=` auto-join only works for the Unobravo webapp's own embed, not an arbitrary third-party one); in `initializeScene`, `?id=`/`#json=` are hardcoded to never resolve, so an inbound link can no longer inject scene data via the share backend (MIL-2563) — `#room=` is untouched, it never went through this code path | no |
| `excalidraw-app/index.html` | — | removes the Excalidraw+ redirect, Simple Analytics, excalidraw.com canonical/OG urls, dead font preconnects; rebrands title/OG/Twitter meta and the visually-hidden h1 to Unobravo Whiteboard | no |
| `excalidraw-app/share/ShareDialog.tsx` | 3 | `onExportToBackend` becomes optional; the link section follows from it | yes |
| `excalidraw-app/components/TopErrorBoundary.tsx` | 4 | gates the github.com/excalidraw issue button, stops claiming a crash was reported when Sentry is off | no |
| `excalidraw-app/sentry.ts` | 4 | exports whether errors are actually transmitted | no |
| `public/robots.txt` | — | blocks all crawlers (upstream's equal-length `Allow: /` tie let indexing through) and drops the `Sitemap:` line pointing crawlers at excalidraw.com | no |
| `excalidraw-app/data/LocalData.ts` | 4 | never persists a sidebar tab this build cannot render | no |
| `packages/excalidraw/types.ts` | 3 | declares `mermaidEnabled`, `libraryEnabled` and `externalLinksEnabled` | yes |
| `packages/excalidraw/index.tsx` | 3 | defaults and forwards all three props | yes |
| `packages/excalidraw/components/App.tsx` | 3 | clamps a restored `openSidebar` pointing at the removed library tab | yes |
| `packages/excalidraw/components/DefaultSidebar.tsx` | 3 | drops the library tab and its trigger | yes |
| `packages/excalidraw/components/LayerUI.tsx` | 3 | points the sidebar trigger at search, gates the fallback menu's "Excalidraw links" group and the `TTDDialog` fallback that serves the mermaid dialog | yes |
| `packages/excalidraw/components/Toolbar.tsx` | 3 | gates the Mermaid entry of the extra-tools dropdown, and the hardcoded "Generate" heading above it once nothing is left under it | yes |
| `packages/excalidraw/components/MobileToolbar.tsx` | 3 | the same two gates as `Toolbar.tsx`; upstream duplicates the block rather than sharing it | yes |
| `packages/excalidraw/components/HelpDialog.tsx` | 3 | gates the row of links to Excalidraw-owned properties | yes |
| `packages/excalidraw/components/BraveMeasureTextError.tsx` | 3 | gates the docs/issue/Discord paragraphs | yes |
| `packages/excalidraw/components/CommandPalette/CommandPalette.tsx` | 3 | gates the library command, and adds `mermaidEnabled` to the mermaid command's existing `aiEnabled` predicate | yes |
| `packages/excalidraw/actions/actionAddToLibrary.ts` | 3 | gates "Add to library" in the context menu | yes |
| `packages/excalidraw/data/library.ts` | 3 | refuses library writes when the library is disabled | yes |
| `packages/excalidraw/tests/__snapshots__/contextmenu.test.tsx.snap` | 3 | records the `predicate` field now on the action object | yes |
| `.dockerignore` | — | re-includes `unobravo/` so the Docker build context carries the fork's vite plugins and feature layer that `build:app:docker` imports; drops a dead `.prettierrc` re-include (config lives in `package.json`) | no |
| `excalidraw-app/index.scss` | — | one import: `unobravo/theme/accent-orange.scss` repaints the accent palette orange, by redeclaring fifteen `theme.scss` custom properties per theme — the twelve accent tokens plus the tinted surface scale, `--color-surface-high` / `-low` / `-mid`, which upstream aliases to `--button-hover-bg`, `--button-active-bg`, `--default-border-color`, `--sidebar-border-color` and `filledButtonOnCanvas`, so leaving them lavender put a cool hover directly beside the warm active tool on every toolbar and menu row. Each surface value keeps the luminance of the violet it replaces rather than merely warming it: warming alone makes them lighter, and a fainter hover is a worse cue than the one it replaced. Nothing in `packages/` is touched. The two token blocks are `.excalidraw.excalidraw:not(.theme--dark)` and `.excalidraw.excalidraw.theme--dark`, both 0-3-0 and mutually exclusive, so they outrank every upstream declaration on specificity alone and the bundler's emit order cannot change the outcome — without the `:not()` the light block would tie with upstream's `.excalidraw.theme--dark` at 0-2-0 and the winner would depend on Vite's chunk order. A third rule sets `color` rather than a token: `packages/excalidraw/components/LayerUI.scss` hardcodes a literal `white` on `--color-primary` for the exit-view-mode button with no dark counterpart, which was already poor at upstream's dark violet (2.21:1) and vanishes against a light orange (1.34:1). The override points it at `--color-icon-white`, the token that already means "whichever of light or dark reads on the accent", so one rule serves both themes and also covers `:active` without `:hover` — a tap on a phone, where upstream's hover white never applies. `unobravo/tests/accentPalette.test.ts` is the guard, and eight assertions is all of it on purpose. It derives the accent family from upstream by **hue** — every violet `theme.scss` or `excalidraw-app/index.scss` declares must be either overridden or named in the exclusion list below — and then pins the derived names, so a rename, an addition or a removal fails deterministically. Replaying earlier versions of the guard against all 44 revisions of `theme.scss` in this repo's history showed that family changing membership in **8** upstream commits, roughly one every seven months, each of which would have shipped a half-violet accent with every other gate green. It also fails on the light block losing its `:not()`, on the `@import` being deleted _or commented out_, on `excalidraw-app/App.tsx` losing `import "./index.scss"`, on a one-character hex typo, on the two blocks being swapped, on any of upstream's own violets reappearing here, on the exit-view-mode rule being deleted or weakened, on either of that rule's upstream dependencies moving, and on the interactive canvas losing its `--theme-filter`. All sixteen of those mutations were applied and confirmed to fail. What it deliberately does **not** do is pin spellings: the same replay showed a `--theme-filter` value pin red on 37 of 44 revisions and an "every upstream value must be readable" check red on 40 of 44, both for pure syntax refactors with no visual effect. A false negative here ships a cosmetic bug the first person to open the app will see; a false positive blocks an upstream merge behind a bespoke Sass parser. The budget follows from that asymmetry. Two channels stay uncovered by design and have to be caught in review: violet literals in TypeScript, and a new accent token whose value the parser cannot read. **Still violet, all of it deliberate:** `COLOR_PALETTE` in `packages/common/src/colors.ts` (drawing swatches — content, not chrome); eleven canvas call sites — seven in `packages/excalidraw/renderer/interactiveScene.ts` (`:166,223,227,229` for line and arrow point handles, `:1244,1265,1269` for arrow-binding focus points), two in `packages/excalidraw/lasso/index.ts` where the trail is `#6965db` at 5% for the fill (`:66`) and at full opacity for the stroke (`:67`), and the `rgba(0, 0, 200, 0.04)` literal at `packages/element/src/renderElement.ts:699` (the marquee fill) and `:746` (the frame interior) — all of which paint violet or blue inside an orange selection ([#27](https://github.com/unobravo/whiteboard-fe/issues/27)). Literals are the one channel the test does not cover: it reads stylesheets, so a twelfth call site would arrive unnoticed and has to be caught in review; the brand icon set and PWA screenshots ([#28](https://github.com/unobravo/whiteboard-fe/issues/28)); `--color-logo-text`, unreachable while `FEATURES.welcomeLogo` and `FEATURES.plus` are both off (its sibling `--color-logo-icon` aliases `--color-primary` and does turn orange); the two `--color-primary-contrast-offset` values three lines below the import in this very file, left alone because nothing in the tree reads them — the mirror image of [#29](https://github.com/unobravo/whiteboard-fe/issues/29), and named in the test's exclusion list so that stops being an unexamined choice; and the `#6965db` fallback at `packages/excalidraw/components/canvases/InteractiveCanvas.tsx:144`, reached only when the container ref is missing. Hosted here rather than in `excalidraw-app/App.tsx`, which already does `import "./index.scss"` and would have added no register row at all: `App.tsx` took 11 upstream commits last year against this file's 3, and its import block already carries level-1/2/4 fork changes | no |
| `vercel.json` | — | deleted: upstream's Vercel config (excalidraw.com CORS headers, `/webex` + vscode redirects) describes a deployment this fork does not use — the app ships via S3 + CloudFront | no |
| `public/ws-config.json` | — | new file: the default relay URL, served at `/ws-config.json` and read by `unobravo/collab/relayUrl.ts`; `unobravo-deploy-app.yml` overwrites it per bucket at deploy time (see [The collaboration relay](#the-collaboration-relay)) | no |

<!-- fork-check:files:end -->

Thirteen of the rows carry only the three new props (`aiEnabled` already ships upstream in this shape) — all three are natural PRs that would roughly halve the table. `.size-limit.json` is the odd row: a repair, not a gate. Its paths still named the CRA build; esbuild now writes `dist/prod/`, so nothing matched and `size-limit` exited 1 on every PR. The fork does not publish the package, so the numbers are a change-detector set ~15% above current gzipped sizes — if a sync trips one, read the diff and **raise it**, do not trim upstream's bundle.

## Overlay drift references

The `Unobravo*.tsx` overlays are edited copies of the upstream files below, swapped in by three imports in `excalidraw-app/App.tsx`; the originals stay in the tree, unmodified, as the reference — do not delete or edit them. The hashes catch the silent failure (upstream adds a menu entry, our copy never gets it). When one stops matching, `fork:check` fails: port the upstream change into the overlay and update the hash in the same commit.

<!-- fork-check:overlays:start -->

| Upstream file | Overlay | `git hash-object` |
| --- | --- | --- |
| `excalidraw-app/components/AppMainMenu.tsx` | `excalidraw-app/components/unobravo/UnobravoMainMenu.tsx` | `8bfae2d55548b181ffb0b1258d15abda21b26cbf` |
| `excalidraw-app/components/AppWelcomeScreen.tsx` | `excalidraw-app/components/unobravo/UnobravoWelcomeScreen.tsx` | `a43b742f78bb191f1297f419fb1b0d9dfeb0a872` |
| `excalidraw-app/components/AppFooter.tsx` | `excalidraw-app/components/unobravo/UnobravoFooter.tsx` | `5e2cb27cb3e2e1d3542e77cf473862a8499308d3` |

<!-- fork-check:overlays:end -->

## The flags are a plain object

`unobravo/config/features.ts` is one flat object of booleans, each with a paragraph — no env vars, no query overrides, no provider, no hook. The trade: flipping a feature is a commit and a review, not a deploy-time setting, so nothing can be misconfigured and no build can disagree with the file. The price — you cannot flip one per environment without a commit — is the cheaper side for a fork whose gates are all permanent. The count is deliberately not written down here: nothing checks it, and this paragraph said "five" for three flags longer than it was true. Each flag's own paragraph is the register. Tests vary the flags by mocking the module; see `excalidraw-app/components/unobravo/dataEgress.test.tsx`.

## What is deliberately _not_ gated

- **Collaboration.** Always on, by product decision. A session opens a socket to the relay resolved by `unobravo/collab/relayUrl.ts` (in dev, `VITE_APP_WS_SERVER_URL` — see below) and writes the scene and images to Firebase, which still points at Excalidraw. Repointing Firebase and finding a production relay are go-live prerequisites; `.env.production` says so at each endpoint.
- **Opening a shareable link.** `shareLinks: false` stops the app _offering_ to publish. The inbound side used to load and fetch from the share backend too, as upstream; as of MIL-2563 it no longer does — see the `App.tsx` row above. `#room=` is unaffected: unlike a `#json=`/`?id=` link, it is not upstream's share backend, it is Unobravo's own relay, and stays unconditional.
- **Mermaid pasted onto the canvas.** `mermaid: false` closes every mermaid _dialog_ route — both toolbars, the command palette, and the `__fallback` dialog itself — but pasting a mermaid definition still converts it to elements (the `isMaybeMermaidDefinition` branch of `pasteFromClipboard` in `packages/excalidraw/components/App.tsx`). Product's call: it runs locally, calls no backend, and there is no UI advertising it to remove. `mermaidEnabled` deliberately does not reach it.
- **The mermaid tab of a _host-supplied_ `TTDDialog`.** With `ai: false` no host dialog is mounted, so it is unreachable here; `mermaidEnabled` gates the editor's `__fallback` dialog, not the one `excalidraw-app/components/AI.tsx` renders. Turning `ai` back on with `mermaid` off would bring the tab back — and `TextToDiagram` switches to that tab to show its own result, so gating it would break the AI flow it belongs to. Gate it in the upstream PR if that ever matters.
- **The help dialog.** `welcomeHelp: false` removes one row from the middle of an empty canvas. The hamburger menu's Help item, the round `?` button, the `?` shortcut, the command-palette entry and the arrow hint that points at the button all stay. The flag is about an empty canvas looking empty, not about hiding help.
- **Local libraries.** The IndexedDB store and `.excalidrawlib` import/export stay. With `library: false` no UI reaches them, `useHandleLibrary` is inert and `Library.updateLibrary` refuses writes, so nothing accumulates unseen.
- **`libraries.excalidraw.com` links in `PublishLibrary`/`LibraryMenuBrowseButton`.** Unreachable only because `libraryEnabled: false` removes the tab; turning `library` on with `socials` off brings them back.
- **Branding.** App name, page title, OG/Twitter text and PWA manifest still say Excalidraw — that is naming, separate work. What `index.html` _did_ lose is the non-naming part: the Excalidraw+ redirect, Simple Analytics, the excalidraw.com canonical/OG urls, the dead font preconnects.
- **Third-party endpoints in `.env.production`.** Still point at Excalidraw, deliberately not blanked: an empty base URL turns `fetch(BACKEND_V2_POST)` into a quiet same-origin POST of the user's scene. The flags are the gate; the `TODO(unobravo)` markers say what to change first.
- **`ExcalidrawFontFace.ASSETS_FALLBACK_URL`** (`https://esm.sh/@excalidraw/…`). Left alone: it is the published package's fallback, reachable here only if a same-origin font 404s — which `unobravo/vite/fontAssetsPlugin` prevents by failing the build.
- **Bundle size.** Gates are runtime property reads, so gated modules are still bundled — dead but present. If it matters, stub them via `resolve.alias` in `excalidraw-app/vite.config.mts`.

## Known gap in the level-3 mechanism

`ActionManager.handleKeyDown` filters on `UIOptions.canvasActions` and `keyTest` only — never `predicate`. `actionAddToLibrary` has no keybinding today, so nothing leaks, but the day upstream gives it one the gate is bypassed by keypress with no test failure. If the `libraryEnabled` prop goes upstream, that fix goes with it.

## The collaboration relay

`whiteboard-relay.unobravo.xyz` (staging) replaces upstream's collaboration server. It speaks the same socket.io protocol (Engine.IO v4, payloads forwarded opaque — E2E encryption untouched) and adds a per-room versioned scene snapshot it replays to a joiner. The one difference that matters: it **refuses an unauthenticated handshake**.

```
no auth.token      → connect_error: "Authentication required"
invalid auth.token → connect_error: "Authentication failed"
```

The credential is a Firebase ID token from `uno-bravo-dev`, carrying `role`/`unbv_id`/`unbv_uuid`. The whiteboard has no login or Firebase SDK, so it cannot mint one — it is handed the token in the query string as `?authToken=`, which `unobravo/collab/relayAuth.ts` reads. The cost to the fork is one line in `excalidraw-app/collab/Collab.tsx` (level 4 on purpose: a `collabAuth` prop is not a shape upstream would accept). `relayHandshake.test.tsx` asserts the options object passed to `socket.io-client`, because that gate is exactly the kind a clean merge drops — import survives, property does not.

The token is read at **module load, not per connection**: `startCollaboration` rewrites the URL to `#room=…` (no query string) before constructing the socket, so a lazy read would work when joining a `#room=` link and fail when creating one — an intermittent, flow-dependent auth failure. Consequence: on a plain load the token stays in the address bar (visible, survives reload); once a session starts it is gone from the URL, so a reload from there has no token until the parent app re-opens with a fresh one.

**Which relay to connect to** is a separate question from auth, and cannot be answered by `VITE_APP_WS_SERVER_URL` alone: `unobravo-deploy.yml` builds once and promotes the same artifact to staging and production, so a value baked in at build time is necessarily identical on both. `unobravo/collab/relayUrl.ts` reads `/ws-config.json` at connect time instead — a static file `unobravo-deploy-app.yml` overwrites per bucket from the (optional) `WS_SERVER_URL_DEV`/`WS_SERVER_URL_PROD` repository variables, after the shared build — and falls back to `VITE_APP_WS_SERVER_URL` when that request fails, and always in dev (`public/ws-config.json`'s baked default would otherwise silently outrank `.env.development.local`, the documented way to point a local checkout at a different relay). Neither repository variable is required: unset, `public/ws-config.json`'s committed default ships as-is, so this is additive over the previous single-URL behaviour, not a required migration.

Known gaps:

- **No token refresh.** Firebase tokens expire after an hour; socket.io reconnects reuse the same `auth`, so an expired token loops on "Authentication failed". Accepted by product for now. The relay also stubs its revocation cache, so a revoked token stays accepted until expiry.
- **Staging only.** Production `whiteboard-relay.unobravo.com` is configured in the relay's Pulumi stack but not deployed (DNS does not resolve), so `.env.production` still points at `oss-collab.excalidraw.com`.
- **Production CORS rejects a Vercel origin.** Staging allows `*.unobravo.xyz` + `unobravo.vercel.app`; production allows `.unobravo.com` only. This app is Vercel-deployed, so unless production serves it from `*.unobravo.com` the handshake is refused. Go-live item.
- **Snapshot is not durable.** All relay state is in one ECS task's memory by design; a redeploy drops every room's snapshot and presence, versioning restarts at 1. Fine while the scene also lives in the browser.
- **Firebase is still Excalidraw's.** `saveCollabRoomToFirebase` and the image upload still write to `excalidraw-room-persistence`. The relay's own snapshot makes those writes arguably redundant, so the follow-up is repoint-or-delete (needs Firestore/Storage rules first) — deliberately not in this change. A `socketInitialized` race (Firebase-load vs snapshot-replay) is latent and only exposed when that Firebase work makes `loadFromFirebase` fast; the fix belongs with it.
- **Polling fallback is dead** (relay is websocket-only, rejects polling); harmless since upstream tries websocket first.
- **ALB returns `403` to a non-browser `User-Agent`** on the WS upgrade — so the tests mock `socket.io-client` and never reach it, as upstream's own collaboration tests do.
- **A rejected origin returns `500`, not `403`** (`corsOriginChecker` hands an `Error` to its callback). Cosmetic, but worth reporting to the relay team.

## Deploy

The app is a static SPA on S3 behind CloudFront, in the two AWS accounts platform provisioned in [ROCK-2745](https://unobravo.atlassian.net/browse/ROCK-2745).

| Environment  | Host                      | Variable suffix |
| ------------ | ------------------------- | --------------- |
| `staging`    | `whiteboard.unobravo.xyz` | `_DEV`          |
| `production` | `whiteboard.unobravo.com` | `_PROD`         |

Roles, buckets and distribution ids come from repository variables (`AWS_ROLE_ARN_*`, `AWS_S3_BUCKET_APP_*`, `CLOUDFRONT_DISTRIBUTION_*`), set by platform; nothing here hardcodes an account. Auth is OIDC federation (no AWS secrets), subject `repo:unobravo/whiteboard-fe:environment:<name>` — an environment, not a ref, the shape dragon-fe's trust policies accept.

Five workflows, all ours: `unobravo-deploy.yml` (every push to `master` bumps the version, tags, builds once and promotes the same bytes staging→production, no approval gate, no `workflow_dispatch`, refuses a run whose commit is no longer `master`'s head); `unobravo-check-labels.yml` (PR gate: a PR to `master` must carry one of the `patch`/`minor`/`major` bump labels before it can land); `unobravo-deploy-manual.yml` (`workflow_dispatch` rollback path, not sticky — next push to `master` rolls over it, so revert on `master` to make it permanent, and it takes any ref including a `whiteboard-v*` tag); `unobravo-build-app.yml` and `unobravo-deploy-app.yml` (the reusable build and publish).

Deliberate choices: a release is a **semver git tag prefixed `whiteboard-v`** — the prefix is what keeps it from colliding with upstream's `v*` on a sync. On merge, `unobravo-deploy.yml` reads the merged PR's bump label (major > minor > patch, from `whiteboard-v0.0.0`), tags the commit, and cuts a GitHub Release; the label is read from the PR rather than the push because that is the moment it merged, and `unobravo-check-labels.yml` guarantees the label exists. `build/version.json` (a `commitDate-shortHash` string, not the semver) stays the **deploy-verification token**, not the version of record — it is what the publish step reads back to prove the build landed, so it must stay unique per deploy. This adopts dragon-fe's model with two forced divergences: the tag prefix (above) and the `push` trigger (public fork → an outside-fork `pull_request` event cannot mint an OIDC id-token, so the merge label is resolved via `gh api` on the push instead). Other deliberate choices: cache headers **follow what Vite hashes** (`fonts/` 30 days, `assets/` immutable 1 year `--size-only`, hashed-name files `no-cache`, nothing ever deleted); the **unit suite gates the deploy** via a racing `test.yml` (`fork:check` is PR-only and pointless once a push to `master` exists); **staging is a gate, not a preview** — publish ends by proving the build really landed, so `deploy-production: needs: deploy-staging` means more than `aws s3 sync` exited 0. It proves it differently per environment because reachability differs: staging is behind the ZTN WAF (allow-list = the staging VPC NAT gateways), so a runner cannot reach it over HTTP — there the check reads `version.json` back from S3 with the deploy role; production is public, so there it asserts the distribution serves the build over HTTP at both `/version.json` and `/`.

Being deployed turns [what is _not_ gated](#what-is-deliberately-not-gated) from a note into an exposure: collaboration still hits `oss-collab.excalidraw.com` and Excalidraw's Firebase, and `whiteboard.unobravo.com` is public. Inbound `#json=`/`?id=` no longer fetches their share backend (MIL-2563). One thing the deployment still lacks: **error reporting** (`.env.production` disables Sentry and `sentry.ts` knows only Excalidraw hostnames — issue #16). `public/robots.txt` now blocks all crawlers; upstream ended it `Allow: /` before `Disallow: /`, and equal-length rules favour `Allow`.

## Routine when syncing with upstream

```
git fetch excalidraw
git merge excalidraw/master
yarn fork:check      # register accurate? overlays still in sync?
yarn test:all
```

Never push a sync straight to `master`: the `fork-check` job is `on: pull_request` only, so a direct push skips the one check that catches overlay drift. Open a branch and a PR. `.claude/skills/upstream-sync/` is this routine in full — preflight, conflict triage by level, the overlay port, CI, and a run log of its own mistakes.
