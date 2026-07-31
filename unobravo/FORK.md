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
| 4 | An inline `{FEATURES.x && …}` gate marked `// UNOBRAVO:` | one line, and fragile |

## Directories we own

`unobravo/` (the flag object and one build plugin — it imports nothing from the app, so the dependency runs one way) and `excalidraw-app/components/unobravo/` (the overlays, which do need app-shell pieces). `scripts/fork-check.js` is ours too, as is `.claude/skills/` (the agent skills that operate this fork — tooling about the fork, not upstream code). So are the four `.github/workflows/unobravo-*.yml` files — see [Deploy](#deploy). `fork-check` skips all of those; everything else must be registered.

The deploy workflows are listed one file at a time rather than by directory, because GitHub allows no subdirectories under `.github/workflows/` and owning that directory would stop the register noticing an edit to one of upstream's eleven workflows.

`.claude/skills/`, not `.claude/`: the rest of that directory is whatever Claude Code writes on a given machine, `.gitignore` drops it, and a path that is ignored must not also be owned — `fork-check` reads that pairing as a file going missing from every clone.

## Modified upstream files

<!-- fork-check:files:start -->

| File | Level | Why | Upstream candidate |
| --- | --- | --- | --- |
| `.env.production` | — | Sentry disabled, notes on the endpoints still pointing at Excalidraw | no |
| `.env.development` | — | points the collaboration socket at the Unobravo relay instead of a local `excalidraw-room` | no |
| `excalidraw-app/collab/Collab.tsx` | 4 | one line: the relay rejects a handshake without a Firebase ID token | no |
| `.gitignore` | — | upstream ignores `.claude` wholesale; narrowed to `.claude/*` with `!.claude/skills/` so the fork's own agent skills are committed | no |
| `CLAUDE.md` | — | says this is a fork and how to keep a change merge-friendly | no |
| `tsconfig.json` | — | adds `unobravo` to `include` | no |
| `package.json` | — | adds `fork:check` and runs it from `test:all` | no |
| `.github/workflows/lint.yml` | — | runs `fork:check` in CI, with the upstream remote it needs | no |
| `packages/excalidraw/.size-limit.json` | — | repoints the three budgets at what `buildPackage.js` emits; the CRA-era paths matched nothing, so `size-limit` exited 1 on every pull request | yes |
| `excalidraw-app/package.json` | — | drops the `VITE_APP_ENABLE_TRACKING=true` that overrode `.env.production` | no |
| `excalidraw-app/vite.config.mts` | — | copies the fonts into the build, drops the excalidraw.com sitemap | no |
| `scripts/woff2/woff2-vite-plugins.js` | — | serves the fonts from this origin instead of Excalidraw's CDN | no |
| `excalidraw-app/App.tsx` | 1, 2, 4 | imports the overlays, passes `aiEnabled` / `libraryEnabled` / `externalLinksEnabled`, gates the Excalidraw+, social and share-link surfaces | no |
| `excalidraw-app/index.html` | — | removes the Excalidraw+ auto-redirect, the Simple Analytics loader, the excalidraw.com canonical/OG urls and the dead Google Fonts preconnects | no |
| `excalidraw-app/share/ShareDialog.tsx` | 3 | `onExportToBackend` becomes optional; the link section follows from it | yes |
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

Eleven of the rows above exist only to carry the two new props — `yarn fork:check` prints the current total. Upstream already ships `aiEnabled` with exactly this shape, so both are natural PRs — landing them would cut this table roughly in half.

`.size-limit.json` is the odd row out: not a gate, a repair. Its three paths still described the Create React App build (`dist/excalidraw.production.min.js`, `dist/excalidraw-assets/…`), which `scripts/buildPackage.js` stopped emitting when the package moved to esbuild — it writes `dist/prod/`. Nothing matched, `size-limit` measured zero bytes and exited 1, and `andresz1/size-limit-action` reported "Size limit has been exceeded" on every pull request. Because this fork does not publish the package, the numbers are a change-detector rather than a budget we own: they sit roughly 15% above the current gzipped sizes so that a sync which moves the editor bundle materially is visible. **If a sync trips one, read the diff and then raise it** — do not go looking for fat to trim on upstream's behalf. Worth sending upstream, where the same config is presumably just as red.

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

- **Collaboration.** Always on — there is no flag for it, by product decision. A live session opens a socket to `VITE_APP_WS_SERVER_URL`, which in development is now the Unobravo relay (see below), and writes the scene and its images to the Firebase project, which still points at Excalidraw. Repointing Firebase, and finding a production relay, are go-live prerequisites rather than optimisations; `.env.production` says so at each endpoint.
- **Opening a shareable link.** `shareLinks: false` stops the app _offering_ to publish one. A `#json=` or `?id=` URL a user is sent still loads and still fetches from the share backend, exactly as upstream. Gating the inbound side would not have been safer, only inconsistent: collaboration leans on the same infrastructure and is unconditional.
- **Mermaid.** It lives inside the TTD dialog but has its own toolbar entry, which upstream does not gate on `aiEnabled` (`packages/excalidraw/components/Toolbar.tsx`). With `ai: false` that entry still opens the dialog — as the `__fallback` instance from `LayerUI`, which renders the mermaid tab and not text-to-diagram. Mermaid runs locally, so there is no call to `VITE_APP_AI_BACKEND`.
- **Local libraries.** The IndexedDB store and `.excalidrawlib` import/export stay in the code. With `library: false` there is no UI reaching them, `useHandleLibrary` is inert, and `Library.updateLibrary` refuses writes, so nothing accumulates in a store the user cannot see.
- **`libraries.excalidraw.com` links inside `PublishLibrary` and `LibraryMenuBrowseButton`.** They are unreachable only because `libraryEnabled: false` removes the tab, not because `externalLinksEnabled` covers them. Turning `library` back on with `socials` off would bring them back.
- **Branding.** The app name, the page title, the OG/Twitter title and description text, and the PWA manifest still say Excalidraw. That is naming, and it is a separate piece of work. What _was_ removed from `excalidraw-app/index.html` is the part that is not naming: the Excalidraw+ auto-redirect, the Simple Analytics loader, the `rel="canonical"` and absolute `og:url`/`twitter:url` pointing at excalidraw.com, and the Google Fonts preconnects that nothing uses. Those are instructions and network calls, not labels, and none of them can be reached by a feature flag.
- **Third-party endpoints in `.env.production`.** They still point at Excalidraw. They are deliberately not blanked: an empty base URL turns `fetch(BACKEND_V2_POST)` into a same-origin POST of the user's scene, which is quieter and harder to spot than an obviously foreign host. The flags are the gate; the `TODO(unobravo)` markers say what has to change before each is switched back on.
- **`ExcalidrawFontFace.ASSETS_FALLBACK_URL`.** After `EXCALIDRAW_ASSET_PATH` fails, the editor falls back to `https://esm.sh/@excalidraw/excalidraw/dist/prod/`. Left alone: it is the published package's fallback for library consumers, and in this build it is only reachable if a same-origin font 404s — which `unobravo/vite/fontAssetsPlugin` prevents by failing the build when the font tree is missing.
- **Bundle size.** The gates are property reads on an imported object, not compile-time constants, so the gated modules are still bundled — dead, but present. If size becomes a concern, stub them via `resolve.alias` in `excalidraw-app/vite.config.mts`; no other file changes.

## The collaboration relay

`whiteboard-relay.unobravo.xyz` replaces upstream's collaboration server. It speaks socket.io (Engine.IO v4), and differs from `excalidraw/excalidraw-room` in one way that matters: it **refuses an unauthenticated handshake**.

```
no auth.token      → connect_error: "Authentication required"
invalid auth.token → connect_error: "Authentication failed"
```

The credential is a Firebase ID token from the `uno-bravo-dev` project — `iss: https://securetoken.google.com/uno-bravo-dev` — carrying `role`, `unbv_id` and `unbv_uuid` claims. The whiteboard has no login of its own and no Firebase SDK, so it cannot mint or refresh one. It is handed the token in the query string, and `unobravo/collab/relayAuth.ts` reads it.

That module is ours; the cost to the fork is a single line in `excalidraw-app/collab/Collab.tsx`, inside the existing `socketIOClient(…)` call. It is level 4 rather than level 3 on purpose: upstream's server needs no credential, so a `collabAuth` prop is not a shape upstream would accept, and inventing one would mean touching `types.ts`, `index.tsx` and `App.tsx` for a line that would never be sent upstream anyway.

`excalidraw-app/components/unobravo/relayHandshake.test.tsx` asserts the options object `socket.io-client` is actually called with. That gate is exactly the kind a merge drops while resolving cleanly — the import survives, the property does not — and nothing else in the app would notice.

### The protocol, and the one event upstream does not have

The relay's source lives in the backend monorepo at `apps/whiteboard-relay`, and its `AGENTS.md` describes the protocol as ported from Excalidraw's own room protocol. Reading `src/web/handlers/room.handlers.ts` confirms it: `init-room` on connect, `join-room` → `first-in-room` / `new-user` plus `room-user-change`, `server-broadcast`, `server-volatile-broadcast`, `user-follow` → `user-follow-room-change`, and presence pruning on `disconnecting`. Everything `Portal.tsx` and `Collab.tsx` speak is there, and the payloads are forwarded opaque — the end-to-end encryption is untouched.

Two additions upstream has no equivalent for:

- **The relay keeps a versioned scene snapshot per room**, and replays it to a joiner on `join-room` as a `client-broadcast`. `server-broadcast` also accepts a fourth callback argument and acks the sender with `{ version }`; upstream passes no callback, so this is inert for us.
- **`request-scene(roomID, cb)`** returns the stored snapshot, or `null`. Upstream never emits it.

The snapshot is what makes the Firebase question interesting rather than mechanical. Upstream's reason for writing the scene to Firebase is so a late joiner is not left blank — which the relay now does by itself. So the Firebase collaboration writes are arguably redundant rather than merely mispointed, and the follow-up is a choice between repointing them and deleting them. That decision is out of scope here, but it should be made on this basis and not on the assumption that Firebase is load-bearing.

### The `socketInitialized` race, which the Firebase removal will expose

`initializeRoom({ fetchScene: true })` sets `this.portal.socketInitialized = true` in a `finally`, whatever Firebase returned (`excalidraw-app/collab/Collab.tsx`, in the `fetchScene` branch). The relay emits `first-in-room` and the replayed snapshot back to back from the same handler, so two async paths race:

- `first-in-room` → `resetScene()`, then `await loadFromFirebase(…)` — a network round trip — then the `finally` that raises the flag;
- `client-broadcast` → `await decryptPayload(…)` — local AES-GCM, sub-millisecond — then `if (!this.portal.socketInitialized)`.

The decrypt wins today — verified against the staging relay with two browser tabs: with one tab disconnected and the other's `localStorage` cleared, rejoining the room rendered the scene from the relay's snapshot, `socketInitialized` true and Firebase having contributed nothing. So the replayed scene is applied and nobody notices.

It wins only because Firebase is slow. Make `loadFromFirebase` fast — offline, blocked, or removed — and the flag is raised first, the replayed snapshot is dropped on the floor, and the joiner sees an empty board while the relay is holding the scene.

Nothing is done about it here, because the trigger is the Firebase work and the fix belongs with it. Whoever does that work has to handle this in the same change.

### Why the token is read eagerly

At module load, not at connection time, because **starting a new session rewrites the URL before it opens the socket**. `startCollaboration` pushes `getCollaborationLink(…)` — `origin + pathname + #room=…`, with no query string — and only then constructs the `socketIOClient`. Verified in a browser: a page opened at `?ubToken=…`, after "Start session", sits at `#room=a283073befe96fbae567,…` with the query string gone.

What makes lazy actively worse than merely wrong is that it fails on one path only. Joining someone's `#room=` link leaves the query string alone, so a lazy read would work there and fail when creating a room — an intermittent, flow-dependent auth failure instead of an obvious one.

`initializeScene` in `excalidraw-app/App.tsx` also blanks the URL, but narrowly: only for `?id=` / `#json=` / `#url=` scenes, and when the user declines the overwrite prompt. Its `replaceState` for external scenes sits behind `if (!roomLinkData)`, so a `#room=` link keeps its query string, and a plain load is never touched at all.

The consequence to know: on a plain load the token stays in the address bar until a session starts, so it is visible and it survives a reload. Once a session starts it is gone from the URL — which keeps it out of the link the user copies, but also means a reload from that point has no token and collaboration stops connecting until the parent application re-opens the app with a fresh one.

### Known gaps

- **No token refresh.** Firebase ID tokens expire after an hour, always. socket.io reconnects reusing the same `auth`, so an expired token means a reconnection loop of "Authentication failed". Accepted for now by product decision. Worse than it sounds on the relay side: it stubs out the token-revocation cache, so a token revoked mid-session also stays accepted until it expires.
- **The relay we have is the staging deployment**, `whiteboard-relay.unobravo.xyz`. The production one is `whiteboard-relay.unobravo.com` — it is configured in the relay's `pulumi/Pulumi.production.yaml` but not deployed; its DNS does not resolve. So `.env.production` still points at `oss-collab.excalidraw.com` and keeps its `TODO`.
- **Production CORS will reject a Vercel origin.** The staging allowlist is `localhost`, `127.0.0.1`, `.unobravo.xyz`, `unobravo.vercel.app` — matched as unanchored substrings, so preview deploys on this fork's Vercel team are covered. Production's is `.unobravo.com` and nothing else. This app is deployed by Vercel (`vercel.json`, upstream's and unmodified), so unless production serves it from a `*.unobravo.com` host, the socket handshake will be refused. Go-live item, on the relay's side or ours.
- **One relay task, and the snapshot dies with it.** All relay state is in the task's memory, so it runs a single ECS task by design, and a redeploy drops every room's snapshot and presence. Versioning restarts at 1 on the next `server-broadcast`. Fine while the scene also lives in the browser; it is the reason the snapshot cannot yet be treated as durable storage.
- **Firebase is still Excalidraw's.** `saveCollabRoomToFirebase` and the image upload in `Collab.tsx` continue to write to `excalidraw-room-persistence`, so the scene of a live session still leaves for Excalidraw's infrastructure. Unobravo has a Firebase project already — the same one verifying these tokens — but the decision is now whether to repoint those calls or drop them, given the relay's own snapshot. Either way it needs Firestore and Storage rules first, and is deliberately not part of this change.
- **The polling fallback is dead.** The relay sets `transports: ['websocket']` deliberately, to avoid needing ALB sticky sessions, and so rejects polling (`{"code":0,"message":"Transport unknown"}`). Harmless, because upstream lists `["websocket", "polling"]` and so tries websocket first; left alone rather than spending a second upstream edit on it.
- **The ALB answers `403` to a non-browser `User-Agent`** on a WebSocket upgrade. Not visible in the relay's own `pulumi/`, so it comes from something in front of it. Real browsers are fine; anything headless is not. So the tests mock `socket.io-client` and never reach it, which is what upstream's own collaboration tests do anyway.
- **A rejected origin answers `500`, not `403`.** `corsOriginChecker` in the relay hands an `Error` to its callback, which surfaces as a server error. Cosmetic, but it reads as the service being broken rather than the caller being refused, and it is worth reporting: it cost time diagnosing exactly that.

## Known gap in the level-3 mechanism

`ActionManager.handleKeyDown` filters on `UIOptions.canvasActions` and `keyTest` only — it never evaluates `predicate`. `actionAddToLibrary` has no keybinding today, so nothing leaks, but the day upstream gives it one the gate is bypassed by keypress with no test failure. If the `libraryEnabled` prop goes upstream, that fix should go with it.

## Deploy

The app is a static SPA on S3 behind CloudFront, in the two AWS accounts platform provisioned for it in [ROCK-2745](https://unobravo.atlassian.net/browse/ROCK-2745).

| Environment  | Host                      | Variable suffix |
| ------------ | ------------------------- | --------------- |
| `staging`    | `whiteboard.unobravo.xyz` | `_DEV`          |
| `production` | `whiteboard.unobravo.com` | `_PROD`         |

Roles, bucket names and distribution ids come from repository variables — `AWS_ROLE_ARN_*`, `AWS_S3_BUCKET_APP_*`, `CLOUDFRONT_DISTRIBUTION_*`, set by platform. Their suffixes predate the environment names, hence the third column: nothing in the pipeline hardcodes an account, a bucket or a distribution, and nothing here should either. Authentication is OIDC federation, so there are no AWS secrets in this repository. The OIDC subject is `repo:unobravo/whiteboard-fe:environment:<name>`, not a ref, because the deploy job names a GitHub environment — the same shape dragon-fe uses, which is why those roles' trust policies accept it.

Four workflows, all ours:

- `unobravo-deploy.yml` — every push to `master` builds once and promotes the same bytes to staging, then production. There is no approval gate, which means **an upstream sync reaches production as soon as it is merged**. It has no `workflow_dispatch`, deliberately: that would put an arbitrary branch on production in two clicks. Its first job refuses a run whose commit is no longer `master`'s head, so re-running an old run cannot republish stale bytes.
- `unobravo-deploy-manual.yml` — `workflow_dispatch` with a `ref` and one environment. The rollback path, and how a branch gets onto staging without merging. Not sticky: it moves nothing, so the next push to `master` rolls forward over it. To make a rollback permanent, revert on `master`.
- `unobravo-build-app.yml` — the reusable build both call: install, `yarn test:app`, `yarn build`, and assertions that the tree is servable before anything is published.
- `unobravo-deploy-app.yml` — the reusable publish both call: resolve the environment's variables, `aws s3 sync`, invalidate CloudFront, then check the host serves the version just built.

Four things about it are deliberate rather than incidental:

- **A release is a commit, not a tag.** dragon-fe computes semver from the latest `v*` tag and pushes a new one; here that would mint `v0.18.2` and collide with Excalidraw's next release, because this fork carries all nineteen of upstream's `v*` tags. The deployed commit is in `build/version.json`, written by the existing `build:version` script.
- **Cache headers follow what Vite hashes.** `fonts/` goes up first — `woff2BrowserPlugin` rewrites `@font-face` sources to absolute `/fonts/…` urls that live inside the `assets/` chunks — and gets thirty days without `immutable`, because four upstream families ship unhashed filenames. `assets/` is content-hashed, so it is immutable for a year and synced `--size-only`. Everything that names a hashed file, `index.html` and `sw.js` included, goes last and is `no-cache`. Nothing is ever deleted, so a tab loaded before a deploy still resolves its lazy imports. Changing one of those headers only affects objects the sync re-uploads: to apply a new header to what is already there, run `aws s3 cp --recursive --metadata-directive REPLACE` once.
- **The unit suite gates the deploy.** `test.yml` also runs `yarn test:app` on pushes to `master`, but as a separate workflow it races the deploy instead of blocking it. `fork:check` is not in this path on purpose — it is a pull-request check, and by the time a push to `master` exists there is nothing left for it to prevent.
- **Staging is a gate, not a preview.** The publish ends by fetching `version.json` from the host and comparing it to what was built, so `deploy-production: needs: deploy-staging` means "staging is really serving this build" rather than "`aws s3 sync` exited 0".

Being deployed is what turns [What is deliberately _not_ gated](#what-is-deliberately-not-gated) from a note into an exposure. Collaboration is unconditional and still opens a socket to `oss-collab.excalidraw.com` and writes scenes to Excalidraw's Firebase project; an inbound `#json=` link still fetches from their share backend. `whiteboard.unobravo.com` is public and unauthenticated. Repointing those endpoints was already listed as a go-live prerequisite — publishing the app does not change that, it just makes it reachable.

Two things the deployment does not have, both tracked separately: **error reporting**, because `.env.production` disables Sentry and `sentry.ts`'s `SentryEnvHostnameMap` knows only Excalidraw's hostnames, so a regression from an auto-deployed upstream sync is invisible until somebody reports it; and a **crawler block that actually blocks**, because `public/robots.txt` ends `Allow: /` before `Disallow: /`, and equal-length rules resolve in favour of `Allow`.

## Routine when syncing with upstream

```
git fetch excalidraw
git merge excalidraw/master
yarn fork:check      # register accurate? overlays still in sync?
yarn test:all
```

Never push a sync straight to `master`: the `fork-check` job is `on: pull_request` only, so a direct push skips the one check that catches overlay drift. Open a branch and a PR.

`.claude/skills/upstream-sync/` is the same routine written out in full — preflight, conflict triage by mechanism level, the overlay port, CI, and a run log it keeps of its own mistakes. Use it, or read it; it is where the reasoning behind the four lines above lives.
