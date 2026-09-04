# Whiteboard launch URL spec

How the parent application must build the URL to open the whiteboard against the Unobravo collaboration relay.

## Format

```
{origin}/?authToken=<FIREBASE_ID_TOKEN>#room=<roomId>,<roomKey>
```

Example (local dev):

```
http://localhost:3001/?authToken=eyJhbGciOiJSUzI1NiI...#room=caccacaccacaccacacca42,caccacaccacaccacacca42
```

## Parts

| Part | Where | Format | Notes |
| --- | --- | --- | --- |
| `authToken` | **query string** (before `#`) | Firebase ID token (JWT) for the `uno-bravo-dev` project | Read once at module load by `unobravo/collab/relayAuth.ts` via `URLSearchParams(window.location.search)`. Sent to the relay as the socket.io handshake payload `auth: { token }`. |
| `room` | **fragment** (after `#`) | `#room=<roomId>,<roomKey>` | Matched by `RE_COLLAB_LINK = /^#room=([a-zA-Z0-9_-]+),([a-zA-Z0-9_-]+)$/` in `excalidraw-app/data/index.ts`. `roomId` identifies the relay room; `roomKey` is the AES key for end-to-end scene encryption. An inbound `#room=` link auto-starts collaboration. |

## Rules

1. **`authToken` goes in the query string, not the fragment.** Anything after `#` is the fragment; `window.location.search` is empty for a fragment-only param, so a token placed there is never read.
2. **The room key is `#room=`, not `#roomId=`.** The regex above anchors on `#room=` and on the exact `id,key` shape; any other name (e.g. `#roomId=`) or a trailing `?...` inside the fragment fails the match and no room is joined.
3. **Ordering.** Query string first, fragment last: `...?authToken=…#room=…`. A browser treats everything after the first `#` as the fragment, so a `?authToken=` written after `#` lands inside the fragment (see rule 1).
4. **The token must be a complete, unexpired Firebase ID token.** The whiteboard has no Firebase SDK and cannot mint or refresh one — the parent hands it in. Firebase ID tokens expire ~1 hour after issuance.

## Relay handshake outcomes

The relay rejects an unauthenticated or invalid handshake. Observed on `connect_error`:

| Sent                                | Relay response            |
| ----------------------------------- | ------------------------- |
| no `auth.token`                     | `Authentication required` |
| invalid / expired / malformed token | `Authentication failed`   |
| valid token                         | connects; scene syncs     |

On `connect_error` the app falls back to loading the scene from Firebase, which currently still points at Excalidraw's `excalidraw-oss-dev` project (see `unobravo/FORK.md`).

## Verification

Open the URL in a browser with a valid token and a `#room=<id>,<key>` fragment:

- the socket connects to the deployed environment's relay (`/ws-config.json`; `VITE_APP_WS_SERVER_URL` in dev, `https://whiteboard-relay.unobravo.xyz`) authenticated;
- the room's existing scene loads onto the canvas;
- the **Share** button turns green (collaboration active).

A blank canvas with a green Share button, or an `Authentication failed` on the socket, means the token was rejected — check completeness and expiry.
