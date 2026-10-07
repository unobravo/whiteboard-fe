import React from "react";

import { MIME_TYPES, randomId, reseed } from "@excalidraw/common";
import * as blobModule from "@excalidraw/excalidraw/data/blob";
import { Excalidraw } from "@excalidraw/excalidraw/index";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import { mockMultipleHTMLImageElements } from "@excalidraw/excalidraw/tests/helpers/mocks";
import {
  GlobalTestState,
  render,
  waitFor,
} from "@excalidraw/excalidraw/tests/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FileId } from "@excalidraw/element/types";
import type { ImageOptions } from "@excalidraw/excalidraw/types";

const { h } = window;

/**
 * Covers the `imageOptions.processImageFile` hook added in
 * `packages/excalidraw` (an upstream candidate, see `unobravo/FORK.md`), so it
 * is written against the public component.
 */
describe("imageOptions.processImageFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    reseed(7);

    vi.spyOn(blobModule, "generateIdFromFile").mockImplementation(() =>
      Promise.resolve(randomId() as FileId),
    );
    vi.spyOn(blobModule, "resizeImageFile");

    Object.assign(document, {
      elementFromPoint: () => GlobalTestState.canvas,
    });
  });

  const setup = async (imageOptions: ImageOptions) => {
    await render(
      <Excalidraw
        autoFocus={true}
        handleKeyboardGlobally={true}
        imageOptions={imageOptions}
      />,
    );
    h.state.height = 1000;
    mockMultipleHTMLImageElements([[100, 100]]);
  };

  const source = () =>
    new File([new Uint8Array(2048)], "photo.png", { type: MIME_TYPES.png });

  it("replaces the resize step, and the file it returns is what gets stored", async () => {
    const compressed = new File([new Uint8Array(16)], "photo.png", {
      type: MIME_TYPES.jpg,
    });
    const processImageFile = vi.fn(async () => compressed);
    await setup({
      maxWidthOrHeight: 1600,
      maxFileSizeBytes: 1024 * 1024,
      outputType: MIME_TYPES.jpg,
      processImageFile,
    });

    const file = source();
    await API.drop([{ kind: "file", file }]);

    await waitFor(() => {
      expect(Object.values(h.app.files)).toEqual([
        expect.objectContaining({ mimeType: MIME_TYPES.jpg }),
      ]);
    });
    expect(processImageFile).toHaveBeenCalledWith(file, {
      maxWidthOrHeight: 1600,
      maxFileSizeBytes: 1024 * 1024,
      outputType: MIME_TYPES.jpg,
    });
    expect(blobModule.resizeImageFile).not.toHaveBeenCalled();
  });

  it("inserts the original file when the hook throws, as without the hook", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await setup({
      maxFileSizeBytes: 1024 * 1024,
      processImageFile: async () => {
        throw new Error("compression failed");
      },
    });

    await API.drop([{ kind: "file", file: source() }]);

    await waitFor(() => {
      expect(Object.values(h.app.files)).toEqual([
        expect.objectContaining({ mimeType: MIME_TYPES.png }),
      ]);
    });
  });

  it("calls the hook again when the host replaces it", async () => {
    const first = vi.fn(async (file: File) => file);
    const second = vi.fn(async (file: File) => file);
    const { rerender } = await render(
      <Excalidraw imageOptions={{ processImageFile: first }} />,
    );
    rerender(<Excalidraw imageOptions={{ processImageFile: second }} />);
    h.state.height = 1000;
    mockMultipleHTMLImageElements([[100, 100]]);

    await API.drop([{ kind: "file", file: source() }]);

    // `areEqual` compares the hook: a memoised <Excalidraw> would keep `first`
    await waitFor(() => expect(second).toHaveBeenCalled());
    expect(first).not.toHaveBeenCalled();
  });

  it("still enforces maxFileSizeBytes on what the hook returns", async () => {
    await setup({
      maxFileSizeBytes: 1024 * 1024,
      processImageFile: async () =>
        new File([new Uint8Array(2 * 1024 * 1024)], "big.jpg", {
          type: MIME_TYPES.jpg,
        }),
    });

    await API.drop([{ kind: "file", file: source() }]);

    await waitFor(() => {
      expect(h.state.errorMessage).toBe(
        "File is too big. Maximum allowed size is 1MB.",
      );
    });
  });
});
