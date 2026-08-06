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
const VARIABLES = withoutComments(
  read("../../packages/excalidraw/css/variables.module.scss"),
);
const OVERRIDE = withoutComments(read("../theme/accent-orange.scss"));
const APP_STYLESHEET = withoutComments(read("../../excalidraw-app/index.scss"));
const APP_ENTRY = withoutComments(read("../../excalidraw-app/App.tsx"));

/** Matches a declaration, so `--color-primary` never matches `-darker`. */
const declares = (css: string, property: string) =>
  new RegExp(`^\\s*${property}:`, "m").test(css);

/**
 * A lookbehind rather than a line anchor, so two declarations sharing a line
 * are both seen — consuming the separator would put `lastIndex` past the `;`
 * the next match needs. Prettier splits them today; a merge need not.
 */
const declarations = (css: string) =>
  [...css.matchAll(/(?<=^|[;{])[ \t]*(--[\w-]+)[ \t]*:[ \t]*([^;]+);/gm)].map(
    (match) => [match[1], match[2].trim()] as const,
  );

/** `#{$color-red-1}` → `#ffe3e3`, so interpolated values stay classifiable. */
const SCSS_VARIABLES = Object.fromEntries(
  [...VARIABLES.matchAll(/^\$([\w-]+):\s*([^;]+);/gm)].map((match) => [
    match[1],
    match[2].trim(),
  ]),
);

const resolved = (value: string) =>
  value.replace(
    /#\{\$([\w-]+)\}/g,
    (whole, name) => SCSS_VARIABLES[name] ?? whole,
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

/**
 * Hue in degrees and saturation, or null when the value is not a colour this
 * can read. Every spelling upstream uses must be covered, because a value that
 * cannot be read is a value whose violet goes unnoticed — see the
 * `unclassified` assertion below, which is what keeps this honest.
 */
const hueOf = (value: string): { hue: number; saturation: number } | null => {
  const input = resolved(value).trim();

  if (/^(black|white|transparent)$/i.test(input)) {
    return { hue: 0, saturation: 0 };
  }

  const functional = input.match(/^(rgba?|hsla?)\(([^)]*)\)$/i);
  if (functional) {
    const parts = functional[2]
      .split(/[,/\s]+/)
      .filter(Boolean)
      .map((part) => Number.parseFloat(part));
    if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) {
      return null;
    }
    if (functional[1].toLowerCase().startsWith("hsl")) {
      // `deg` is the only unit upstream could plausibly use; turn/rad would
      // parse to a wrong number, so reject them rather than guess.
      if (/\d(rad|turn|grad)/i.test(functional[2])) {
        return null;
      }
      return { hue: parts[0], saturation: parts[1] / 100 };
    }
    return channelsToHue(parts[0] / 255, parts[1] / 255, parts[2] / 255);
  }

  const hex = input.match(/^#([0-9a-f]{3,8})$/i);
  if (!hex || ![3, 4, 6, 8].includes(hex[1].length)) {
    return null;
  }
  const digits =
    hex[1].length <= 4
      ? [...hex[1]].map((digit) => digit + digit).join("")
      : hex[1];
  const packed = parseInt(digits.slice(0, 6), 16);
  return channelsToHue(
    ((packed >> 16) & 255) / 255,
    ((packed >> 8) & 255) / 255,
    (packed & 255) / 255,
  );
};

function channelsToHue(r: number, g: number, b: number) {
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
}

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
 * Violets upstream declares that we leave alone. Deriving by hue rather than by
 * name means a *new* upstream accent token fails this suite until someone
 * decides whether to repaint it — a name list would have missed, say, a
 * Material 3 `--color-primary-container`. These are the exclusions
 * `unobravo/FORK.md` explains, and a stale one fails too.
 */
const DELIBERATELY_VIOLET = [
  "--color-logo-text",
  "--color-primary-contrast-offset",
];

/**
 * Values that are certainly not a colour, so being unreadable is expected.
 * Every alternative must stay inside the anchored group: an unanchored one
 * matching a substring — `\d+%`, say — would excuse `oklch(55% 0.2 285)` and
 * every other modern colour syntax, which is how this check last failed open.
 */
const NOT_A_COLOUR =
  /^(none|inherit|unset|initial|currentColor|var\(|url\(|invert\(|calc\(|linear-gradient\(|-?\.?\d)/i;

/**
 * The honesty check on `hueOf`. A value it cannot read counts as not-violet,
 * so an unreadable accent token would drop out of the family silently. These
 * three are upstream's only unreadable values that might be colours — all
 * achromatic — and a fourth spelling appearing fails this assertion rather
 * than quietly widening the blind spot.
 */
const UNREADABLE_UPSTREAM_VALUES = [
  "#{color.adjust($color-gray-8, $alpha: -0.88)}",
  "#{color.adjust(#fff, $alpha: -0.12)}",
];

const upstreamDeclarations = [
  ...declarations(upstreamLight),
  ...declarations(upstreamDark),
  ...declarations(APP_STYLESHEET),
];

const upstreamViolets = [
  ...new Set(
    upstreamDeclarations
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

  // Without this, the hue derivation fails open: a token whose value `hueOf`
  // cannot read is treated as not-violet and vanishes from the family.
  it("can read every upstream value that might be a colour", () => {
    const unreadable = upstreamDeclarations
      .filter(([, value]) => hueOf(value) === null && !NOT_A_COLOUR.test(value))
      .map(([, value]) => value);
    expect([...new Set(unreadable)].sort()).toEqual(
      [...UNREADABLE_UPSTREAM_VALUES].sort(),
    );
  });

  // The header's specificity table assumes upstream declares the accent on
  // exactly `.excalidraw` and `.excalidraw.theme--dark`. A third, longer
  // selector — `&.theme--dark.theme--high-contrast`, say — would reach 0-3-0
  // and tie or win, and every other assertion here would still pass.
  it("keeps upstream's accent declarations on the two known selectors", () => {
    const stray = [...THEME.matchAll(/^[ \t]*([.&][^{\n]*?)\s*\{/gm)]
      .filter((match) => (match[1].match(/\./g)?.length ?? 0) > 1)
      .filter((match) => {
        const block = blockAt(THEME, match.index! + match[0].lastIndexOf("{"));
        return accentProperties.some((property) => declares(block, property));
      })
      .map((match) => match[1]);
    expect(stray).toEqual([]);
  });

  // The trailing rule overrides a literal `white` upstream hardcodes on
  // `--color-primary`. If upstream ever fixes that properly the override stops
  // being needed, and `--color-icon-white` is what makes one rule serve both
  // themes — so both facts are worth failing on rather than discovering later.
  it("keeps the exit-view-mode fix's two dependencies", () => {
    const layerUI = withoutComments(
      read("../../packages/excalidraw/components/LayerUI.scss"),
    );
    const button = ruleFor(layerUI, /^[ \t]*\.disable-view-mode\s*\{/m);
    expect(button).toMatch(/&:hover\s*\{[^}]*color:\s*white/);
    expect(declares(upstreamLight, "--color-icon-white")).toBe(true);
    expect(declares(upstreamDark, "--color-icon-white")).toBe(true);
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
    for (const block of [overrideLight, overrideDark]) {
      const overridden = declarations(block)
        .map(([property]) => property)
        .sort();
      expect(overridden).toEqual([...accentProperties].sort());
    }
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
