import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

import { t } from "@excalidraw/excalidraw/i18n";

import type { TranslationKeys } from "@excalidraw/excalidraw/i18n";

import { TopErrorBoundary } from "../../excalidraw-app/components/TopErrorBoundary";

import type { ReactNode } from "react";

/**
 * The real `Trans` needs a Jotai provider (`useI18n` reads `editorLangCodeAtom`
 * through `jotai-scope`) that only exists inside a mounted `<Excalidraw>` tree.
 * `TopErrorBoundary` renders outside of one, so this stands in with the same
 * single-`<button>`-tag substitution, driven by the same translation strings.
 */
vi.mock("@excalidraw/excalidraw/components/Trans", () => ({
  default: ({
    i18nKey,
    button,
    ...values
  }: {
    i18nKey: TranslationKeys;
    button?: (el: ReactNode) => ReactNode;
    [key: string]: unknown;
  }) => {
    const interpolationValues = values as { [key: string]: string | number };
    const raw = t(i18nKey, interpolationValues);
    const match = raw.match(/^([\s\S]*)<button>([\s\S]*)<\/button>([\s\S]*)$/);

    if (!match || !button) {
      return raw;
    }

    const [, before, inner, after] = match;
    return (
      <>
        {before}
        {button(inner)}
        {after}
      </>
    );
  },
}));

/**
 * The ErrorSplash (`TopErrorBoundary`) is the crash screen: `sentryInit.test.ts`
 * covers what `beforeSend` does to any event, this covers what the boundary
 * itself sends — a "view" log when the screen appears and a "click" log
 * (flushed before `window.location.reload()`) when the user tries to recover.
 */
const sentry = vi.hoisted(() => ({
  captureException: vi.fn(() => "original-event-id"),
  captureMessage: vi.fn(),
  withScope: vi.fn((callback: (scope: { setExtras: () => void }) => void) =>
    callback({ setExtras: vi.fn() }),
  ),
  flush: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("@sentry/browser", () => sentry);

// avoids the real module's Sentry.init side effect, which this file's
// minimal @sentry/browser mock does not implement — sentryInit.test.ts
// covers that module on its own
vi.mock("../../excalidraw-app/sentry", () => ({
  isErrorReportingEnabled: false,
}));

const ThrowingChild = () => {
  throw new Error("boom");
};

// suppresses React's own console.error logging of the caught error, which
// would otherwise be misread as a real test failure in the output
const originalConsoleError = console.error;
const originalLocation = window.location;

describe("TopErrorBoundary Sentry logging", () => {
  beforeEach(() => {
    console.error = vi.fn();
  });

  afterEach(() => {
    console.error = originalConsoleError;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
    cleanup();
    vi.clearAllMocks();
  });

  it("logs a view event with crash context when the ErrorSplash is displayed", () => {
    render(
      <TopErrorBoundary>
        <ThrowingChild />
      </TopErrorBoundary>,
    );

    expect(sentry.captureMessage).toHaveBeenCalledWith(
      "ErrorSplash displayed",
      expect.objectContaining({
        level: "info",
        tags: { errorSplashEvent: "view" },
        extra: expect.objectContaining({
          originalEventId: "original-event-id",
          errorMessage: "boom",
          errorName: "Error",
          url: expect.any(String),
          timestamp: expect.any(String),
          userAgent: expect.any(String),
          viewport: expect.stringMatching(/^\d+x\d+$/),
        }),
      }),
    );
  });

  it("logs a click event and waits for it to flush before reloading", async () => {
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload },
    });

    // "Once" so the mock implementation doesn't leak into later tests —
    // vi.clearAllMocks() in afterEach clears calls but not implementations
    let resolveFlush: (value: boolean) => void = () => {};
    sentry.flush.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveFlush = resolve;
        }),
    );

    render(
      <TopErrorBoundary>
        <ThrowingChild />
      </TopErrorBoundary>,
    );
    sentry.captureMessage.mockClear();

    fireEvent.click(screen.getByText(/reloading the page/i));

    expect(sentry.captureMessage).toHaveBeenCalledWith(
      "ErrorSplash refresh clicked",
      expect.objectContaining({
        level: "info",
        tags: { errorSplashEvent: "click" },
        extra: expect.objectContaining({
          originalEventId: "original-event-id",
          errorMessage: "boom",
          errorName: "Error",
        }),
      }),
    );
    expect(sentry.flush).toHaveBeenCalledWith(1000);
    // reload must wait for the flush to settle, or the click log can be
    // dropped by the page unload
    expect(reload).not.toHaveBeenCalled();

    await act(async () => {
      resolveFlush(true);
      await Promise.resolve();
    });

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("logs the click only once when the reload button is double-clicked", async () => {
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload },
    });

    render(
      <TopErrorBoundary>
        <ThrowingChild />
      </TopErrorBoundary>,
    );
    sentry.captureMessage.mockClear();

    const reloadButton = screen.getByText(/reloading the page/i);
    fireEvent.click(reloadButton);
    fireEvent.click(reloadButton);

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      sentry.captureMessage.mock.calls.filter(
        ([message]) => message === "ErrorSplash refresh clicked",
      ),
    ).toHaveLength(1);
    expect(sentry.flush).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
