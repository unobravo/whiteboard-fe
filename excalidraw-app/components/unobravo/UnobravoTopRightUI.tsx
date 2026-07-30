import { LiveCollaborationTrigger } from "@excalidraw/excalidraw";
import { isRunningInIframe } from "@excalidraw/common";
import React from "react";

import type { EditorInterface } from "@excalidraw/common";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { isExcalidrawPlusSignedUser } from "../../app_constants";
import CollabError from "../../collab/CollabError";
import { ExcalidrawPlusPromoBanner } from "../ExcalidrawPlusPromoBanner";

import type { CollabAPI } from "../../collab/Collab";
import type { UnobravoFeatures } from "../../../unobravo";

/**
 * Overlay of the `renderTopRightUI` callback in `excalidraw-app/App.tsx`.
 *
 * Upstream returns early on `isCollabDisabled`, which couples three unrelated
 * things once collaboration becomes a flag: the collaboration trigger, the
 * share entry point — the same button, whose visible label is
 * `t("labels.share")` — and the Excalidraw+ banner. Each is gated here on what
 * it actually needs.
 *
 * Lives in this directory rather than inline so the callback body is not thirty
 * lines of ours inside a file upstream edits often. See `unobravo/FORK.md`.
 */
export const UnobravoTopRightUI = ({
  isMobile,
  features,
  collabAPI,
  collabError,
  excalidrawAPI,
  editorInterface,
  isCollabDisabled,
  isCollaborating,
  onShareDialogOpen,
}: {
  isMobile: boolean;
  features: UnobravoFeatures;
  collabAPI: CollabAPI | null;
  collabError: React.ComponentProps<typeof CollabError>["collabError"];
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  editorInterface: EditorInterface;
  isCollabDisabled: boolean;
  isCollaborating: boolean;
  onShareDialogOpen: () => void;
}) => {
  const collabTriggerEnabled = !!collabAPI && !isCollabDisabled;

  // the share-only trigger covers the one case upstream never has:
  // collaboration gated off while share links stay on. Requiring
  // `!features.collaboration` keeps an unconfigured build identical to
  // upstream, which would have returned null before `collabAPIAtom` is
  // populated. `isRunningInIframe` is spelled out because `isCollabDisabled`
  // only covers the collaboration half.
  const shareTriggerEnabled =
    collabTriggerEnabled ||
    (features.shareLinks && !features.collaboration && !isRunningInIframe());

  // the banner keeps upstream's own precondition, because nothing about
  // Excalidraw+ wants relaxing
  const showPlusBanner =
    features.plus &&
    collabTriggerEnabled &&
    excalidrawAPI?.getEditorInterface().formFactor === "desktop";

  if (isMobile || (!shareTriggerEnabled && !showPlusBanner)) {
    return null;
  }

  return (
    <div className="excalidraw-ui-top-right">
      {showPlusBanner && (
        <ExcalidrawPlusPromoBanner isSignedIn={isExcalidrawPlusSignedUser} />
      )}

      {collabTriggerEnabled && collabError.message && (
        <CollabError collabError={collabError} />
      )}
      {shareTriggerEnabled && (
        <LiveCollaborationTrigger
          isCollaborating={isCollaborating}
          onSelect={onShareDialogOpen}
          editorInterface={editorInterface}
        />
      )}
    </div>
  );
};
