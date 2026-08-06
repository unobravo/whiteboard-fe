import { readFileSync } from "fs";

/**
 * `unobravo/theme/accent-orange.scss` repaints the editor's accent by
 * redeclaring custom properties that upstream sets in
 * `packages/excalidraw/css/theme.scss`. Nothing else enforces that
 * dependency: `fork:check` cannot see it, because `theme.scss` is not a file
 * we modify, and no snapshot contains a colour. So an upstream rename merges
 * cleanly, passes every gate, and deploys a partly violet accent.
 *
 * Same failure shape `excalidraw-app/components/unobravo/relayHandshake.test.tsx`
 * guards against — the import survives, the property does not — so it gets the
 * same treatment.
 *
 * These assertions are deliberately textual. jsdom does not apply
 * stylesheets, so a `getComputedStyle` test would pass no matter what the CSS
 * said, which is the wrong shape for a guard.
 */

const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

/**
 * `declares` anchors at line start, which `//` comments already defeat, but
 * a declaration alone on a line inside `/* … *\/` would slip through.
 */
const withoutBlockComments = (css: string) =>
  css.replace(/\/\*[\s\S]*?\*\//g, "");

const THEME = withoutBlockComments(
  read("../../packages/excalidraw/css/theme.scss"),
);
const STYLES = withoutBlockComments(
  read("../../packages/excalidraw/css/styles.scss"),
);
const APP_STYLESHEET = read("../../excalidraw-app/index.scss");

// The override's own header documents selectors and hex values, so assertions
// about the code have to ignore it.
const OVERRIDE = read("../theme/accent-orange.scss").replace(
  /^[ \t]*\/\/.*$/gm,
  "",
);

/** Matches a declaration, so `--color-primary` never matches `-darker`. */
const declares = (css: string, property: string) =>
  new RegExp(`^\\s*${property}:`, "m").test(css);

/** The rule starting at the `{` under `index`, braces balanced. */
const blockAt = (css: string, index: number) => {
  let depth = 0;
  for (let i = index; i < css.length; i++) {
    if (css[i] === "{") {
      depth += 1;
    } else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        return css.slice(index, i + 1);
      }
    }
  }
  throw new Error(`unbalanced braces from offset ${index}`);
};

const ruleFor = (css: string, selector: RegExp) => {
  const match = css.match(selector);
  if (match?.index === undefined) {
    throw new Error(`no rule matching ${selector}`);
  }
  return blockAt(css, css.indexOf("{", match.index));
};

const rulesFor = (css: string, selector: RegExp) =>
  [...css.matchAll(selector)].map((match) =>
    blockAt(css, css.indexOf("{", match.index)),
  );

// Upstream nests its dark values in `&.theme--dark` inside the same
// `.excalidraw` rule. There is more than one such block — one of them only
// wraps `theme--dark-background-none` — so pick the one by what it declares
// rather than by position, and take light as the root minus all of them.
const upstreamRoot = ruleFor(THEME, /^\.excalidraw\s*\{/m);
const upstreamDarkBlocks = rulesFor(
  upstreamRoot,
  /^[ \t]*&\.theme--dark\s*\{/gm,
);
const upstreamDark = upstreamDarkBlocks.find((block) =>
  declares(block, "--theme-filter"),
)!;
const upstreamLight = upstreamDarkBlocks.reduce(
  (rest, block) => rest.replace(block, ""),
  upstreamRoot,
);

const overrideLight = ruleFor(
  OVERRIDE,
  /^\.excalidraw\.excalidraw:not\(\.theme--dark\)\s*\{/m,
);
const overrideDark = ruleFor(
  OVERRIDE,
  /^\.excalidraw\.excalidraw\.theme--dark\s*\{/m,
);

/**
 * Derived, not hardcoded. Upstream has grown this family before —
 * `--color-brand-*` and the `*-primary-container` pair arrived after the
 * original `--color-primary*` set — and each addition would have shipped
 * violet against a fixed list.
 */
const ACCENT_PROPERTY =
  /(--color-(?:primary|brand|selection|slider-track|surface-primary-container|on-primary-container)[\w-]*)\s*:/g;

const accentProperties = [
  ...new Set(
    [...upstreamLight.matchAll(ACCENT_PROPERTY)].map((match) => match[1]),
  ),
].sort();

describe("orange accent override", () => {
  it("finds the accent family upstream", () => {
    // Guards the regex above: an empty or truncated set would make every
    // it.each below vacuous.
    expect(accentProperties.length).toBe(12);
  });

  it.each(accentProperties)(
    "upstream still declares %s in both themes",
    (property) => {
      expect(declares(upstreamLight, property)).toBe(true);
      expect(declares(upstreamDark, property)).toBe(true);
    },
  );

  it.each(accentProperties)(
    "the override sets %s in both themes",
    (property) => {
      expect(declares(overrideLight, property)).toBe(true);
      expect(declares(overrideDark, property)).toBe(true);
    },
  );

  it("overrides nothing upstream has stopped declaring", () => {
    const overridden = [
      ...new Set(
        [...overrideLight.matchAll(ACCENT_PROPERTY)].map((match) => match[1]),
      ),
    ].sort();
    expect(overridden).toEqual(accentProperties);
  });

  // Specificity is the entire defence: 0-3-0 for both override blocks against
  // upstream's 0-1-0 and 0-2-0. `!important` would beat it outright.
  it("upstream marks no accent declaration !important", () => {
    for (const property of accentProperties) {
      expect(THEME).not.toMatch(new RegExp(`${property}:[^;]*!important`));
    }
  });

  // Without the `:not()` the light block sits at 0-2-0 and ties with
  // upstream's `.excalidraw.theme--dark`, leaving the winner to the bundler's
  // chunk order — which can differ between `dev` and `build`.
  it("scopes the light block away from the dark theme", () => {
    expect(OVERRIDE).toMatch(
      /^\.excalidraw\.excalidraw:not\(\.theme--dark\) \{/m,
    );
  });

  // The one wire. Lose it and the whole palette reverts with every other
  // assertion here still green.
  it("is imported by the app stylesheet", () => {
    expect(APP_STYLESHEET).toContain(
      '@import "../unobravo/theme/accent-orange.scss"',
    );
  });

  it("keeps no violet of its own", () => {
    expect(OVERRIDE).not.toMatch(
      /#(?:6965db|5b57d1|4a47b1|5753d0|4440bf|e3e2fe|d7d5ff|a8a5ff|b2aeff|beb9ff|bbb8ff|d0ccff|e0dfff|3530c4)/i,
    );
  });

  // The dark `--color-selection` is a pre-image computed for this exact
  // filter, so its value matters, not just its presence: drop the hue
  // rotation and the declared #ff5800 renders azure instead of orange.
  it("still filters the interactive canvas with the expected filter", () => {
    const canvas = ruleFor(STYLES, /^[ \t]*canvas\s*\{/m);
    const interactive = ruleFor(canvas, /^[ \t]*&\.interactive\s*\{/m);
    expect(interactive).toMatch(/filter:\s*var\(--theme-filter\)/);
    expect(upstreamDark).toMatch(
      /--theme-filter:\s*invert\(93%\)\s+hue-rotate\(180deg\)/,
    );
  });
});
