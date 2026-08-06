import { readFileSync } from "fs";

/**
 * `unobravo/theme/accent-orange.scss` repaints the editor's accent by
 * redeclaring custom properties that upstream sets in
 * `packages/excalidraw/css/theme.scss`. Nothing enforces that dependency:
 * `fork:check` cannot see it, because `theme.scss` is not a file we modify,
 * and no snapshot contains a colour. So an upstream rename merges cleanly,
 * passes every gate, and deploys a partly violet accent.
 *
 * This is the same failure shape `relayHandshake.test.tsx` guards against —
 * the import survives, the property does not — so it gets the same treatment.
 * These assertions are deliberately textual: jsdom does not apply stylesheets,
 * so a `getComputedStyle` test would pass no matter what the CSS said.
 */

const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

const THEME = read("../../packages/excalidraw/css/theme.scss");
const STYLES = read("../../packages/excalidraw/css/styles.scss");
const OVERRIDE = read("../theme/accent-orange.scss");

/** The properties the override depends on upstream still declaring. */
const OVERRIDDEN_PROPERTIES = [
  "--color-primary",
  "--color-primary-darker",
  "--color-primary-darkest",
  "--color-primary-light",
  "--color-primary-light-darker",
  "--color-primary-hover",
  "--color-selection",
  "--color-brand-hover",
  "--color-brand-active",
  "--color-surface-primary-container",
  "--color-on-primary-container",
  "--color-slider-track",
];

/** Matches a declaration, so `--color-primary` never matches `-darker`. */
const declares = (css: string, property: string) =>
  new RegExp(`^\\s*${property}:`, "m").test(css);

const splitAt = (css: string, marker: string) => {
  const index = css.indexOf(marker);
  if (index === -1) {
    throw new Error(`expected to find ${marker}`);
  }
  return [css.slice(0, index), css.slice(index)] as const;
};

// Upstream nests its dark values in `&.theme--dark` inside the same
// `.excalidraw` rule, so everything before the first one is the light theme.
const [upstreamLight, upstreamDark] = splitAt(THEME, "&.theme--dark");

const [overrideLight, overrideDark] = splitAt(
  OVERRIDE,
  ".excalidraw.excalidraw.theme--dark {",
);

describe("orange accent override", () => {
  it.each(OVERRIDDEN_PROPERTIES)(
    "upstream still declares %s in both themes",
    (property) => {
      expect(declares(upstreamLight, property)).toBe(true);
      expect(declares(upstreamDark, property)).toBe(true);
    },
  );

  it.each(OVERRIDDEN_PROPERTIES)(
    "the override sets %s in both themes",
    (property) => {
      expect(declares(overrideLight, property)).toBe(true);
      expect(declares(overrideDark, property)).toBe(true);
    },
  );

  // Without the `:not()` the light block sits at 0-2-0 and ties with
  // upstream's `.excalidraw.theme--dark`, leaving the winner up to the
  // bundler's chunk order — which can differ between `dev` and `build`.
  it("scopes the light block away from the dark theme", () => {
    expect(OVERRIDE).toContain(".excalidraw.excalidraw:not(.theme--dark) {");
  });

  // The dark `--color-selection` is a pre-image chosen for this filter. Drop
  // the filter and the declared #ff5800 reaches the screen unchanged, which
  // makes the arithmetic documented beside it wrong.
  it("still filters the interactive canvas in dark mode", () => {
    expect(STYLES).toMatch(
      /&\.interactive\s*\{[^}]*filter:\s*var\(--theme-filter\)/,
    );
    expect(declares(upstreamDark, "--theme-filter")).toBe(true);
  });
});
