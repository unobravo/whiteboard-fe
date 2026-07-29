#!/usr/bin/env node
/* eslint-disable no-console -- this is a CLI check; its output is the product */
/**
 * Keeps the fork honest.
 *
 * The fork's whole strategy is "touch as little upstream code as possible, and
 * know exactly what we touched". Two things quietly erode that:
 *
 *   1. Someone patches an upstream file without telling anyone, and the fork
 *      grows one file at a time until merges hurt.
 *   2. Upstream edits a file we overlaid in `excalidraw-app/components/unobravo/`.
 *      The merge resolves cleanly — our copy simply never gets the change, and
 *      nobody finds out.
 *
 * `unobravo/FORK.md` is the register of both. This script diffs reality
 * against it, and fails rather than guessing: a check that cannot run is not a
 * check that passed.
 *
 *   node scripts/fork-check.js
 *   FORK_CHECK_BASE=<ref> node scripts/fork-check.js   # default: excalidraw/master
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const REGISTER = path.join(REPO_ROOT, "unobravo", "FORK.md");
const DEFAULT_BASE = "excalidraw/master";

/**
 * Paths that are ours to begin with, so the register never has to mention them.
 * Matched on path segments — `scripts/fork-check.js.bak` is not "owned" just
 * because it shares a prefix with `scripts/fork-check.js`.
 */
const OWNED_PATHS = [
  "unobravo",
  "excalidraw-app/components/unobravo",
  "scripts/fork-check.js",
];

const git = (...args) =>
  execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });

const isOwned = (file) =>
  OWNED_PATHS.some((owned) => file === owned || file.startsWith(`${owned}/`));

/** Extracts the body of a `<!-- fork-check:<name>:start|end -->` section. */
const section = (markdown, name) => {
  const match = markdown.match(
    new RegExp(
      `<!-- fork-check:${name}:start -->([\\s\\S]*?)<!-- fork-check:${name}:end -->`,
    ),
  );

  if (!match) {
    throw new Error(
      `unobravo/FORK.md is missing the '${name}' section markers.`,
    );
  }

  return match[1];
};

/** Splits one markdown table row into trimmed cells, honouring `\|` escapes. */
const splitRow = (line) => {
  const cells = [];
  let cell = "";

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === "\\" && line[i + 1] === "|") {
      cell += "|";
      i++;
    } else if (char === "|") {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);

  // a leading `|` always yields an empty first cell; a trailing one yields an
  // empty last cell, but rows written without it must not lose their last
  // column, so only the empties at the very edges are dropped
  if (cells.length && cells[0].trim() === "") {
    cells.shift();
  }
  if (cells.length && cells[cells.length - 1].trim() === "") {
    cells.pop();
  }

  return cells.map((value) => value.trim());
};

/** `---`, `:---`, `---:`, `:---:` — with or without padding. */
const isSeparatorRow = (cells) =>
  cells.length > 0 && cells.every((cell) => /^:?-{1,}:?$/.test(cell));

/** Data rows of a table: header and separator dropped. */
const tableRows = (markdownSection) => {
  const rows = markdownSection
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|"))
    .map(splitRow)
    .filter((cells) => cells.length > 0);

  // the first row is the header, the second the separator
  const firstSeparator = rows.findIndex(isSeparatorRow);

  return firstSeparator === -1
    ? rows
    : rows.slice(firstSeparator + 1).filter((cells) => !isSeparatorRow(cells));
};

