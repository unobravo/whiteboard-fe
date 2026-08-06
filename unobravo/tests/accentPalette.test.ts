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
 * Comments are stripped from every source, both syntaxes. `//` matters for the
 * override, whose header quotes selectors and violet hexes that assertions
 * below would otherwise match; `/* … *\/` matters for upstream, where a
 * declaration alone on a line inside one would count as live.
 */
const withoutComments = (css: string) =>
  css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const THEME = withoutComments(read("../../packages/excalidraw/css/theme.scss"));
const STYLES = withoutComments(
  read("../../packages/excalidraw/css/styles.scss"),
);
const OVERRIDE = withoutComments(read("../theme/accent-orange.scss"));
const APP_STYLESHEET = withoutComments(read("../../excalidraw-app/index.scss"));
const APP_ENTRY = withoutComments(read("../../excalidraw-app/App.tsx"));

/** Matches a declaration, so `--color-primary` never matches `-darker`. */
const declares = (css: string, property: string) =>
  new RegExp(`^\\s*${property}:`, "m").test(css);

const declarations = (css: string) =>
  [...css.matchAll(/^[ \t]*(--[\w-]+):[ \t]*([^;]+);/gm)].map(
    (match) => [match[1], match[2].trim()] as const,
  );

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

/** Hue in degrees and saturation, from `#rrggbb` or `hsl()`. */
const hueOf = (value: string) => {
  const hsl = value.match(
    /^hsl\(\s*([\d.]+)[,\s]+([\d.]+)%[,\s]+([\d.]+)%\s*\)$/,
  );
  if (hsl) {
    return { hue: Number(hsl[1]), saturation: Number(hsl[2]) / 100 };
  }
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (!hex) {
    return null;
  }
  const packed = parseInt(hex[1], 16);
  const [r, g, b] = [
    (packed >> 16) & 255,
    (packed >> 8) & 255,
    packed & 255,
  ].map((channel) => channel / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  const lightness = (max + min) / 2;
  if (chroma === 0) {
    return { hue: 0, saturation: 0 };
  }
  const hue =
    max === r
      ? 60 * (((g - b) / chroma) % 6)
      : max === g
      ? 60 * ((b - r) / chroma + 2)
      : 60 * ((r - g) / chroma + 4);
  return {
    hue: hue < 0 ? hue + 360 : hue,
    saturation: chroma / (1 - Math.abs(2 * lightness - 1)),
  };
};

const isViolet = (value: string) => {
  const colour = hueOf(value);
  return (
    colour !== null &&
    colour.hue >= 225 &&
    colour.hue <= 290 &&
    colour.saturation > 0.15
  );
};

// Upstream nests its dark values in `&.theme--dark` inside the same
// `.excalidraw` rule. There is more than one such block — one of them only
// wraps `theme--dark-background-none` — so pick the one by what it declares
// rather than by position, and take light as the root minus all of them.
// Every top-level `.excalidraw` rule counts, not just the first: a second one
// added later in the file would otherwise be invisible to all of this.
const upstreamRoots = rulesFor(THEME, /^\.excalidraw\s*\{/gm);
const upstreamDarkBlocks = upstreamRoots.flatMap((root) =>
  rulesFor(root, /^[ \t]*&\.theme--dark\s*\{/gm),
);
const upstreamDark = upstreamDarkBlocks
  .filter((block) => declares(block, "--theme-filter"))
  .join("\n");
const upstreamLight = upstreamDarkBlocks
  .reduce((rest, block) => rest.replace(block, ""), upstreamRoots.join("\n"))
  .trim();

// Deliberately permissive, so that losing the `:not()` fails the assertion
// that names it rather than throwing here before any test runs.
const overrideLight = ruleFor(
  OVERRIDE,
  /^\.excalidraw\.excalidraw(?::not\(\.theme--dark\))?\s*\{/m,
);
const overrideDark = ruleFor(
  OVERRIDE,
  /^\.excalidraw\.excalidraw\.theme--dark\s*\{/m,
);

/**
 * Violets upstream declares that we leave alone. Derived-by-hue means a *new*
 * upstream accent token fails this suite until someone decides whether to
 * repaint it, rather than shipping violet against a hardcoded name list —
 * which is what would happen to, say, a Material 3 `--color-on-primary`.
 * These four are the exclusions `unobravo/FORK.md` explains.
 */
const DELIBERATELY_VIOLET = [
  "--color-logo-text",
  "--color-surface-high",
  "--color-surface-low",
  "--color-surface-mid",
];

const upstreamViolets = [
  ...new Set(
    [...declarations(upstreamLight), ...declarations(upstreamDark)]
      .filter(([, value]) => isViolet(value))
      .map(([property]) => property),
  ),
].sort();

const accentProperties = upstreamViolets.filter(
  (property) => !DELIBERATELY_VIOLET.includes(property),
);

describe("orange accent override", () => {
  it("finds the accent family upstream", () => {
    // Non-vacuity: an empty or truncated set would make every it.each below
    // pass without asserting anything.
    expect(accentProperties.length).toBeGreaterThanOrEqual(12);
  });

  it("leaves violet only where the register says so", () => {
    // A stale exclusion is as bad as a missing override: it would hide a token
    // upstream has renamed or dropped.
    expect(upstreamViolets).toEqual(
      [...accentProperties, ...DELIBERATELY_VIOLET].sort(),
    );
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
    const overridden = declarations(overrideLight)
      .map(([property]) => property)
      .sort();
    expect(overridden).toEqual([...accentProperties].sort());
  });

  // A declaration existing is not the same as it being orange. An unparseable
  // value — one stray character — still substitutes, turning every consuming
  // property invalid at computed-value time.
  it("keeps every override value a parseable orange", () => {
    const offenders = [overrideLight, overrideDark].flatMap((block) =>
      declarations(block).filter(([, value]) => {
        const colour = hueOf(value);
        return colour === null || colour.hue <= 14 || colour.hue >= 45;
      }),
    );
    expect(offenders).toEqual([]);
  });

  // Catches the two blocks' bodies being swapped, which every assertion above
  // would otherwise accept: a light theme wants a dark accent and vice versa.
  it("keeps the light accent darker than the dark one", () => {
    const primary = (block: string) =>
      declarations(block).find(
        ([property]) => property === "--color-primary",
      )![1];
    const luminance = (hex: string) =>
      [1, 3, 5].reduce(
        (sum, at) => sum + parseInt(hex.slice(at, at + 2), 16),
        0,
      );
    expect(luminance(primary(overrideLight))).toBeLessThan(
      luminance(primary(overrideDark)),
    );
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
      /^\.excalidraw\.excalidraw:not\(\.theme--dark\)\s*\{/m,
    );
  });

  // The chain. Break either link and the whole palette reverts with every
  // other assertion here still green — so both are asserted at line start,
  // after comment stripping, because a commented-out import satisfies neither.
  it("is imported all the way to the app entrypoint", () => {
    expect(APP_STYLESHEET).toMatch(
      /^@import "\.\.\/unobravo\/theme\/accent-orange\.scss"/m,
    );
    expect(APP_ENTRY).toMatch(/^import "\.\/index\.scss"/m);
  });

  it("keeps no violet of its own", () => {
    const violets = [overrideLight, overrideDark].flatMap((block) =>
      declarations(block).filter(([, value]) => isViolet(value)),
    );
    expect(violets).toEqual([]);
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
