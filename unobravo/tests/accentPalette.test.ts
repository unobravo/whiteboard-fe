import { readFileSync } from "fs";

/**
 * `unobravo/theme/accent-orange.scss` repaints the editor's accent by
 * redeclaring custom properties that upstream sets in
 * `packages/excalidraw/css/theme.scss`. Nothing else enforces that dependency:
 * `fork:check` cannot see it, because `theme.scss` is not a file we modify, and
 * no snapshot contains a colour. So an upstream rename merges cleanly, passes
 * every gate, and deploys a partly violet accent.
 *
 * Same failure shape `excalidraw-app/components/unobravo/relayHandshake.test.tsx`
 * guards against — the import survives, the property does not.
 *
 * Scope is deliberate. Replaying earlier versions of this file against all 44
 * revisions of `theme.scss` in this repo's history showed the accent family
 * changing membership in 8 upstream commits, roughly one every seven months —
 * so the derivation below earns its place. It also showed that assertions
 * pinned to a *spelling* rather than a value were red on 40 of 44 revisions for
 * reasons no user could see: a Sass syntax refactor, a `#{$var}` becoming a
 * literal. Those are gone. A false negative here ships a cosmetic bug the first
 * person to open the app will notice; a false positive blocks an upstream merge
 * behind a bespoke parser. The asymmetry sets the budget.
 *
 * These assertions are textual on purpose. jsdom does not apply stylesheets, so
 * a `getComputedStyle` test would pass no matter what the CSS said.
 */

const read = (relativePath: string) => {
  try {
    return readFileSync(new URL(relativePath, import.meta.url), "utf8");
  } catch {
    throw new Error(`accent palette guard: cannot read ${relativePath}`);
  }
};

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

/** A lookbehind, so two declarations sharing a line are both seen. */
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
      return /\d(rad|turn|grad)/i.test(functional[2])
        ? null
        : { hue: parts[0], saturation: parts[1] / 100 };
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
// `.excalidraw` rule. There is more than one such block — one only wraps
// `theme--dark-background-none` — so pick the one by what it declares, and take
// light as the root minus all of them. Every top-level `.excalidraw` rule
// counts, not just the first.
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

