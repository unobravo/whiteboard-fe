import { Excalidraw } from "@excalidraw/excalidraw";

import type { ExcalidrawProps } from "@excalidraw/excalidraw/types";

import { applyFeatureFlags } from "../excalidraw/applyFeatureFlags";
import { useUnobravoIntegration } from "../hooks/useUnobravoIntegration";

/**
 * Drop-in replacement for `<Excalidraw>` that applies the Unobravo feature
 * flags to the props the app passes.
 *
 * Keeping the merge here means the app's own `<Excalidraw>` prop list stays
 * untouched, which keeps upstream merges trivial.
 */
export const UnobravoExcalidraw = (props: ExcalidrawProps) => {
  const { flags } = useUnobravoIntegration();

  const UIOptions = applyFeatureFlags(props.UIOptions, flags);

  return (
    <Excalidraw
      {...props}
      UIOptions={UIOptions}
      aiEnabled={flags.ai && props.aiEnabled !== false}
    />
  );
};
