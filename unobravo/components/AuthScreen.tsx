import { COPY } from "../copy";

import type { UnobravoAuthState } from "../types";
import type { CSSProperties } from "react";

const containerStyle: CSSProperties = {
  alignItems: "center",
  display: "flex",
  flexDirection: "column",
  fontFamily: "Assistant, sans-serif",
  gap: "0.75rem",
  height: "100%",
  justifyContent: "center",
  padding: "1.5rem",
  textAlign: "center",
};

const titleStyle: CSSProperties = {
  fontSize: "1.125rem",
  fontWeight: 600,
  margin: 0,
};

const detailStyle: CSSProperties = {
  color: "#666",
  margin: 0,
  maxWidth: "32rem",
};

/**
 * Shown instead of the editor while the session is being resolved, and when it
 * cannot be resolved. The editor is never mounted in either case.
 */
export const AuthScreen = ({
  state,
  onRetry,
}: {
  state: Extract<UnobravoAuthState, { status: "loading" | "error" }>;
  onRetry: () => void;
}) => {
  if (state.status === "loading") {
    return (
      <div style={containerStyle} role="status" aria-live="polite">
        <p style={titleStyle}>{COPY.loadingTitle}</p>
      </div>
    );
  }

  return (
    <div style={containerStyle} role="alert">
      <p style={titleStyle}>{COPY.errorTitle}</p>
      <p style={detailStyle}>{COPY.errorByCode[state.error.code]}</p>
      <button type="button" onClick={onRetry}>
        {COPY.retry}
      </button>
    </div>
  );
};
