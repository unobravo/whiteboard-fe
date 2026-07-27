# Unobravo integration layer

This directory is the whole Unobravo-specific layer on top of the Excalidraw fork. It provides three things:

1. **Auth** — the session comes from the embedding Unobravo page; the editor is not mounted until it is resolved.
2. **Feature flags** — per-environment gates for whiteboard features.
3. **Board id** — the `{boardId}` from `whiteboard.unobravo.com/{boardId}`.

Everything else stays upstream Excalidraw, so merging new upstream commits stays cheap.

## Inert by default

With no configuration the layer does nothing: all flags are `true`, no `postMessage` traffic happens, and `useUnobravoIntegration()` works even with no provider mounted. An unconfigured build is byte-for-byte upstream behaviour — that is what keeps the existing app tests (including the `MobileMenu` DOM snapshot) passing untouched.

## Configuration

All variables are read from the repo-root `.env*` files (the app sets `envDir: "../"`) or from real environment variables at build time. None of them are required.

| Variable | Default | Meaning |
| --- | --- | --- |
| `VITE_APP_UNOBRAVO_AUTH_MODE` | `disabled` | `disabled` \| `mock` \| `parent` |
| `VITE_APP_UNOBRAVO_PARENT_ORIGINS` | — | comma-separated origins allowed to provide the session; **required** for `parent` |
| `VITE_APP_UNOBRAVO_AUTH_TIMEOUT_MS` | `10000` | how long to wait for the host |
| `VITE_APP_UNOBRAVO_ALLOW_FLAG_OVERRIDES` | `false` | allow `?ub*` query overrides outside dev |
| `VITE_APP_UNOBRAVO_ENABLE_COLLABORATION` | `true` | live collaboration |
| `VITE_APP_UNOBRAVO_ENABLE_SHARE_LINKS` | `true` | uploading the scene to Excalidraw's cloud |
| `VITE_APP_UNOBRAVO_ENABLE_EXPORT` | `true` | the JSON export dialog |
| `VITE_APP_UNOBRAVO_ENABLE_SAVE_AS_IMAGE` | `true` | the image export dialog |
| `VITE_APP_UNOBRAVO_ENABLE_SAVE_TO_DISK` | `true` | saving a file to disk |
| `VITE_APP_UNOBRAVO_ENABLE_LOAD_FROM_FILE` | `true` | loading a file from disk |
| `VITE_APP_UNOBRAVO_ENABLE_IMAGES` | `true` | the image tool |
| `VITE_APP_UNOBRAVO_ENABLE_AI` | `true` | AI features (**also covers Mermaid import**) |

The gates only ever _remove_ capability: anything the app already disabled stays disabled. Note `saveToDisk` is expressed inside `canvasActions.export`, so `ENABLE_EXPORT=false` disables saving to disk too, whatever `ENABLE_SAVE_TO_DISK` says — the JSON export dialog is the only surface carrying it.

Flags resolve as **defaults → env → query string**, and query overrides (`?ubImages=false`) are honoured only in dev or behind `VITE_APP_UNOBRAVO_ALLOW_FLAG_OVERRIDES`, so end users cannot re-enable a gated feature in production.

For local development put the values in a git-ignored `.env.local`:

```
VITE_APP_UNOBRAVO_AUTH_MODE=mock
VITE_APP_UNOBRAVO_ENABLE_SHARE_LINKS=false
```

## The host handshake (`parent` mode)

```
whiteboard → host   { type: "unobravo:auth-request",  boardId, requestId }
host → whiteboard   { type: "unobravo:auth-response", ok: true,  token, user, requestId }
host → whiteboard   { type: "unobravo:auth-response", ok: false, code: "unauthorized" }
whiteboard → host   { type: "unobravo:auth-error",    code }
```

The request is re-sent every 250 ms until the host answers (the host may attach its listener after the iframe loads) and gives up after the configured timeout.

Security rules the implementation follows, and which must be kept:

- incoming messages are accepted only from an allowlisted `event.origin` **and** only when `event.source === window.parent`;
- outgoing messages always carry an explicit target origin, never `"*"`;
- the payload shape is validated, never cast;
- a reply carrying a mismatching `requestId` is ignored;
- when not embedded, or when the allowlist is empty, auth **fails closed**;
- tokens are never logged (`console.error` is captured by Sentry).

## Upstream files touched