// Permissive, so losing the `:not()` fails the assertion that names it rather
// than throwing here. Anchored on the `:not()` first so a file reorder cannot
// bind this to the trailing `.excalidraw.excalidraw` rule.
const overrideLight = ruleFor(
  OVERRIDE,
  /^\.excalidraw\.excalidraw:not\(\.theme--dark\)\s*\{|^\.excalidraw\.excalidraw\s*\{/m,
);
const overrideDark = ruleFor(
  OVERRIDE,
  /^\.excalidraw\.excalidraw\.theme--dark\s*\{/m,
);

/** Violets upstream declares that we leave alone, and `FORK.md` explains. */
const DELIBERATELY_VIOLET = [
  "--color-logo-text",
  "--color-primary-contrast-offset",
];

/**
 * Derived from upstream by hue, then pinned. The derivation is what makes this
 * list mean something — it is upstream's reality, not our wishlist — and the
 * pin is what makes a rename, an addition or a removal fail deterministically
 * instead of depending on a classifier.
 */
const ACCENT_PROPERTIES = [
  "--color-brand-active",
  "--color-brand-hover",
  "--color-on-primary-container",
  "--color-primary",
  "--color-primary-darker",
  "--color-primary-darkest",
  "--color-primary-hover",
  "--color-primary-light",
  "--color-primary-light-darker",
  "--color-selection",
  "--color-slider-track",
  "--color-surface-high",
  "--color-surface-low",
  "--color-surface-mid",
  "--color-surface-primary-container",
];

// `excalidraw-app/index.scss` counts too: it declares
// `--color-primary-contrast-offset`, which is violet by the test above and
// lives in the file the register row describes.
const upstreamViolets = [
  ...new Set(
    [
      ...declarations(upstreamLight),
      ...declarations(upstreamDark),
      ...declarations(APP_STYLESHEET),
    ]
      .filter(([, value]) => isViolet(value))
      .map(([property]) => property),
  ),
].sort();

describe("orange accent override", () => {
  // The load-bearing assertion. Upstream changed this family's membership in 8
  // of the last 44 commits to `theme.scss`, and every one of those would have
  // shipped a half-violet accent with every other gate green.
  it("matches the accent family upstream still declares", () => {
    expect(upstreamViolets).toEqual(
      [...ACCENT_PROPERTIES, ...DELIBERATELY_VIOLET].sort(),
    );
  });

  it("overrides exactly that family, in both themes", () => {
    for (const block of [overrideLight, overrideDark]) {
      expect(
        declarations(block)
          .map(([property]) => property)
          .sort(),
      ).toEqual([...ACCENT_PROPERTIES].sort());
    }
  });

  // A declaration existing is not the same as it being orange: one stray
  // character makes a value that still substitutes, turning every consuming
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

  // Catches the two blocks' bodies being swapped, which everything above would
  // accept: a light theme wants a dark accent and a dark theme a light one.
  it("keeps the light accent darker than the dark one", () => {
    const primary = (block: string) =>
      declarations(block).find(
        ([property]) => property === "--color-primary",
      )![1];
    const weight = (hex: string) =>
      [1, 3, 5].reduce(
        (sum, at) => sum + parseInt(hex.slice(at, at + 2), 16),
        0,
      );
    expect(weight(primary(overrideLight))).toBeLessThan(
      weight(primary(overrideDark)),
    );
  });

  // Without the `:not()` the light block sits at 0-2-0 and ties with upstream's
  // `.excalidraw.theme--dark`, leaving the winner to the bundler's chunk order
  // — which can differ between `dev` and `build`.
  it("scopes the light block away from the dark theme", () => {
    expect(OVERRIDE).toMatch(
      /^\.excalidraw\.excalidraw:not\(\.theme--dark\)\s*\{/m,
    );
  });

  // Break either link and the whole palette reverts with everything else green,
  // so both are matched at line start after comment stripping — a commented-out
  // import satisfies neither.
  it("is imported all the way to the app entrypoint", () => {
    expect(APP_STYLESHEET).toMatch(
      /^@import "\.\.\/unobravo\/theme\/accent-orange\.scss"/m,
    );
    expect(APP_ENTRY).toMatch(/^import "\.\/index\.scss"/m);
  });

  // The third rule in the override, and the only one that sets a property
  // rather than a token. It is outside both blocks above, so without this,
  // deleting it is a green build.
  it("keeps the exit-view-mode rule and what it rests on", () => {
    const fix = ruleFor(OVERRIDE, /^\.excalidraw\.excalidraw\s*\{/m);
    expect(fix).toMatch(/\.disable-view-mode:hover/);
    expect(fix).toMatch(/\.disable-view-mode:active/);
    expect(fix).toMatch(/color:\s*var\(--color-icon-white\)\s*!important/);

    // `--color-icon-white` is `var(--color-gray-90)` in dark, so the grey scale
    // is still the real dependency — one hop further out, not removed.
    expect(declares(upstreamLight, "--color-icon-white")).toBe(true);
    expect(declares(upstreamDark, "--color-icon-white")).toBe(true);
    expect(declares(upstreamLight, "--color-gray-90")).toBe(true);

    // Upstream's side: a literal `white` on an accent background. If upstream
    // fixes that, this override stops being needed; if upstream keeps the white
    // but changes the background off the accent, the override becomes harmful.
    const button = ruleFor(
      withoutComments(
        read("../../packages/excalidraw/components/LayerUI.scss"),
      ),
      /^[ \t]*\.disable-view-mode(?:[\s,][^{]*)?\{/m,
    );
    expect(button).toMatch(/&:hover\b[^{]*\{[\s\S]*?color:\s*white/i);
    expect(button).toMatch(
      /&:hover\b[^{]*\{[\s\S]*?background-color:\s*var\(--color-primary\)/i,
    );
  });

  // The dark `--color-selection` is a pre-image computed for the interactive
  // canvas's filter, so it is meaningless if the canvas stops carrying one. The
  // filter's *value* is not pinned: it has not changed since 2021, but its
  // spelling has, and pinning it was red on 37 of 44 historical revisions.
  it("still filters the interactive canvas", () => {
    const canvas = ruleFor(STYLES, /^[ \t]*canvas\s*\{/m);
    const interactive = ruleFor(canvas, /^[ \t]*&\.interactive\s*\{/m);
    expect(interactive).toMatch(/filter:\s*var\(--theme-filter\)/);
    expect(declares(upstreamDark, "--theme-filter")).toBe(true);
  });
});
