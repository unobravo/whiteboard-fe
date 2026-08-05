// eslint-disable-next-line @typescript-eslint/no-var-requires
const forkCheck = require("../../scripts/fork-check.js");

const {
  assertRepoRelative,
  isIgnored,
  isOwned,
  isSeparatorRow,
  isTracked,
  section,
  splitRow,
  tableRows,
  unquote,
} = forkCheck as {
  assertRepoRelative: (candidate: unknown) => string;
  isIgnored: (relativePath: string) => boolean;
  isOwned: (file: string) => boolean;
  isSeparatorRow: (cells: string[]) => boolean;
  isTracked: (relativePath: string) => boolean;
  section: (markdown: string, name: string) => string;
  splitRow: (line: string) => string[];
  tableRows: (markdownSection: string) => string[][];
  unquote: (cell: string) => string;
};

/**
 * `fork-check` is the only thing standing between this fork and silent drift,
 * and it parses a markdown file and then touches the filesystem with what it
 * finds. Its helpers are worth the same scrutiny as the app code.
 */
describe("fork-check path handling", () => {
  it("accepts an ordinary repo-relative path", () => {
    expect(assertRepoRelative("packages/excalidraw/types.ts")).toBe(
      "packages/excalidraw/types.ts",
    );
  });

  it("asks git what is tracked, not the filesystem", () => {
    expect(isTracked("packages/excalidraw/types.ts")).toBe(true);
    expect(isTracked("packages/excalidraw/does-not-exist.ts")).toBe(false);
    // the distinction that matters: `.gitignore` carries a bare `build`
    // pattern, so a file under any `build/` directory exists locally and in no
    // clone. `fs.existsSync` would have called this fine.
    expect(isTracked("excalidraw-app/build/index.html")).toBe(false);
  });

  it("refuses to ask git about a path outside the repository", () => {
    expect(() => isTracked("../../../etc/passwd")).toThrow(
      /outside the repository/,
    );
  });

  it("refuses anything that could point outside the repository", () => {
    for (const candidate of [
      "../../../etc/passwd",
      "packages/../../escape.ts",
      "/etc/passwd",
      "C:\\Windows\\system32",
      "a\0b",
      "",
      undefined,
      null,
      42,
    ]) {
      expect(() => assertRepoRelative(candidate)).toThrow(
        /outside the repository/,
      );
    }
  });

  it("does not mistake a filename that merely contains dots", () => {
    expect(() => assertRepoRelative("packages/..foo/bar.ts")).not.toThrow();
    expect(() => assertRepoRelative("a.b/..c.ts")).not.toThrow();
  });
});

describe("fork-check ownership", () => {
  it("matches on path segments, not on prefixes", () => {
    expect(isOwned("unobravo")).toBe(true);
    expect(isOwned("unobravo/config/features.ts")).toBe(true);
    expect(
      isOwned("excalidraw-app/components/unobravo/UnobravoFooter.tsx"),
    ).toBe(true);
    expect(isOwned("scripts/fork-check.js")).toBe(true);
    expect(isOwned(".claude/skills/upstream-sync/SKILL.md")).toBe(true);
    expect(isOwned(".zed/settings.json")).toBe(true);

    // a prefix match would wrongly claim these as ours, and an unregistered
    // upstream edit would slip past the register
    expect(isOwned("unobravox/foo.ts")).toBe(false);
    expect(isOwned("unobravo.md")).toBe(false);
    expect(isOwned("scripts/fork-check.js.bak")).toBe(false);
    expect(isOwned(".claudeignore")).toBe(false);
    expect(isOwned("excalidraw-app/components/AppFooter.tsx")).toBe(false);
  });

  it("owns the deploy workflows without owning the directory they sit in", () => {
    // `.github/workflows/` holds eleven upstream workflows and five of ours.
    // Owning the directory would be the easy way to skip ours and the exact way
    // to stop noticing an edit to one of theirs.
    for (const workflow of [
      ".github/workflows/unobravo-deploy.yml",
      ".github/workflows/unobravo-deploy-manual.yml",
      ".github/workflows/unobravo-build-app.yml",
      ".github/workflows/unobravo-deploy-app.yml",
      ".github/workflows/unobravo-check-labels.yml",
    ]) {
      expect(isOwned(workflow)).toBe(true);
      expect(isIgnored(workflow)).toBe(false);
    }

    expect(isOwned(".github/workflows")).toBe(false);
    expect(isOwned(".github/workflows/lint.yml")).toBe(false);
  });

  it("claims nothing under .claude that git ignores", () => {
    // `.claude/` is the one directory we only partly commit: the skills are
    // ours, the rest is whatever Claude Code writes on a given machine. The
    // two halves have to agree, because owning an ignored path makes
    // `fork-check` report "files we own are ignored by git" — and it does so
    // only for developers who happen to have that file, which is nobody on CI.
    expect(isIgnored(".claude/skills/upstream-sync/SKILL.md")).toBe(false);
    expect(isOwned(".claude/skills/upstream-sync/SKILL.md")).toBe(true);

    expect(isIgnored(".claude/settings.local.json")).toBe(true);
    expect(isOwned(".claude/settings.local.json")).toBe(false);
  });
});

describe("fork-check register parsing", () => {
  it("reads a section between its markers", () => {
    const markdown = [
      "intro",
      "<!-- fork-check:files:start -->",
      "| a | b |",
      "<!-- fork-check:files:end -->",
      "outro",
    ].join("\n");

    expect(section(markdown, "files")).toContain("| a | b |");
    expect(section(markdown, "files")).not.toContain("intro");
  });

  it("fails loudly when a section is missing", () => {
    expect(() => section("no markers here", "files")).toThrow(/missing/);
  });

  it("splits rows with and without a trailing pipe, honouring escapes", () => {
    expect(splitRow("| a | b | c |")).toEqual(["a", "b", "c"]);
    // a row written without the trailing pipe must not lose its last column
    expect(splitRow("| a | b | c")).toEqual(["a", "b", "c"]);
    expect(splitRow("| a \\| b | c |")).toEqual(["a | b", "c"]);
  });

  it("recognises every alignment form of a separator row", () => {
    for (const row of [
      ["---"],
      [":---", "---:"],
      [":-:", "-"],
      ["-----", ":----:"],
    ]) {
      expect(isSeparatorRow(row)).toBe(true);
    }

    expect(isSeparatorRow(["a", "b"])).toBe(false);
    expect(isSeparatorRow([])).toBe(false);
  });

  it("drops the header and the separator, whatever the alignment", () => {
    const body = [
      "| File | Why |",
      "| :--- | ---: |",
      "| `a.ts` | because |",
      "| `b.ts` | reasons |",
    ].join("\n");

    expect(tableRows(body).map((cells) => unquote(cells[0]))).toEqual([
      "a.ts",
      "b.ts",
    ]);
  });

  it("keeps every row when a table has no separator, so the check fails loudly", () => {
    // a malformed register must not silently parse as an empty table, which
    // would report every registered file as stale rather than saying nothing
    const body = ["| File | Why |", "| `a.ts` | because |"].join("\n");

    expect(tableRows(body)).toHaveLength(2);
  });
});