Every edit is marked with a `// UNOBRAVO:` comment, so `git grep UNOBRAVO` lists the entire merge surface:

| File | Why |
| --- | --- |
| `excalidraw-app/index.tsx` | mounts `<UnobravoProvider>` |
| `excalidraw-app/App.tsx` | collab gate, `<UnobravoExcalidraw>`, AI children, command-palette predicates, `<ShareDialog>` mount, Excalidraw+ upload actions |
| `excalidraw-app/components/AppMainMenu.tsx` | `Export` / `SaveAsImage` items don't self-gate |
| `excalidraw-app/components/AppWelcomeScreen.tsx` | `MenuItemLoadScene` runs its action through `executeAction`, which skips predicates |
| `excalidraw-app/share/ShareDialog.tsx` | gate the shareable-link section |
| `packages/excalidraw/components/MobileToolbar.tsx` | honour `UIOptions.tools.image`, as the desktop toolbar already does |
| `packages/excalidraw/actions/actionExport.tsx` | `actionSaveFileToDisk` had no `predicate`, and `handleKeyDown` never evaluates predicates, so the shortcut bypassed the option |
| `packages/excalidraw/components/App.tsx` | honour `canvasActions.loadScene` on the drag & drop / paste ingress paths, and on the image-export shortcut |
| `packages/excalidraw/components/CommandPalette/CommandPalette.tsx` | gate the "Export image" entry on `canvasActions.saveAsImage` |
| `packages/excalidraw/components/welcome-screen/WelcomeScreen.Center.tsx` | its "Open" item bypasses action predicates, same as the app's |
| `tsconfig.json`, `.dockerignore` | include this directory (`.dockerignore` is an allowlist) |
| `vercel.json`, `Dockerfile`, `nginx.conf` | SPA fallback, so `/{boardId}` resolves to the app shell |
| `packages/excalidraw/CHANGELOG.md` | the public-API behaviour changes above |

Every `packages/**` entry is an upstream inconsistency rather than Unobravo-specific behaviour — each one is a public option that some surface ignored — so they are all candidates to send upstream. Note the marker convention covers code: `tsconfig.json`, `.dockerignore`, `vercel.json` and the CHANGELOG carry no `UNOBRAVO` comment.

Nothing under `packages/**` imports from this directory: the flags reach the editor only through its existing public props.

## Known gaps

- **No real board persistence.** Storage is still upstream's: `STORAGE_KEYS` in `excalidraw-app/app_constants.ts` are per-origin, so there is one stored scene per browser profile. As a stop-gap the layer records which user + board the stored scene belongs to and **discards it when it belongs to someone else** (`unobravo/board/sceneScope.ts`), so a second user on a shared device cannot see or overwrite the previous user's board. The consequence is that switching board or user starts from an empty canvas: boards do not persist independently until backend persistence lands. Note the image files cache (`files-db` in IndexedDB) is not scoped, so image blobs from a previous session can survive — they are unreachable without the elements that reference them, but they are not erased.
- **Upstream telemetry.** In production `excalidraw-app/index.html` loads Excalidraw's SimpleAnalytics script, and `excalidraw-app/sentry.ts` enables Excalidraw's Sentry DSN on any `*.vercel.app` hostname. Tracked separately.
- **Laser pointer and embeds have no flag.** `UIOptions.tools` is typed for `image` only, and `interaction`'s object form makes the editor inert instead of subtracting a tool, so hiding those buttons needs a `Toolbar.tsx` patch.
- **Side effects still run before auth.** Sentry init and service-worker registration happen at import time in `excalidraw-app/index.tsx`; gating them would require lazy-loading the app.
- **Scene import via URL is not gated** (`#json=`, `#url=` in `initializeScene`).
- **Excalidraw branding remains** (Excalidraw+ links, socials).
- **The Docker image cannot be configured from outside.** `Dockerfile` declares no `ARG`/`ENV` for `VITE_APP_UNOBRAVO_*`, and Vite inlines env at build time, so the Docker path currently requires editing the root `.env.production`. The Vercel path works as documented (dashboard variables are real build-time env).
- **Auth gates mounting, not data.** The session check controls who can open the editor. Nothing consumes the token yet (`UnobravoIntegration` deliberately does not expose it), so there is no server-side authorization of board contents — that arrives with the backend.
- In local dev, opening the app inside an iframe on the _same_ origin trips upstream's self-embed guard before the layer runs.
