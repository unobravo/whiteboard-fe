/**
 * DEMO(MIL-2679): the image budget, and the instrumentation that measures it.
 *
 * With image bytes inside the scene broadcast, `UNOBRAVO_IMAGE_OPTIONS` is the
 * only thing standing between a pasted photo and a socket frame the relay
 * drops on the floor. These assertions pin the arithmetic, so raising the
 * ceiling has to be a deliberate edit with the relay's buffer in hand rather
 * than a one-character change nobody reviews.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UNOBRAVO_IMAGE_OPTIONS } from "../config/imageOptions";
import { installWireStats, recordWireSample } from "../dev/wireStats";

/** socket.io's default `maxHttpBufferSize`, which the relay does not raise. */
const SOCKET_IO_DEFAULT_MAX = 1024 * 1024;
/** base64 is 4 bytes of text per 3 bytes of input. */
const BASE64_INFLATION = 4 / 3;

describe("DEMO(MIL-2679): image budget", () => {
  it("re-encodes on insert, which is what actually bounds the bytes", () => {
    // without this, `maxFileSizeBytes` only rejects: a 1440px PNG screenshot
    // weighing 3 MB is refused rather than made to fit
    expect(UNOBRAVO_IMAGE_OPTIONS.outputType).toBe("image/jpeg");
  });

  it("keeps a worst-case image inside a 2 MB relay buffer", () => {
    const worstCaseFrame =
      UNOBRAVO_IMAGE_OPTIONS.maxFileSizeBytes! * BASE64_INFLATION;

    // the ask on the relay side: >= 2 MB. If this fails, either the ceiling
    // went up or the ask has to.
    expect(worstCaseFrame).toBeLessThan(2 * 1024 * 1024);
  });

  it("documents that the worst case still exceeds the socket.io default", () => {
    const worstCaseFrame =
      UNOBRAVO_IMAGE_OPTIONS.maxFileSizeBytes! * BASE64_INFLATION;

    // Deliberately asserted rather than left implicit: the *typical* insert
    // fits under 1 MB (see unobravo/dev/README.md), the ceiling does not. The
    // day the relay raises its buffer, this expectation is what should be
    // revisited — flip it to `toBeLessThan` and the budget is fully covered.
    expect(worstCaseFrame).toBeGreaterThan(SOCKET_IO_DEFAULT_MAX);
  });

  it("caps the long edge low enough that a document stays readable", () => {
    expect(UNOBRAVO_IMAGE_OPTIONS.maxWidthOrHeight).toBe(1600);
  });
});

describe("DEMO(MIL-2679): wire stats", () => {
  beforeEach(() => {
    installWireStats();
    (window as any).__wireStats.reset();
  });

  const sample = (
    overrides: Partial<{
      type: string;
      bytes: number;
      volatile: boolean;
      payload: Record<string, unknown>;
    }> = {},
  ) =>
    recordWireSample({
      data: {
        type: overrides.type ?? "SCENE_UPDATE",
        payload: overrides.payload ?? { elements: [{ id: "a" }] },
      },
      bytes: overrides.bytes ?? 1024,
      volatile: overrides.volatile ?? false,
    });

  it("separates reliable broadcasts from volatile ones", () => {
    // the distinction that matters: the relay stores reliable payloads as the
    // room snapshot and drops volatile ones
    sample();
    sample({ type: "MOUSE_LOCATION", volatile: true, payload: {} });

    const stats = (window as any).__wireStats();
    expect(stats.broadcasts).toBe(2);
    expect(stats.reliable).toBe(1);
    expect(stats.volatile).toBe(1);
  });

  it("counts the frames that would be dropped by an unraised buffer", () => {
    sample({ bytes: 512 * 1024 });
    sample({ bytes: 2 * 1024 * 1024 });

    expect((window as any).__wireStats().overSocketIoDefault).toBe(1);
  });

  it("attributes the payload to the images", () => {
    const dataURL = `data:image/jpeg;base64,${"A".repeat(4000)}`;
    sample({
      payload: {
        elements: [{ id: "img" }],
        files: { f1: { id: "f1", dataURL } },
      },
      bytes: 5000,
    });

    const stats = (window as any).__wireStats();
    expect(stats.carryingFiles).toBe(1);
    // the images are the payload, which is the whole point of the measurement
    expect(parseInt(stats.imageShare, 10)).toBeGreaterThan(70);
  });

  it("reports the last reliable broadcast, which is what the relay stores", () => {
    sample({ bytes: 4096, payload: { elements: [{ id: "a" }, { id: "b" }] } });
    sample({ bytes: 256, payload: { elements: [{ id: "b" }] } });
    sample({ type: "MOUSE_LOCATION", volatile: true, bytes: 64, payload: {} });

    // a 256-byte delta is the durable copy: finding #1 in the ticket, in one
    // assertion. Asserted on the raw row rather than the formatted summary, so
    // it survives a change of units.
    const reliable = (window as any).__wireStats.rows.filter(
      (row: { volatile: boolean }) => !row.volatile,
    );
    expect(reliable.at(-1).bytes).toBe(256);
    expect(reliable.at(-1).elements).toBe(1);
  });

  it("prints the recent rows when called", () => {
    const table = vi.spyOn(console, "table").mockImplementation(() => {});
    sample();
    (window as any).__wireStats();
    expect(table).toHaveBeenCalled();
    table.mockRestore();
  });
});
