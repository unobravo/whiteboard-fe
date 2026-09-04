---
name: upstream-sync
description: Merge upstream excalidraw/excalidraw into this fork as a reviewable PR — handles the FORK.md register, silent overlay drift, CI to green, and records what it learned. Use when asked to sync the fork, merge upstream, pull in upstream changes, or when master is behind excalidraw/master.
---

# Sync the fork with upstream Excalidraw

`unobravo/whiteboard-fe` is a fork of `excalidraw/excalidraw`. Upstream moves constantly; this fork holds a couple of dozen registered modifications and 3 overlay components — `yarn fork:check` prints the current counts. Merging the two is the moment the fork's guarantees are most likely to break, and to break _quietly_.

Read `unobravo/FORK.md` before starting. This skill assumes its four-level model (1 public prop, 2 overlay, 3 upstream-shaped prop, 4 inline gate) and enforces its register.

## What makes this dangerous

Four failure modes, in order of how easy they are to miss:

1. **Overlay drift — no conflict, no error, wrong app.** `AppMainMenu.tsx`, `AppWelcomeScreen.tsx` and `AppFooter.tsx` are kept in the tree **unmodified**, imported by nothing. They exist only as hash references; `excalidraw-app/components/unobravo/Unobravo*.tsx` shadow them via one import in `excalidraw-app/App.tsx`. When upstream edits one, git merges it cleanly, the app keeps rendering the fork's stale copy, and the only signal is a `fork:check` hash mismatch. **Never "fix" this by editing the upstream file or bumping the hash alone** — port the change into the overlay.
2. **A dropped gate.** Upstream moves the line a `{FEATURES.x && …}` gate was attached to, git resolves in upstream's favour, and a gated surface silently comes back. `unobravo/tests/` and `excalidraw-app/components/unobravo/*.test.tsx` are the net; they only help if they run.
3. **A sync that lands as a squash.** The merge is correct, the review is fine, and the defect is created by the button the reviewer presses. Squashing drops the second parent, so upstream's commits never become ancestors of `master` and `git merge-base` — which is what `fork-check` diffs against — stays pinned at the pre-sync base. From then on `yarn fork:check` fails on a pristine `master` for everyone, reporting upstream's own files as unregistered fork changes, and `test:all` fails with it. Phase 0 detects it; Phase 7 is where you prevent it.
4. **CI that looks greener than it is.** On this repo, worse than it sounds — see below. Even where Actions does run, `yarn test:app` is **not** among the PR checks; only `yarn test:coverage` inside `test-coverage-pr.yml` is. The local gate in Phase 6 is the real gate.

