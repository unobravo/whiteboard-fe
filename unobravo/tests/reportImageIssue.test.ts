/**
 * How a compression issue reaches Sentry (`unobravo/images.md`, "Sentry").
 * The tags are what makes the events filterable, so they are asserted exactly.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { reportImageIssue } from "../images/reportImageIssue";

const sentry = vi.hoisted(() => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));
vi.mock("@sentry/browser", () => sentry);

const CONTEXT = {
  inputType: "image/png",
  inputBytes: 3000,
  attempts: 2,
  stage: "encode" as const,
};

beforeEach(() => {
  sentry.captureException.mockReset();
  sentry.captureMessage.mockReset();
});

describe("reportImageIssue", () => {
  it("sends what threw as an exception, tagged with the issue and the stage", () => {
    const error = new Error("canvas.toBlob failed");

    reportImageIssue("compression-failed", CONTEXT, error);

    expect(sentry.captureException).toHaveBeenCalledWith(error, {
      level: "error",
      tags: { imageIssue: "compression-failed", imageStage: "encode" },
      extra: CONTEXT,
    });
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });

  it("sends what merely looks wrong as a warning message", () => {
    reportImageIssue("over-hard-stop", CONTEXT);

    expect(sentry.captureMessage).toHaveBeenCalledWith(
      "image: over-hard-stop",
      {
        level: "warning",
        tags: { imageIssue: "over-hard-stop" },
        extra: CONTEXT,
      },
    );
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it("treats a thrown non-Error as an exception too", () => {
    reportImageIssue("fallback-failed", CONTEXT, "a string was thrown");

    expect(sentry.captureException).toHaveBeenCalledWith(
      "a string was thrown",
      expect.objectContaining({ level: "error" }),
    );
  });

  it("never lets a failing Sentry break the insert, nor log through console.error", () => {
    const consoleError = vi.spyOn(console, "error");
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    sentry.captureException.mockImplementation(() => {
      throw new Error("sentry down");
    });
    sentry.captureMessage.mockImplementation(() => {
      throw new Error("sentry down");
    });

    expect(() =>
      reportImageIssue("compression-failed", CONTEXT, new Error("x")),
    ).not.toThrow();
    expect(() => reportImageIssue("slow-compression", CONTEXT)).not.toThrow();

    // captureConsoleIntegration would turn console.error into another event
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).toHaveBeenCalledTimes(2);
  });
});
