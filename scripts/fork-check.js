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
  // only the part of `.claude/` we commit — the rest is per-developer state
  // that `.gitignore` drops on purpose. Re-include a path there, add it here.
  ".claude/skills",
  // our deploy pipeline. Listed file by file, not by directory: GitHub has no
  // subdirectories under `.github/workflows/`, and owning the directory would
  // stop the register noticing an edit to one of upstream's eleven workflows.
  ".github/workflows/unobravo-deploy.yml",
  ".github/workflows/unobravo-deploy-app.yml",
  ".github/workflows/unobravo-deploy-manual.yml",
];

const git = (...args) =>
  execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });

const isOwned = (file) =>
  OWNED_PATHS.some((owned) => file === owned || file.startsWith(`${owned}/`));

/**
 * Extracts the body of a `<!-- fork-check:<name>:start|end -->` section.
 *
 * Sliced rather than matched with a regex built from `name`: the two callers
 * pass literals, but interpolating anything into a pattern invites a scanner
 * finding today and a real one the day someone makes `name` dynamic.
 */
const section = (markdown, name) => {
  const start = markdown.indexOf(`<!-- fork-check:${name}:start -->`);
  const end = markdown.indexOf(`<!-- fork-check:${name}:end -->`);

  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      `unobravo/FORK.md is missing the '${name}' section markers.`,
    );
  }

  return markdown.slice(
    start + `<!-- fork-check:${name}:start -->`.length,
    end,
  );
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
 * Resolves a path from the register, refusing anything that could escape the
 * repository.
 *
 * The register is a reviewed in-repo file, so this is belt and braces — but the
 * script reads it and then touches the filesystem with what it finds. The shape
 * is validated *before* resolving rather than only after: rejecting the input
 * outright is easier to reason about, and easier for a scanner to see, than
 * proving after the fact that a resolved path landed somewhere safe.
 */
const assertRepoRelative = (candidate) => {
  if (
    typeof candidate !== "string" ||
    candidate === "" ||
    candidate.includes("\0") ||
    path.isAbsolute(candidate) ||
    /^[a-zA-Z]:/.test(candidate) ||
    candidate.split(/[\\/]/).includes("..")
  ) {
    throw new Error(
      `unobravo/FORK.md refers to a path outside the repository: ${candidate}`,
    );
  }

  return candidate;
};

/**
 * Whether git tracks the path the register names.
 *
 * Asking git rather than the filesystem is the stronger question, and the one
 * we actually mean: a file that exists on disk but was never committed is
 * exactly how the font plugin went missing from a clean checkout while every
 * local build kept working. It also means no register string is ever joined
 * into a filesystem path.
 */
const isTracked = (relativePath) => {
  assertRepoRelative(relativePath);

  try {
    git("ls-files", "--error-unmatch", "--", relativePath);
    return true;
  } catch {
    return false;
  }
};

/**
 * Whether `.gitignore` drops the path.
 *
 * Paired with `isOwned`: a path we own must not be ignored, and an ignored path
 * must not be owned. Claiming a directory we only partly commit breaks the
 * second half — `.claude/` holds our skills next to per-developer Claude Code
 * state, and owning all of it made the check below fail on every machine where
 * that state exists.
 */
const isIgnored = (relativePath) => {
  assertRepoRelative(relativePath);

  try {
    // `check-ignore` exits 1 when nothing matches, which is the good case
    return git("check-ignore", "--", relativePath).trim() !== "";
  } catch {
    return false;
  }
};

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

  // untracked files only — the part `git diff` misses. Tracked modifications,
  // committed or not, are already in the diff above; taking them from `status`
  // as well would flag a file being *reverted* to upstream, since it differs
  // from HEAD while matching the base.
  const status = git("status", "--porcelain", "--untracked-files=all");
  for (const line of status.split("\n").filter(Boolean)) {
    if (!line.startsWith("??")) {
      continue;
    }
    changed.add(line.slice(3).replace(/^"|"$/g, ""));
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

  // --- 2. our own files are actually committed -------------------------------
  //
  // `.gitignore` carries a bare `build` pattern, which matches at any depth —
  // so `unobravo/build/…` was silently excluded from every commit while the
  // working tree kept building fine. `changedPaths` cannot see this: git does
  // not report ignored files, and `OWNED_PATHS` filters our directories out
  // anyway. Ask git directly instead.
  for (const owned of OWNED_PATHS) {
    if (!fs.existsSync(path.join(REPO_ROOT, owned))) {
      continue;
    }

    if (isIgnored(owned)) {
      problems.push(
        `'${owned}' is matched by .gitignore, so it will never be committed.\n` +
          `  The working tree would keep building while a clean checkout breaks.\n` +
          `  Rename the path or add a negation to .gitignore.`,
      );
    }
  }

  const untrackedOwned = git(
    "status",
    "--porcelain",
    "--ignored=matching",
    "--untracked-files=all",
    "--",
  )
    .split("\n")
    .filter((line) => line.startsWith("!!"))
    .map((line) => line.slice(3).replace(/^"|"$/g, ""))
    .filter((file) => isOwned(file));

  if (untrackedOwned.length) {
    problems.push(
      `${
        untrackedOwned.length
      } file(s) we own are ignored by git:\n${untrackedOwned
        .map((file) => `    ${file}`)
        .join(
          "\n",
        )}\n  They exist locally and are absent from every clone. Rename the ` +
        `path or add a negation to .gitignore.`,
    );
  }

  // --- 3. overlay drift ------------------------------------------------------

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

    if (!isTracked(upstreamFile)) {
      problems.push(
        `Overlay reference '${upstreamFile}' is not tracked by git.\n` +
          `  Upstream moved or deleted it, so '${overlay}' is overlaying nothing.`,
      );
      continue;
    }

    if (!isTracked(overlay)) {
      problems.push(
        `Overlay '${overlay}' is registered but not tracked by git.`,
      );
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
  assertRepoRelative,
  isIgnored,
  isOwned,
  isTracked,
  isSeparatorRow,
  section,
  splitRow,
  tableRows,
  unquote,
};

if (require.main === module) {
  main();
}