> **GitHub Actions was fork-gated here until 2026-08-05 — verify which regime you are in.** GitHub keeps Actions disabled on forks until a human enables them. Through 2026-08-04 (runs #4–#8) `gh run list` was **empty repo-wide** and the only reporting check was the third-party `semgrep-cloud-platform/scan`. On **PR #23 (2026-08-05) Actions went live and all jobs passed** — `fork-check` (14s), `lint`, `size`, `coverage`, `semantic`, `label-scope`. So `fork-check` now runs in CI as `CLAUDE.md` always claimed, and CI results are real evidence again.
>
> Do not assume either state — `gh run list --branch <branch>` in Phase 8 is the authority. A fork can be re-gated, and a green `gh pr checks` reporting only `semgrep` still means nothing ran. When the workflow jobs do run, read them as the gate they are.

## Facts that trip people up

|  |  |
| --- | --- |
| Upstream remote is named | **`excalidraw`**, not `upstream` |
| `fork-check` base | `git merge-base excalidraw/master HEAD` — a stale local ref validates old blobs, so **fetch first** |
| Overlay hash is | `git hash-object` of the **upstream** file, not of the overlay |
| PR title must be | conventional commit **with a scope** from `app / editor / packages/excalidraw / packages/utils / docker / repo` |
| Sync PRs use | `chore(repo): …` |
| Never | push a sync straight to `master` — the `fork-check` CI job is `on: pull_request` only, so a direct push skips it entirely |
| Never | let a sync PR be **squash-merged**. It must land as a merge commit — see Phase 0 and Phase 7 |

## Phase 0 — Preflight

Every check here is a stop condition. Do not repair the working tree on the user's behalf.

```bash
git status --porcelain                     # must be empty
git branch --show-current                  # must be master
git rev-parse --is-shallow-repository      # must be false — see below if true
git fetch origin && git fetch excalidraw master
TIP=$(git rev-parse excalidraw/master)     # pin it — the ref can move mid-run
BASE=$(git merge-base $TIP master)
git rev-list --left-right --count $TIP...master   # "<behind> <ahead>"
gh auth status
gh run list --limit 1                      # was empty (fork-gated) through 2026-08-04; live since PR #23. Confirm which regime
yarn fork:check                            # baseline
```

- If `git remote get-url excalidraw` fails: `git remote add excalidraw https://github.com/excalidraw/excalidraw.git`.
- **If the repo is a shallow clone, `git merge-base` fails outright** (exit 1, "no common ancestor") rather than reporting a wrong count, and `yarn fork:check` fails first with "could not resolve the upstream base" — a different error from a missing remote, and its own suggested fix (re-add/re-fetch `excalidraw`) does nothing for a shallow clone. Run `git fetch --unshallow origin` before computing `$BASE`/`$TIP`.
- **Pin `$TIP` and use the SHA from here on.** `excalidraw/master` is a moving ref and it has moved between Phase 0 and Phase 2 in practice, which silently invalidates every number in the Phase 1 scoping.
- If `behind` is 0, say so and stop. There is nothing to sync.
- Report the CI regime **now**, not at Phase 8. If `gh run list` is empty, Actions is fork-gated: the merge is validated only by this machine, Phase 6 is the only gate, and the PR body must say CI did not run. If jobs do run (the state since PR #23), Phase 6 is still worth doing — no PR check builds the app — but CI becomes corroborating evidence rather than the sole gate.

### If `yarn fork:check` fails, find out which kind of failure it is

**`yarn fork:check` must pass before the merge**, and a pre-existing failure inherited from `master` must not be attributed to upstream — but there are two reasons it can be red on a clean tree, and only one of them is a stop condition.

```bash
git diff --name-only $TIP master     # the diagnostic
```

- **Only fork-owned and registered files listed** ⇒ `master` already contains upstream's content, so the report is a **merge-base artifact**, not drift. Proceed; the merge is the repair. See below.
- **An unregistered upstream file listed** ⇒ real, unregistered fork drift on `master`. Report it and stop. It has nothing to do with this sync.

The artifact case comes from a previous sync PR having been **squash-merged**. A squash gives the merge commit a single parent, so upstream's commits never become ancestors of `master`, `git merge-base` stays pinned at the pre-sync base, and `fork-check` — which diffs against that base — reports upstream's own changed files as unregistered fork modifications. From a stale base the two are genuinely indistinguishable.

The tell is a `behind` count above 0 while the content is already identical. Confirm and repair:

```bash
git log --oneline -1 --format='%h %p %s' master   # one parent on a sync commit ⇒ squashed
git merge-base --is-ancestor $TIP master && echo linked || echo "graph broken"
```

The repair is the ordinary merge in Phase 2: it reconnects the graph, advances the merge-base to `$TIP`, and `fork-check` goes green and stays green. Say so in the PR body, and carry the merge-method warning of Phase 7 — squashing the repair reintroduces the defect it fixes.

## Phase 1 — Scope it before touching anything

```bash
git log --oneline $BASE..$TIP
git diff --name-only $BASE..$TIP
```

Intersect that file list with:

- every path in the `fork-check:files` table of `unobravo/FORK.md`, and
- the 3 upstream paths in the `fork-check:overlays` table.

Report the intersection to the user **before merging**. This is the predicted trouble list, and it is the cheapest moment to discover the merge is bigger than expected.

## Phase 2 — Branch and merge

```bash
git switch -c chore/upstream-sync-<YYYY-MM-DD>     # -2, -3 … if taken
git merge $TIP                                     # the SHA, not the ref
```

Let it conflict. Do not use `--no-commit`, `-X ours` or `-X theirs` — a strategy option resolves conflicts by rule, and the whole point of this phase is that a human sees them.

## Phase 3 — Conflict triage

First, confirm what actually merged. If Phase 2 used the ref instead of `$TIP`, or the fetch is older than the run, the second parent is the only authority on the range:

```bash
git log --oneline -1 --format='%p'                 # "<first> <second>"; second parent = merged tip
git diff --name-only --diff-filter=U
```

If the second parent is not `$TIP`, re-run Phase 1 against it before going further — the predicted trouble list was about a different range, and a diffstat much larger than Phase 1 forecast is the symptom.

Two classes are **regenerated, never hand-merged**:

| Path | Action |
| --- | --- |
| `yarn.lock` | `git checkout --theirs yarn.lock` then `yarn install`, commit the result |
| `packages/**/__snapshots__/*.snap` | `git checkout --theirs <file>` then `yarn test:update`, then read the diff |

**Everything else stops and asks.** Do not assume a conflict is "just upstream". A conflict requires both sides to have edited the file, and this fork only edits registered or owned files — so a textual conflict is by construction on fork-modified code.

For each conflicted file, give the user:

- the conflict hunks (trimmed to the relevant lines),
- which fork mechanism lives there — look the file up in the FORK.md table and quote its Level and Why,
- a proposed resolution and what it costs,

then wait. `excalidraw-app/App.tsx` is the highest-attention file in the repo: it is the only one mixing levels 1, 2 and 4, and it is where the overlay imports and the feature gates both live.

See `reference/conflict-playbook.md` for per-file-class guidance.

## Phase 4 — Overlay drift (the silent one)

Do this **even when the merge had zero conflicts**. It is a separate failure mode.

For each row in the `fork-check:overlays` table:

```bash
git hash-object excalidraw-app/components/AppFooter.tsx     # vs the registered hash
git diff <registered-hash> -- excalidraw-app/components/AppFooter.tsx
```

On a mismatch:

1. Read the upstream diff and the corresponding `Unobravo*.tsx`.
2. Decide whether the change is one the fork wants (a bug fix, an accessibility fix, a new prop) or one it deliberately dropped (an Excalidraw+ link, a social link).
3. **Propose the exact port and ask.** Then apply it and update the hash **in the same commit** — a bumped hash without a port is a lie in the register.
4. If the upstream reference was deleted or renamed upstream, `fork-check` reports "overlaying nothing". Stop and ask: the overlay's premise is gone.

## Phase 5 — Register upkeep

`yarn fork:check`, then iterate until clean.

| Report | Meaning | Action |
| --- | --- | --- |
| `unregistered` | upstream file now differs and has no row | add a row: File / Level / Why / Upstream candidate, matching neighbouring style |
| `stale` | row exists, file no longer differs | drop the row — upstream absorbed the change. Call it out in the PR body; the fork shrank |
| overlay not tracked | upstream moved or deleted the reference | Phase 4, step 4 |
| hash mismatch | overlay drift | Phase 4 |
| owned path ignored by git | a `.gitignore` pattern is eating fork files | see below — the remedy depends on which side is wrong |

"files we own are ignored by git" has two causes and they pull in opposite directions. Either a `.gitignore` pattern really is eating files we ship — the `unobravo/build/` incident, remedy is a negation — **or** `OWNED_PATHS` is claiming a directory we only partly commit, and the remedy is to narrow the claim. `.claude/` is the second kind: `skills/` is ours, everything else is per-developer Claude Code state that `.gitignore` drops on purpose. Adding a negation there would commit someone's local settings. Read which file it names before acting; the message only suggests the first remedy.

Also worth harvesting for the PR body, though not enforced: an upstream commit that adds a prop or option making a level-3 or level-4 gate unnecessary. That is the fork getting smaller, and it is the stated goal in `CLAUDE.md`.

**Register totals are read, never written.** `fork:check` prints the count; prose that restates it goes stale on the next register change. This has now been fixed twice — in this file, and in the paragraph under `unobravo/FORK.md`'s file table. If you find a number written down, replace it with a pointer to the command.

## Phase 6 — Local gate, before pushing

```bash
yarn install        # only if a manifest or the lockfile moved
yarn test:all       # fork:check → typecheck → eslint → prettier → vitest
yarn build
```

Run it on the tree as it actually is, not a pristine one. `fork-check` reads `git status --ignored`, so its result depends on local untracked and ignored state — a gate that is green only because this machine happens to be clean is not a gate. If a step passes here and you cannot say why it would pass on a teammate's checkout, that is the finding.

`yarn fix` handles pure formatting fallout (prettier, eslint autofix). Anything else is a real failure — go back to Phase 3/4 reasoning rather than patching the symptom.

`yarn build` is here because no PR check builds the app.

**Watch for a stale worktree polluting vitest.** `vitest.config.mts` sets no `exclude`, so vitest collects any `.claude/worktrees/*` copy left on disk. A dead worktree from an earlier branch (e.g. `pr-label-versioning` from PR #21) will run its _old_ tests and fail against merged code — ~20 phantom failures with paths under `.claude/worktrees/`, twice now. It is git-ignored, so it never enters the commit; it only lies about the local gate. Re-run with `yarn test:app --watch=false --exclude '**/.claude/**'` (or remove the dead worktree) to get the true main-tree count. CI's clean-checkout run is unaffected.

## Phase 7 — Open the PR

```bash
git push -u origin chore/upstream-sync-<YYYY-MM-DD>
gh pr create --base master \
  --title "chore(repo): sync upstream excalidraw (<base8>..<tip8>)" \
  --body-file <file>
```

Body sections, in order. Section 0 is not optional:

0. **The merge-method warning**, as the first thing a reviewer sees. A sync PR that is squash-merged pins `git merge-base` at the pre-sync base, which makes `fork-check` fail on a clean `master` for every developer until the next sync repairs it — the Phase 0 diagnostic exists because that already happened once. The reviewer clicking the default green button is all it takes, so the instruction belongs above the fold, not in a checklist at the bottom.

   Confirm the repo still permits it: `gh api repos/unobravo/whiteboard-fe --jq .allow_merge_commit`. If that is ever `false`, say so — the register cannot be kept honest without it.

1. **Upstream range** — `<base8>..<tip8>`, commit count, and the one-line log. Take `<tip8>` from the merge commit's second parent, not from the ref.
2. **Registered files touched** — which registered upstream files changed, and whether the gate survived.
3. **Conflicts** — one bullet each: file, what conflicted, how it was resolved, who decided.
4. **Overlay drift** — per overlay: drifted or clean; if drifted, the upstream change and the port.
5. **Register changes** — rows added or dropped, with the reason.
6. **Verification** — the local commands that ran and their result, and **whether CI ran at all**.
7. **Deferred** — anything knowingly left for later. Empty is a valid answer; silence is not.

Also: the register count in section 2 is whatever `fork:check` currently reports, not a number copied from this file. It moves.

Never merge the PR yourself. A green PR awaiting review is the end state — but tell the user, in the final report as well as in the body, that it must land as a merge commit. Both places: the body is for the reviewer, the report is for whoever asked for the sync, and they are often not the same person.

## Phase 8 — Drive CI to green

```bash
gh pr checks <n> --watch
gh run list --branch <branch>      # what actually executed
```

Expected checks **if Actions is enabled**: `lint`, `fork-check`, `coverage`, `size`, `semantic`, `label-scope`.

**Check that they ran before reading them as passing.** `gh pr checks` reports the checks that exist. Through 2026-08-04 that meant a single third-party `semgrep-cloud-platform/scan` and nothing else, and `--watch` exited happily once it finished while the real six had not run. Since PR #23 the six do run (`gh pr checks --watch` there returned all green in ~5 min, `coverage` the long pole). `gh run list --branch <branch>` is the tell either way: empty ⇒ still gated, populated ⇒ read the jobs as the gate.

If Actions did not run, say so plainly in the PR and to the user — "CI did not execute; validated by `yarn test:all` and `yarn build` locally" — and do not call the PR green. If it did run and passed, say that, and note the local gate additionally covered the app build that no CI job runs.

Fix and push without asking:

| Failure | Fix |
| --- | --- |
| prettier / eslint | `yarn fix` |
| snapshot mismatch | `yarn test:update`, then read the diff before committing |
| `fork-check` | back to Phase 5 |
| typecheck errors that are pure merge fallout (upstream renamed a symbol, moved an import) | follow upstream's rename |
| `semantic` | fix the PR title scope |

Stop and ask for: failing test assertions, `size` regressions, coverage drops, anything where the right answer depends on what the fork _wants_ rather than on what compiles.

When quoting a failure, quote the shortest decisive line, not the log.

## Phase 9 — Meta-analysis (do not skip)

This skill is expected to get better every run. Evidence beats memory, so write it down while it is fresh.

1. Append a dated entry to `RUNLOG.md` — the template is at the bottom of that file. Record: the upstream range, what conflicted, what drifted, **every question asked and whether it needed asking**, every command that failed and why, and every surprise.
2. Edit this file and `reference/conflict-playbook.md` from that evidence:
   - a question answered the same way twice becomes a documented default,
   - a step that was missing becomes a phase,
   - an assumption that turned out wrong gets corrected at the source, not annotated,
   - a phase that keeps doing nothing gets folded into another.
3. Commit as a **separate commit** on the same branch so the reviewer can read the merge and the skill change apart:

   ```
   chore(repo): record upstream-sync run and refine the skill
   ```

   Prettier-format this commit before pushing — `yarn prettier --write` on the files you edited. The `lint` CI job runs `test:other` (`prettier --list-different`) over `**/*.md`, so an unformatted RUNLOG/SKILL edit turns `lint` red even though it is not code, and Phase 9 lands after the Phase 6 gate so nothing else re-runs prettier for you.

If the run was trivial — no conflicts, no drift — say exactly that and list which phases went unexercised. Inventing lessons from a quiet run is how a checklist rots.
