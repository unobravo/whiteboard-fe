---
name: upstream-sync
description: Merge upstream excalidraw/excalidraw into this fork as a reviewable PR — handles the FORK.md register, silent overlay drift, CI to green, and records what it learned. Use when asked to sync the fork, merge upstream, pull in upstream changes, or when master is behind excalidraw/master.
---

# Sync the fork with upstream Excalidraw

`unobravo/whiteboard-fe` is a fork of `excalidraw/excalidraw`. Upstream moves constantly; this fork holds a couple of dozen registered modifications and 3 overlay components — `yarn fork:check` prints the current counts. Merging the two is the moment the fork's guarantees are most likely to break, and to break _quietly_.

Read `unobravo/FORK.md` before starting. This skill assumes its four-level model (1 public prop, 2 overlay, 3 upstream-shaped prop, 4 inline gate) and enforces its register.

## What makes this dangerous

Three failure modes, in order of how easy they are to miss:

1. **Overlay drift — no conflict, no error, wrong app.** `AppMainMenu.tsx`, `AppWelcomeScreen.tsx` and `AppFooter.tsx` are kept in the tree **unmodified**, imported by nothing. They exist only as hash references; `excalidraw-app/components/unobravo/Unobravo*.tsx` shadow them via one import in `excalidraw-app/App.tsx`. When upstream edits one, git merges it cleanly, the app keeps rendering the fork's stale copy, and the only signal is a `fork:check` hash mismatch. **Never "fix" this by editing the upstream file or bumping the hash alone** — port the change into the overlay.
2. **A dropped gate.** Upstream moves the line a `{FEATURES.x && …}` gate was attached to, git resolves in upstream's favour, and a gated surface silently comes back. `unobravo/tests/` and `excalidraw-app/components/unobravo/*.test.tsx` are the net; they only help if they run.
3. **CI that looks greener than it is.** On this repo, worse than it sounds — see below. Even where Actions does run, `yarn test:app` is **not** among the PR checks; only `yarn test:coverage` inside `test-coverage-pr.yml` is. The local gate in Phase 6 is the real gate.

> **GitHub Actions may not run here at all.** This repo is a fork, and GitHub keeps Actions disabled on forks until a human enables them in the repo's Actions tab. As of 2026-08-03 `gh run list` returns **zero runs repo-wide** — the `lint`, `fork-check`, `coverage`, `size` and `semantic` jobs have never executed on any PR, including merged ones. The only check reporting is `semgrep-cloud-platform/scan`, a third-party app that does not read `.github/workflows/`.
>
> Verify this in Phase 0 and treat the answer as changing what Phase 8 can mean. A green `gh pr checks` on a repo where nothing ran is not evidence of anything.

## Facts that trip people up

|  |  |
| --- | --- |
| Upstream remote is named | **`excalidraw`**, not `upstream` |
| `fork-check` base | `git merge-base excalidraw/master HEAD` — a stale local ref validates old blobs, so **fetch first** |
| Overlay hash is | `git hash-object` of the **upstream** file, not of the overlay |
| PR title must be | conventional commit **with a scope** from `app / editor / packages/excalidraw / packages/utils / docker / repo` |
| Sync PRs use | `chore(repo): …` |
| Never | push a sync straight to `master` — the `fork-check` CI job is `on: pull_request` only, so a direct push skips it entirely |

## Phase 0 — Preflight

Every check here is a stop condition. Do not repair the working tree on the user's behalf.

```bash
git status --porcelain                     # must be empty
git branch --show-current                  # must be master
git fetch origin && git fetch excalidraw master
git rev-list --left-right --count excalidraw/master...master   # "<behind> <ahead>"
gh auth status
gh run list --limit 1                      # empty ⇒ Actions is fork-gated; Phase 6 is the only gate
yarn fork:check                            # baseline
```

