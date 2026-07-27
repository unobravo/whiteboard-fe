import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";

import "../excalidraw-app/sentry";

// UNOBRAVO: integration layer (auth + feature flags). Inert unless configured.
import { UnobravoProvider } from "../unobravo";

import ExcalidrawApp from "./App";

window.__EXCALIDRAW_SHA__ = import.meta.env.VITE_APP_GIT_SHA;
const rootElement = document.getElementById("root")!;
const root = createRoot(rootElement);
registerSW();
root.render(
  <StrictMode>
    {/* UNOBRAVO: gates the app on the host-provided session */}
    <UnobravoProvider>
      <ExcalidrawApp />
    </UnobravoProvider>
  </StrictMode>,
);
