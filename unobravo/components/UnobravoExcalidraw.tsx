import { Excalidraw } from "@excalidraw/excalidraw";
import { useMemo } from "react";

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

  // memoised because the editor's memo comparator compares `UIOptions.tools`
  // by reference: recomputing it every render would re-render the whole editor
  const UIOptions = useMemo(
    () => applyFeatureFlags(props.UIOptions, flags),
    [props.UIOptions, flags],
  );

  return (
    <Excalidraw
      {...props}
      UIOptions={UIOptions}
      aiEnabled={flags.ai && props.aiEnabled !== false}
    />
  );
};