- If `git remote get-url excalidraw` fails: `git remote add excalidraw https://github.com/excalidraw/excalidraw.git`.
- **`yarn fork:check` must pass before the merge.** A pre-existing failure inherited from master must not be attributed to upstream. If it fails, report it and stop.
- If `behind` is 0, say so and stop. There is nothing to sync.
- If `gh run list` is empty, say so **now**, not at Phase 8. It changes the deal: the merge will be validated only by what runs on this machine, so Phase 6 becomes mandatory rather than prudent, and the PR body must state that CI did not run rather than implying it passed.

## Phase 1 — Scope it before touching anything

```bash
BASE=$(git merge-base excalidraw/master master)
git log --oneline $BASE..excalidraw/master
git diff --name-only $BASE..excalidraw/master
```

Intersect that file list with:

- every path in the `fork-check:files` table of `unobravo/FORK.md`, and
- the 3 upstream paths in the `fork-check:overlays` table.

Report the intersection to the user **before merging**. This is the predicted trouble list, and it is the cheapest moment to discover the merge is bigger than expected.

## Phase 2 — Branch and merge

```bash
git switch -c chore/upstream-sync-<YYYY-MM-DD>     # -2, -3 … if taken
git merge excalidraw/master
```

Let it conflict. Do not use `--no-commit`, `-X ours` or `-X theirs` — a strategy option resolves conflicts by rule, and the whole point of this phase is that a human sees them.

## Phase 3 — Conflict triage

```bash
git diff --name-only --diff-filter=U
```

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
| owned path ignored by git | a `.gitignore` pattern is eating fork files | stop and ask |

Also worth harvesting for the PR body, though not enforced: an upstream commit that adds a prop or option making a level-3 or level-4 gate unnecessary. That is the fork getting smaller, and it is the stated goal in `CLAUDE.md`.

## Phase 6 — Local gate, before pushing

```bash
yarn install        # only if a manifest or the lockfile moved
yarn test:all       # fork:check → typecheck → eslint → prettier → vitest
yarn build
```

`yarn fix` handles pure formatting fallout (prettier, eslint autofix). Anything else is a real failure — go back to Phase 3/4 reasoning rather than patching the symptom.

`yarn build` is here because no PR check builds the app.

## Phase 7 — Open the PR

```bash
git push -u origin chore/upstream-sync-<YYYY-MM-DD>
gh pr create --base master \
  --title "chore(repo): sync upstream excalidraw (<base8>..<tip8>)" \
  --body-file <file>
```

Body sections, in order:

1. **Upstream range** — `<base8>..<tip8>`, commit count, and the one-line log.
2. **Registered files touched** — which registered upstream files changed, and whether the gate survived.
3. **Conflicts** — one bullet each: file, what conflicted, how it was resolved, who decided.
4. **Overlay drift** — per overlay: drifted or clean; if drifted, the upstream change and the port.
5. **Register changes** — rows added or dropped, with the reason.
6. **Verification** — the local commands that ran and their result, and **whether CI ran at all**.
7. **Deferred** — anything knowingly left for later. Empty is a valid answer; silence is not.

Also: the register count in section 2 is whatever `fork:check` currently reports, not a number copied from this file. It moves.

Never merge the PR. A green PR awaiting review is the end state.

## Phase 8 — Drive CI to green

```bash
gh pr checks <n> --watch
gh run list --branch <branch>      # what actually executed
```

Expected checks **if Actions is enabled**: `lint`, `fork-check`, `coverage`, `size`, `semantic`, `label-scope`.

**Check that they ran before reading them as passing.** `gh pr checks` reports the checks that exist, and on this fork that has meant a single third-party `semgrep-cloud-platform/scan` and nothing else. `--watch` exits happily once that one finishes; the absence of the other six is not visible unless you look. `gh run list --branch <branch>` returning empty is the tell.

If Actions did not run, say so plainly in the PR and in the report to the user. Do not describe the PR as green. The honest sentence is "CI did not execute; the merge was validated by `yarn test:all` and `yarn build` locally".

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

If the run was trivial — no conflicts, no drift — say exactly that and list which phases went unexercised. Inventing lessons from a quiet run is how a checklist rots.
