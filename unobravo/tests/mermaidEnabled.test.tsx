import React from "react";

import { Excalidraw } from "@excalidraw/excalidraw/index";
import { t } from "@excalidraw/excalidraw/i18n";
import { mockMermaidToExcalidraw } from "@excalidraw/excalidraw/tests/helpers/mocks";
import {
  fireEvent,
  render,
  waitFor,
} from "@excalidraw/excalidraw/tests/test-utils";
import { vi } from "vitest";

const { h } = window;

/**
 * Covers the `mermaidEnabled` prop added in `packages/excalidraw`.
 *
 * The prop is modelled on upstream's `aiEnabled` and is a candidate to send
 * upstream (see `unobravo/FORK.md`), so these tests are written against the
 * public component rather than against our gating layer.
 *
 * Each case asserts the *affordance* is gone, not that a prop was threaded
 * through: hiding the toolbar entry while leaving the dialog route open would be
 * a silent leak, and so would leaving the "Generate" heading behind with nothing
 * under it.
 */

// as upstream's own mermaid test does: makes the CodeMirror dynamic import fail
// so the dialog falls back to a plain <textarea>
vi.mock("@codemirror/view", () => ({}));
vi.mock("@codemirror/state", () => ({}));
vi.mock("@codemirror/language", () => ({}));
vi.mock("@lezer/highlight", () => ({}));

// the dialog awaits the parser on mount; nothing here asserts what it draws
mockMermaidToExcalidraw({
  parseMermaidToExcalidraw: async () => ({ elements: [] }),
});

const openExtraTools = () => {
  const trigger = document.querySelector<HTMLElement>(
    ".App-toolbar__extra-tools-trigger",
  );
  expect(trigger).not.toBe(null);
  fireEvent.click(trigger!);

  const dropdown = document.querySelector<HTMLElement>(
    ".App-toolbar__extra-tools-dropdown",
  );
  expect(dropdown).not.toBe(null);
  // positive control: an absence assertion below is only evidence about the gate
  // if the menu it looks in actually opened and is populated
  expect(dropdown!.querySelector('[data-testid="toolbar-laser"]')).not.toBe(
    null,
  );
  return dropdown!;
};

const mermaidDialogState = {
  appState: { openDialog: { name: "ttd", tab: "mermaid" } },
} as const;

describe("mermaidEnabled", () => {
  it("shows the mermaid entry and its heading by default", async () => {
    await render(<Excalidraw />);

    const dropdown = openExtraTools();

    expect(dropdown.textContent ?? "").toContain(
      t("toolBar.mermaidToExcalidraw"),
    );
    expect(dropdown.textContent ?? "").toContain("Generate");
  });

  it("removes the mermaid entry and the now-empty heading when disabled", async () => {
    // `aiEnabled` already defaults on here, so the heading disappearing proves
    // the gate covers the group and not just the row
    await render(<Excalidraw mermaidEnabled={false} aiEnabled={false} />);

    const dropdown = openExtraTools();

    expect(dropdown.textContent ?? "").not.toContain(
      t("toolBar.mermaidToExcalidraw"),
    );
    expect(dropdown.textContent ?? "").not.toContain("Generate");
  });

  it("keeps the heading while the AI trigger still needs it", async () => {
    await render(<Excalidraw mermaidEnabled={false} />);

    const dropdown = openExtraTools();

    expect(dropdown.textContent ?? "").not.toContain(
      t("toolBar.mermaidToExcalidraw"),
    );
    expect(dropdown.textContent ?? "").toContain("Generate");
  });

  it("opens the dialog from app state by default", async () => {
    await render(<Excalidraw initialData={mermaidDialogState} />);

    await waitFor(() => {
      expect(document.querySelector(".ttd-dialog")).not.toBe(null);
    });
  });

  it("refuses the dialog route when disabled", async () => {
    await render(
      <Excalidraw mermaidEnabled={false} initialData={mermaidDialogState} />,
    );

    // the dialog mounts synchronously with the editor, so a render that has
    // produced the toolbar has already had its chance to produce the dialog
    await waitFor(() => {
      expect(document.querySelector(".App-toolbar")).not.toBe(null);
    });

    expect(document.querySelector(".ttd-dialog")).toBe(null);
  });

  // "phone" is the only form factor that renders `MobileToolbar` (LayerUI mounts
  // `MobileMenu` for it alone); "tablet" is the desktop `Toolbar` again, at a
  // compact width. Both are asserted because the two files carry duplicate code.
  it.each(["tablet", "phone"] as const)(
    "gates the entry on %s too",
    async (formFactor) => {
      await render(
        <Excalidraw
          mermaidEnabled={false}
          aiEnabled={false}
          UIOptions={{ getFormFactor: () => formFactor }}
        />,
      );
      fireEvent.resize(window);
      await waitFor(() =>
        expect(h.app.editorInterface.formFactor).toBe(formFactor),
      );

      const dropdown = openExtraTools();

      expect(dropdown.textContent ?? "").not.toContain(
        t("toolBar.mermaidToExcalidraw"),
      );
      expect(dropdown.textContent ?? "").not.toContain("Generate");
    },
  );
});

/**
 * Not covered here on purpose: pasting a mermaid definition still converts it,
 * and that path (`isMaybeMermaidDefinition` in `App.tsx`'s paste handler) reads
 * no prop at all — `packages/excalidraw/tests/clipboard.test.tsx` owns it.
 */