const unquote = (cell) => cell.replace(/`/g, "").trim();

/**
 * Every path that differs from the upstream base, including files git does not
 * track yet. `git diff` alone reports neither untracked files nor the source
 * side of a rename, and both are exactly how an unregistered fork edit sneaks
 * past a register check.
 */
const changedPaths = (mergeBase) => {
  const changed = new Set();

  // committed changes, with renames reported as `R<score>\told\tnew`
  const nameStatus = git("diff", "--name-status", "-M", mergeBase, "--");
  for (const line of nameStatus.split("\n").filter(Boolean)) {
    const [status, ...paths] = line.split("\t");
    if (status.startsWith("R") || status.startsWith("C")) {
      // both sides matter: the old path left the tree, the new one entered it
      paths.forEach((file) => changed.add(file));
    } else {
      changed.add(paths[paths.length - 1]);
    }
  }

  // working tree: modified, staged, and — the part `git diff` misses —
  // untracked files
  const status = git("status", "--porcelain", "--untracked-files=all");
  for (const line of status.split("\n").filter(Boolean)) {
    const entry = line.slice(3);
    // renames in the index are reported as `old -> new`
    for (const file of entry.split(" -> ")) {
      changed.add(file.replace(/^"|"$/g, ""));
    }
  }

  return [...changed].filter((file) => file && !isOwned(file));
};

const main = () => {
  const problems = [];
  const markdown = fs.readFileSync(REGISTER, "utf8");

  // --- 1. registered files vs actually-modified files ------------------------

  const registered = new Set(
    tableRows(section(markdown, "files")).map((cells) => unquote(cells[0])),
  );

  const base = process.env.FORK_CHECK_BASE || DEFAULT_BASE;
  let mergeBase;

  try {
    mergeBase = git("merge-base", base, "HEAD").trim();
  } catch {
    // failing here is the point: half a guard reporting success is worse than
    // no guard, because CI reads it as "the fork is still small"
    console.error(
      `\nfork-check could not resolve the upstream base '${base}'.\n\n` +
        `  The register cannot be verified without it, and a partial check\n` +
        `  must not pass. Fix it with:\n\n` +
        `    git remote add excalidraw https://github.com/excalidraw/excalidraw.git\n` +
        `    git fetch excalidraw master\n\n` +
        `  or point the check at another base with FORK_CHECK_BASE=<ref>.\n`,
    );
    process.exit(1);
  }

  const changed = changedPaths(mergeBase);
  const unregistered = changed.filter((file) => !registered.has(file));
  const stale = [...registered].filter((file) => !changed.includes(file));

  if (unregistered.length) {
    problems.push(
      `${
        unregistered.length
      } upstream file(s) modified but not registered in unobravo/FORK.md:\n${unregistered
        .map((file) => `    ${file}`)
        .join(
          "\n",
        )}\n  Add a row explaining what the change is and which level it uses — ` +
        `or, better, find a way not to need it.`,
    );
  }

  if (stale.length) {
    problems.push(
      `${
        stale.length
      } file(s) registered in unobravo/FORK.md but no longer modified:\n${stale
        .map((file) => `    ${file}`)
        .join(
          "\n",
        )}\n  Drop the row. A register nobody trusts is worse than none.`,
    );
  }

  // --- 2. overlay drift ------------------------------------------------------

  const overlays = tableRows(section(markdown, "overlays"));

  if (!overlays.length) {
    problems.push(
      "unobravo/FORK.md declares no overlays. If the overlays were removed, " +
        "remove the section; otherwise the drift check is silently doing nothing.",
    );
  }

  for (const cells of overlays) {
    const [upstreamFile, overlay, expected] = cells.map(unquote);

    if (!upstreamFile || !overlay || !expected) {
      problems.push(
        `Malformed overlay row in unobravo/FORK.md: ${JSON.stringify(cells)}`,
      );
      continue;
    }

    if (!fs.existsSync(path.join(REPO_ROOT, upstreamFile))) {
      problems.push(
        `Overlay reference '${upstreamFile}' no longer exists.\n` +
          `  Upstream moved or deleted it, so '${overlay}' is overlaying nothing.`,
      );
      continue;
    }

    if (!fs.existsSync(path.join(REPO_ROOT, overlay))) {
      problems.push(`Overlay '${overlay}' is registered but missing.`);
      continue;
    }

    const actual = git("hash-object", upstreamFile).trim();

    if (actual !== expected) {
      problems.push(
        `Upstream changed '${upstreamFile}' (${expected.slice(
          0,
          8,
        )} -> ${actual.slice(0, 8)}).\n` +
          `  Port the change into '${overlay}', then update the hash in ` +
          `unobravo/FORK.md in the same commit.\n` +
          `  Diff it with: git diff ${expected} -- ${upstreamFile}`,
      );
    }
  }

  // --- report ----------------------------------------------------------------

  if (problems.length) {
    console.error(`\nfork-check found ${problems.length} problem(s):\n`);
    for (const problem of problems) {
      console.error(`  - ${problem}\n`);
    }
    process.exit(1);
  }

  console.log(
    `fork-check: ${registered.size} registered upstream file(s), ` +
      `${overlays.length} overlay(s) in sync, base ${mergeBase.slice(0, 8)}.`,
  );
};

module.exports = {
  isOwned,
  isSeparatorRow,
  section,
  splitRow,
  tableRows,
  unquote,
};

if (require.main === module) {
  main();
}
