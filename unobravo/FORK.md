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
| `excalidraw-app/collab/Collab.tsx` | 4 | one line: the relay rejects a handshake without a Firebase ID token | no |
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
| `excalidraw-app/App.tsx` | 1, 2, 4 | imports the overlays, passes the three props, gates Excalidraw+/social/share-link | no |
| `excalidraw-app/index.html` | — | removes the Excalidraw+ redirect, Simple Analytics, excalidraw.com canonical/OG urls, dead font preconnects; rebrands title/OG/Twitter meta and the visually-hidden h1 to Unobravo Whiteboard | no |
| `excalidraw-app/share/ShareDialog.tsx` | 3 | `onExportToBackend` becomes optional; the link section follows from it | yes |
| `excalidraw-app/components/TopErrorBoundary.tsx` | 4 | gates the github.com/excalidraw issue button, stops claiming a crash was reported when Sentry is off | no |
| `excalidraw-app/sentry.ts` | 4 | exports whether errors are actually transmitted | no |
| `public/robots.txt` | — | blocks all crawlers (upstream's equal-length `Allow: /` tie let indexing through) and drops the `Sitemap:` line pointing crawlers at excalidraw.com | no |
| `excalidraw-app/data/LocalData.ts` | 4 | never persists a sidebar tab this build cannot render | no |
| `packages/excalidraw/types.ts` | 3 | declares `libraryEnabled` and `externalLinksEnabled` | yes |
| `packages/excalidraw/index.tsx` | 3 | defaults and forwards both props | yes |
| `packages/excalidraw/components/App.tsx` | 3 | clamps a restored `openSidebar` pointing at the removed library tab | yes |
| `packages/excalidraw/components/DefaultSidebar.tsx` | 3 | drops the library tab and its trigger | yes |
| `packages/excalidraw/components/LayerUI.tsx` | 3 | points the sidebar trigger at search, gates the fallback menu's "Excalidraw links" group | yes |
| `packages/excalidraw/components/HelpDialog.tsx` | 3 | gates the row of links to Excalidraw-owned properties | yes |
| `packages/excalidraw/components/BraveMeasureTextError.tsx` | 3 | gates the docs/issue/Discord paragraphs | yes |
| `packages/excalidraw/components/CommandPalette/CommandPalette.tsx` | 3 | gates the library command | yes |
| `packages/excalidraw/actions/actionAddToLibrary.ts` | 3 | gates "Add to library" in the context menu | yes |
| `packages/excalidraw/data/library.ts` | 3 | refuses library writes when the library is disabled | yes |
| `packages/excalidraw/tests/__snapshots__/contextmenu.test.tsx.snap` | 3 | records the `predicate` field now on the action object | yes |
| `.dockerignore` | — | re-includes `unobravo/` so the Docker build context carries the fork's vite plugins and feature layer that `build:app:docker` imports; drops a dead `.prettierrc` re-include (config lives in `package.json`) | no |
| `vercel.json` | — | deleted: upstream's Vercel config (excalidraw.com CORS headers, `/webex` + vscode redirects) describes a deployment this fork does not use — the app ships via S3 + CloudFront | no |

<!-- fork-check:files:end -->

Eleven of the rows carry only the two new props (`aiEnabled` already ships upstream in this shape) — both are natural PRs that would roughly halve the table. `.size-limit.json` is the odd row: a repair, not a gate. Its paths still named the CRA build; esbuild now writes `dist/prod/`, so nothing matched and `size-limit` exited 1 on every PR. The fork does not publish the package, so the numbers are a change-detector set ~15% above current gzipped sizes — if a sync trips one, read the diff and **raise it**, do not trim upstream's bundle.

## Overlay drift references

The `Unobravo*.tsx` overlays are edited copies of the upstream files below, swapped in by three imports in `excalidraw-app/App.tsx`; the originals stay in the tree, unmodified, as the reference — do not delete or edit them. The hashes catch the silent failure (upstream adds a menu entry, our copy never gets it). When one stops matching, `fork:check` fails: port the upstream change into the overlay and update the hash in the same commit.

<!-- fork-check:overlays:start -->

| Upstream file | Overlay | `git hash-object` |
| --- | --- | --- |
| `excalidraw-app/components/AppMainMenu.tsx` | `excalidraw-app/components/unobravo/UnobravoMainMenu.tsx` | `ad34d7da91e06974823efc7ee085c33f1fb1ab11` |
| `excalidraw-app/components/AppWelcomeScreen.tsx` | `excalidraw-app/components/unobravo/UnobravoWelcomeScreen.tsx` | `903af7a5f75a141753bc17e32241719b38324c98` |
| `excalidraw-app/components/AppFooter.tsx` | `excalidraw-app/components/unobravo/UnobravoFooter.tsx` | `5e2cb27cb3e2e1d3542e77cf473862a8499308d3` |

<!-- fork-check:overlays:end -->

## The flags are a plain object

`unobravo/config/features.ts` is five booleans, each with a paragraph — no env vars, no query overrides, no provider, no hook. The trade: flipping a feature is a commit and a review, not a deploy-time setting, so nothing can be misconfigured and no build can disagree with the file. The price — you cannot flip one per environment without a commit — is the cheaper side for a fork that gates five things permanently. Tests vary the flags by mocking the module; see `excalidraw-app/components/unobravo/dataEgress.test.tsx`.

## What is deliberately _not_ gated

- **Collaboration.** Always on, by product decision. A session opens a socket to `VITE_APP_WS_SERVER_URL` (in dev, the Unobravo relay — see below) and writes the scene and images to Firebase, which still points at Excalidraw. Repointing Firebase and finding a production relay are go-live prerequisites; `.env.production` says so at each endpoint.
- **Opening a shareable link.** `shareLinks: false` stops the app _offering_ to publish; an inbound `#json=`/`?id=` URL still loads and fetches from the share backend, as upstream. Gating the inbound side would only be inconsistent — collaboration leans on the same infra and is unconditional.
- **Mermaid.** Its toolbar entry is not gated on `aiEnabled` upstream; with `ai: false` it still opens the dialog (the `__fallback` from `LayerUI`, mermaid tab only). Runs locally — no call to `VITE_APP_AI_BACKEND`.
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

Being deployed turns [what is _not_ gated](#what-is-deliberately-not-gated) from a note into an exposure: collaboration still hits `oss-collab.excalidraw.com` and Excalidraw's Firebase, inbound `#json=` still fetches their share backend, and `whiteboard.unobravo.com` is public. One thing the deployment still lacks: **error reporting** (`.env.production` disables Sentry and `sentry.ts` knows only Excalidraw hostnames — issue #16). `public/robots.txt` now blocks all crawlers; upstream ended it `Allow: /` before `Disallow: /`, and equal-length rules favour `Allow`.

## Routine when syncing with upstream

```
git fetch excalidraw
git merge excalidraw/master
yarn fork:check      # register accurate? overlays still in sync?
yarn test:all
```

Never push a sync straight to `master`: the `fork-check` job is `on: pull_request` only, so a direct push skips the one check that catches overlay drift. Open a branch and a PR. `.claude/skills/upstream-sync/` is this routine in full — preflight, conflict triage by level, the overlay port, CI, and a run log of its own mistakes.
