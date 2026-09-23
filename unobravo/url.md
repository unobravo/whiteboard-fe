# Whiteboard launch URL spec

How the parent application must build the URL to open the whiteboard against the Unobravo collaboration relay.

## Format

```
{origin}/?authToken=<FIREBASE_ID_TOKEN>&patientId=<PATIENT_ID>&doctorId=<DOCTOR_ID>#room=<roomId>,<roomKey>
```

Example (local dev):

```
http://localhost:3001/?authToken=eyJhbGciOiJSUzI1NiI...&patientId=2100013138&doctorId=185#room=caccacaccacaccacacca42,caccacaccacaccacacca42
```

## Parts

| Part | Where | Format | Notes |
| --- | --- | --- | --- |
| `authToken` | **query string** (before `#`) | Firebase ID token (JWT) for the `uno-bravo-dev` project | Read once at module load by `unobravo/collab/relayAuth.ts` via `URLSearchParams(window.location.search)`. Sent to the relay as the socket.io handshake payload `auth: { token }`. |
| `patientId` | **query string** (before `#`) | integer | Read at the same moment as `authToken`, by the same module, and sent on the same handshake as `auth.patientId`, as a string of digits (`0185` is sent as `"185"`). Optional: a blank or non-numeric value is treated as absent and the key is left off the payload entirely. |
| `doctorId` | **query string** (before `#`) | integer | As `patientId`, sent as `auth.doctorId`. Note this is the _caller's_ `unbv_id` only when a doctor opens the whiteboard — the token can identify one participant, never the pair, which is why both ids are passed explicitly. |
| `room` | **fragment** (after `#`) | `#room=<roomId>,<roomKey>` | Matched by `RE_COLLAB_LINK = /^#room=([a-zA-Z0-9_-]+),([a-zA-Z0-9_-]+)$/` in `excalidraw-app/data/index.ts`. `roomId` identifies the relay room; `roomKey` is the AES key for end-to-end scene encryption. An inbound `#room=` link auto-starts collaboration. |

## Rules

1. **`authToken` goes in the query string, not the fragment.** Anything after `#` is the fragment; `window.location.search` is empty for a fragment-only param, so a token placed there is never read.
2. **The room key is `#room=`, not `#roomId=`.** The regex above anchors on `#room=` and on the exact `id,key` shape; any other name (e.g. `#roomId=`) or a trailing `?...` inside the fragment fails the match and no room is joined.
3. **Ordering.** Query string first, fragment last: `...?authToken=…#room=…`. A browser treats everything after the first `#` as the fragment, so a `?authToken=` written after `#` lands inside the fragment (see rule 1).
4. **The token must be a complete, unexpired Firebase ID token.** The whiteboard has no Firebase SDK and cannot mint or refresh one — the parent hands it in. Firebase ID tokens expire ~1 hour after issuance.
5. **`patientId` and `doctorId` must be plain integers below 2^53.** They are sent to the relay as digit strings. Anything the client cannot read as one exactly — non-numeric, fractional, or large enough to lose precision as a JavaScript number — is dropped rather than forwarded. A missing key is visible to the relay; a silently rounded id is somebody else's. Validating the pair against the token is the relay's job — the client cannot do it, and does not try.

## Relay handshake outcomes

The handshake payload is `auth: { token, patientId, doctorId }`, with each key present only when the URL carried it, and `auth` itself `undefined` when it carried none of them. The relay rejects an unauthenticated or invalid handshake. Observed on `connect_error`:

| Sent                                | Relay response            |
| ----------------------------------- | ------------------------- |
| no `auth.token`                     | `Authentication required` |
| invalid / expired / malformed token | `Authentication failed`   |
| valid token                         | connects; scene syncs     |

On `connect_error` there is nothing to fall back on — the relay is the only store — so the app shows an error and stays unsynced rather than presenting an empty board; socket.io retries, and the scene loads on the next successful connection. An auth rejection is not retried by socket.io, so it needs a fresh URL from the parent application.

## Verification

Open the URL in a browser with a valid token and a `#room=<id>,<key>` fragment:

- the socket connects to the deployed environment's relay (`/ws-config.json`; `VITE_APP_WS_SERVER_URL` in dev, `https://whiteboard-relay.unobravo.xyz`) authenticated;
- the room's existing scene loads onto the canvas;
- the **Share** button turns green (collaboration active).

A blank canvas with a green Share button, or an `Authentication failed` on the socket, means the token was rejected — check completeness and expiry.
