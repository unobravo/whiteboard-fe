import React from "react";

import { Excalidraw } from "@excalidraw/excalidraw/index";
import BraveMeasureTextError from "@excalidraw/excalidraw/components/BraveMeasureTextError";
import { act, render, waitFor } from "@excalidraw/excalidraw/tests/test-utils";

const { h } = window;

/**
 * Covers the `externalLinksEnabled` prop added in `packages/excalidraw`.
 *
 * These surfaces are the ones no `UIOptions` entry reaches: the help dialog is
 * one keystroke away (`?`), and the Brave notice appears on a text-measurement
 * failure. Both link out to Excalidraw-owned properties, so a fork that has
 * removed Excalidraw's branding everywhere else still hands the user four
 * excalidraw.com links unless this prop exists.
 */
const openHelp = () =>
  act(() => {
    h.setState({ openDialog: { name: "help" } });
  });

const helpLinks = () =>
  Array.from(
    document.querySelectorAll<HTMLAnchorElement>('.HelpDialog a[href^="http"]'),
  );

describe("externalLinksEnabled", () => {
  it("shows the help dialog's link row by default", async () => {
    await render(<Excalidraw />);
    openHelp();

    await waitFor(() => {
      expect(document.querySelector(".HelpDialog__header")).not.toBe(null);
    });

    expect(helpLinks().length).toBe(4);
  });

  it("removes every outbound link from the help dialog when disabled", async () => {
    await render(<Excalidraw externalLinksEnabled={false} />);
    openHelp();

    // the dialog itself must still open — this gates the links, not help
    await waitFor(() => {
      expect(document.querySelector(".HelpDialog")).not.toBe(null);
    });

    expect(document.querySelector(".HelpDialog__header")).toBe(null);
    expect(helpLinks()).toHaveLength(0);
  });

  it("keeps the Brave notice's links by default", async () => {
    await render(<Excalidraw />);

    act(() => {
      h.setState({ errorMessage: <BraveMeasureTextError /> });
    });

    await waitFor(() => {
      expect(
        document.querySelector('[data-testid="brave-measure-text-error"]'),
      ).not.toBe(null);
    });

    expect(
      document.querySelectorAll('[data-testid="brave-measure-text-error"] a'),
    ).toHaveLength(3);
  });

  it("drops the Brave notice's links but keeps the explanation", async () => {
    await render(<Excalidraw externalLinksEnabled={false} />);

    act(() => {
      h.setState({ errorMessage: <BraveMeasureTextError /> });
    });

    const notice = await waitFor(() => {
      const el = document.querySelector(
        '[data-testid="brave-measure-text-error"]',
      );
      expect(el).not.toBe(null);
      return el!;
    });

    expect(notice.querySelectorAll("a")).toHaveLength(0);
    // the two paragraphs that explain the problem stand on their own
    expect(notice.querySelectorAll("p")).toHaveLength(2);
  });

  it("gates the fallback main menu's Excalidraw links group", async () => {
    // rendered without a host <MainMenu>, which is how every library consumer
    // and every upstream unit test mounts the editor
    await render(<Excalidraw externalLinksEnabled={false} />);

    const trigger = await waitFor(() => {
      const el = document.querySelector<HTMLElement>(".dropdown-menu-button");
      expect(el).not.toBe(null);
      return el!;
    });

    act(() => {
      trigger.click();
    });

    const menu = await waitFor(() => {
      const el = document.querySelector(".dropdown-menu");
      expect(el).not.toBe(null);
      return el!;
    });

    expect(menu.querySelector('a[href*="discord.gg"]')).toBe(null);
    expect(menu.querySelector('a[href*="github.com"]')).toBe(null);
    expect(menu.querySelector('a[href*="x.com"]')).toBe(null);
    expect(menu.textContent).not.toContain("Excalidraw links");
  });

  it("keeps the fallback main menu's links by default", async () => {
    await render(<Excalidraw />);

    const trigger = await waitFor(() => {
      const el = document.querySelector<HTMLElement>(".dropdown-menu-button");
      expect(el).not.toBe(null);
      return el!;
    });

    act(() => {
      trigger.click();
    });

    const menu = await waitFor(() => {
      const el = document.querySelector(".dropdown-menu");
      expect(el).not.toBe(null);
      return el!;
    });

    expect(menu.querySelector('a[href*="discord.gg"]')).not.toBe(null);
  });
});
