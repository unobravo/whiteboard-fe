/**
 * DEMO(MIL-2679): what a scene broadcast actually weighs.
 *
 * The open questions on the inline-image approach are all sizing questions —
 * how big is a typical frame, how big is the worst one, how large does a room's
 * snapshot get over a session — and nobody has numbers. This records every
 * broadcast the client sends so the answer is measured rather than argued.
 *
 * Dev only, and deliberately dumb: an array, a counter and a printer. It reads
 * the payload the app is already building and adds no work of its own beyond a
 * `JSON.stringify` length the caller has computed anyway.
 *
 * In the browser console:
 *
 *   __wireStats()        // the summary table
 *   __wireStats.rows     // every broadcast, in order
 *   __wireStats.reset()
 */

export type WireSample = {
  at: number;
  /** `SCENE_INIT`, `SCENE_UPDATE`, `MOUSE_LOCATION`, … */
  type: string;
  /** reliable broadcasts are stored by the relay; volatile ones are not */
  volatile: boolean;
  bytes: number;
  elements: number;
  files: number;
  /** bytes of the `files` map alone, i.e. what the images cost */
  fileBytes: number;
};

const rows: WireSample[] = [];

const percentile = (sorted: number[], p: number) => {
  if (!sorted.length) {
    return 0;
  }
  const index = Math.min(
    sorted.length - 1,
    Math.floor((p / 100) * sorted.length),
  );
  return sorted[index];
};

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

const summary = () => {
  const reliable = rows.filter((row) => !row.volatile);
  const withFiles = reliable.filter((row) => row.files > 0);
  const sizes = reliable.map((row) => row.bytes).sort((a, b) => a - b);
  const SOCKET_IO_DEFAULT_MAX = 1024 * 1024;

  return {
    broadcasts: rows.length,
    reliable: reliable.length,
    volatile: rows.length - reliable.length,
    carryingFiles: withFiles.length,
    largest: kb(sizes.at(-1) ?? 0),
    p95: kb(percentile(sizes, 95)),
    median: kb(percentile(sizes, 50)),
    /** the snapshot the relay would hold: the last reliable broadcast */
    lastReliable: kb(reliable.at(-1)?.bytes ?? 0),
    /** what the durable copy needs to be: the largest full scene seen */
    largestFullScene: kb(
      Math.max(
        0,
        ...reliable
          .filter((row) => row.type === "SCENE_INIT" || row.files > 0)
          .map((row) => row.bytes),
      ),
    ),
    overSocketIoDefault: reliable.filter(
      (row) => row.bytes > SOCKET_IO_DEFAULT_MAX,
    ).length,
    totalSent: kb(rows.reduce((total, row) => total + row.bytes, 0)),
    imageShare: `${Math.round(
      (100 * rows.reduce((total, row) => total + row.fileBytes, 0)) /
        Math.max(
          1,
          rows.reduce((total, row) => total + row.bytes, 0),
        ),
    )}%`,
  };
};

export const recordWireSample = (sample: {
  data: { type: string; payload?: unknown };
  bytes: number;
  volatile: boolean;
}) => {
  installWireStats();

  const payload = (sample.data.payload ?? {}) as Record<string, unknown>;
  const files = (payload.files ?? {}) as Record<string, unknown>;
  const fileCount = Object.keys(files).length;

  rows.push({
    at: Date.now(),
    type: sample.data.type,
    volatile: sample.volatile,
    bytes: sample.bytes,
    elements: Array.isArray(payload.elements) ? payload.elements.length : 0,
    files: fileCount,
    // only pay for this when there is something to measure
    fileBytes: fileCount ? JSON.stringify(files).length : 0,
  });
};

type WireStats = {
  (): ReturnType<typeof summary>;
  rows: WireSample[];
  reset: () => void;
};

let installed = false;

/** Idempotent: the first recorded sample installs the console handle. */
export const installWireStats = () => {
  if (installed || typeof window === "undefined") {
    return;
  }
  installed = true;

  const api = (() => {
    // eslint-disable-next-line no-console
    console.table(rows.slice(-20));
    return summary();
  }) as WireStats;

  api.rows = rows;
  api.reset = () => {
    rows.length = 0;
  };

  (window as any).__wireStats = api;
};
