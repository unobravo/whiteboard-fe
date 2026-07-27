/**
 * Public surface of the Unobravo integration layer.
 *
 * `excalidraw-app` must import from this module only, so that the layer's
 * internals can be reorganised without touching upstream files. Nothing under
 * `packages/` may import from here at all.
 */
export { UnobravoProvider } from "./components/UnobravoProvider";
export { UnobravoExcalidraw } from "./components/UnobravoExcalidraw";
export { useUnobravoIntegration } from "./hooks/useUnobravoIntegration";

export type {
  UnobravoFeatureFlags,
  UnobravoIntegration,
  UnobravoUser,
} from "./types";
