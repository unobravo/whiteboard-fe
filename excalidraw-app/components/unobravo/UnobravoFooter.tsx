import { Footer } from "@excalidraw/excalidraw/index";
import React from "react";

import { isExcalidrawPlusSignedUser } from "../../app_constants";
import { DebugFooter, isVisualDebuggerEnabled } from "../DebugCanvas";
import { EncryptedIcon } from "../EncryptedIcon";
import { useUnobravoFeatures } from "../../../unobravo";

/**
 * Overlay of `excalidraw-app/components/AppFooter.tsx` — see `UnobravoMainMenu`
 * for why the overlay pattern is used and how drift is caught.
 *
 * `EncryptedIcon` links to `plus.excalidraw.com/blog`, so it is gated on
 * `socials` (outbound third-party link) rather than on `plus`.
 */
export const UnobravoFooter = React.memo(
  ({ onChange }: { onChange: () => void }) => {
    const features = useUnobravoFeatures();

    return (
      <Footer>
        <div
          style={{
            display: "flex",
            gap: ".5rem",
            alignItems: "center",
          }}
        >
          {isVisualDebuggerEnabled() && <DebugFooter onChange={onChange} />}
          {features.socials && !isExcalidrawPlusSignedUser && <EncryptedIcon />}
        </div>
      </Footer>
    );
  },
);
