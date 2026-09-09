/**
 * The Unobravo gating layer.
 *
 * Deliberately dependency-free with respect to `excalidraw-app`: this package
 * only knows which features the fork ships, so the dependency runs one way
 * (`excalidraw-app` → `unobravo`) and never back. The components that consume
 * the flags to reshape the app shell live in
 * `excalidraw-app/components/unobravo/`.
 *
 * See `unobravo/FORK.md` for the register of upstream files this layer
 * modifies and why.
 */
export { FEATURES } from "./config/features";
export type { UnobravoFeatures } from "./config/features";
export { getRelayAuth, RELAY_TOKEN_PARAM } from "./collab/relayAuth";
export { getRelayUrl } from "./collab/relayUrl";
