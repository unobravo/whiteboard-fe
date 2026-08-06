# Upstream-sync run log

One entry per real run of the `upstream-sync` skill, newest last. Append-only.

This file exists so the skill improves from evidence rather than from memory. The entries are the input to Phase 9: a question asked twice and answered the same way becomes a default; a command that failed twice becomes a documented step; a phase that never does anything gets folded away.

Be honest about quiet runs. "Nothing conflicted, phases 3 and 4 went unexercised" is a useful entry. A run log that reads like every sync taught a profound lesson is a run log nobody trusts.

---

## Entry template

```markdown
## YYYY-MM-DD — <base8>..<tip8> (<n> commits)

- **PR:** #<n>
- **Predicted trouble (Phase 1):** registered/overlay files upstream touched, or "none"
- **Conflicts:** file → resolution, or "none"
- **Overlay drift:** overlay → drifted/clean; the port if drifted
- **Register changes:** rows added/dropped, or "none"
- **Questions asked:** each one, and whether it needed asking
- **Commands that failed:** command → error → fix
- **Surprises:** anything the skill did not predict
- **Phases unexercised:** list
- **Changes made to the skill:** what, and why the evidence supports it
```

---

## 2026-08-03 — 1acf66ed..786ab266 (2 commits)

First run. The skill was written and executed in the same session, so this entry is as much about the skill's assumptions as about the merge.

- **PR:** #7
- **Predicted trouble (Phase 1):** none. Upstream's 7 files (`ColorPicker/ColorInput.tsx`, `ColorPicker.scss`, `Modal.tsx`, `DropdownMenuContent.tsx`, `locales/en.json`, and `colorInput.test.ts` → `.tsx`) intersect the register and the overlay references in nothing.
- **Conflicts:** none. Clean `ort` merge.
- **Overlay drift:** all three clean; hashes unchanged.
- **Register changes:** `.gitignore` added — see surprises.
- **Questions asked:** none during the run. All four decision points were settled before it started (skill location, conflict autonomy, CI-failure policy, merge strategy), and none of them recurred.
- **Commands that failed:** `yarn fork:check` failed on the first attempt with "files we own are ignored by git → `.claude/`". Correct behaviour, and it caught a real problem before the commit.
- **Surprises:** two, both worth more than the merge itself.

  1. **Upstream ignores `.claude` in `.gitignore:29`.** Committing a skill to `.claude/skills/` therefore requires modifying an upstream file, which makes `.gitignore` the 27th register row. Not expensive, but it is a fork modification bought for tooling rather than for product, and the plan had assumed `.claude/` was simply untracked. Note that a bare `.claude` line cannot be negated per-subdirectory — git will not descend into an excluded directory — so it had to become `.claude/*` plus `!.claude/skills/`.
  2. **GitHub Actions has never run in this repository.** 11 workflows are registered and `active`, `actions/permissions` reports `enabled: true`, and `gh run list` returns **zero runs repo-wide** — on this PR, on #6, and on merged #4. The only reporting check is `semgrep-cloud-platform/scan`, a third-party app that does not read `.github/workflows/`. This is GitHub's fork gate: Actions stays off on a fork until a human enables it in the Actions tab.

     The consequence is structural, not cosmetic. `fork-check` — the one thing that catches overlay drift, and the reason `CLAUDE.md` says the register is enforced — **has never executed in CI**. The claim "`yarn fork:check` fails otherwise, and it runs in CI" is currently false. Until Actions is enabled, the local Phase 6 gate is the only gate that exists.

- **Phases unexercised:** 3 (conflict triage) and most of 5 (register upkeep from upstream churn) went untested — nothing conflicted and no upstream file entered or left the register. Phase 4 ran but only ever took the happy path. **Phase 8 could not run at all.** The conflict playbook is therefore unvalidated: it is reasoning, not experience, and the next contentful merge should be treated as its first real test.
- **Changes made to the skill:**
  - Phase 0 gained `gh run list --limit 1` and an instruction to report an empty result immediately, because discovering at Phase 8 that CI does not exist is discovering it too late.
  - Phase 8 gained the distinction between _checks passing_ and _checks running_, with `gh run list --branch` as the tell — `gh pr checks --watch` exits contentedly when the only check present is semgrep, which reads as green and is not.
  - The "what makes this dangerous" section leads with the Actions gap, since it changes what every later phase is worth.
  - Phase 7 now says the register count in the PR body comes from `fork:check` output rather than from a number written in this file. The skill was authored saying 26 and the answer was 27 within the hour.

### Post-review addendum

A review of PR #7 found a defect this run had shipped and its own gate had missed.

Adding `.claude` to `OWNED_PATHS` while `.gitignore` only re-includes `.claude/skills/` claimed a directory the fork **partly** commits. `fork-check`'s "files we own are ignored by git" guard then fired on `.claude/settings.local.json` — the file Claude Code writes the first time anyone approves a permission in this repo. `yarn fork:check` is the first step of `test:all`, so the whole local suite died, for every developer except the one who wrote it. CI would never have caught it: a fresh checkout has no local settings.

Two lessons, both now in the skill:

- **Phase 6 was green for the wrong reason.** `fork-check` reads `git status --ignored`, so its verdict is a function of local untracked state. This machine had no `.claude/settings.local.json`, so the gate passed and the PR reported that pass as evidence the merge was safe. Phase 6 now says to run the gate on the tree as it actually is and to treat "passes here, unclear why it would pass elsewhere" as a finding.
- **The guard's message names only one of its two remedies.** "Rename the path or add a negation to .gitignore" is right when a pattern is eating files we ship — and exactly wrong when `OWNED_PATHS` over-claims, where following it would commit someone's local settings. Phase 5 now spells out both directions.

Fixed by narrowing the owned path to `.claude/skills`, with `isIgnored` exported from `scripts/fork-check.js` so a test can pin the pairing — ignored ⇒ not owned, owned ⇒ not ignored — which is the invariant that was violated and which nothing could reach before. Verified by reproducing the failure first, then re-running the gate with the settings file still on disk.

---

## 2026-08-04 — 1acf66ed..39103bd3 (3 commits)

Second run. One commit of real upstream content; the rest of the run was spent discovering that the _previous_ run's PR had broken `fork-check` for the whole repo on its way in.

- **PR:** #8
- **Predicted trouble (Phase 1):** none. The only new commit is a Crowdin sync — 57 files, all `packages/excalidraw/locales/`, zero non-locale files.
- **Conflicts:** none.
- **Overlay drift:** all three clean, hashes unchanged before and after. A locale-only commit cannot reach them.
- **Register changes:** no rows added or dropped. One prose fix: the paragraph under the file table said "twenty-six rows" against a table of 27, stale since `.gitignore` landed in #7's review fix. Replaced the number with a pointer to `yarn fork:check`.
- **Questions asked:** one, and it needed asking — Phase 0 hit a stop condition the skill had no branch for (below), and the remedy was a judgement call about what to do to `master`, not about what compiles.
- **Commands that failed:** `yarn fork:check` failed at Phase 0 on a clean, unmodified `master`, reporting the same 7 files as unregistered that entry #1 lists as upstream's own.
- **Surprises:** two, and the first is the most consequential thing this skill has learned so far.

  1. **PR #7 was squash-merged, and that broke `fork-check` repo-wide.** `ddbc3107` has a single parent, so `69d4c346` and `786ab266` never became ancestors of `master`. `git merge-base excalidraw/master master` stayed pinned at `1acf66ed`, and since `fork-check` bases its diff there, it reported upstream's own 7 changed files as unregistered fork modifications. From a stale merge-base those two things are genuinely indistinguishable.

     `git rev-list --left-right --count` said "behind 2" while the working tree was already byte-identical to upstream on every one of those files. The graph lied and the content did not.

     **Phase 0's instruction would have made this worse.** "`yarn fork:check` must pass before the merge… if it fails, report it and stop" is written for the case where `master` carries an unregistered fork change. Here the failure was an artifact of the previous merge's _method_, the repo was not broken in its content at all, and the remedy was precisely the merge that Phase 0 forbids. Following the skill literally would have reported a scary-looking register failure and left `fork-check` red on every developer's checkout indefinitely.

     The distinguishing test is cheap and now sits in Phase 0: `git diff --name-only excalidraw/master master`. If it lists only fork-owned and registered files, `master` already contains upstream's content and any "unregistered" report is a merge-base artifact, not drift.

  2. **`excalidraw/master` moved between Phase 0 and Phase 2.** Phase 0 recorded the tip as `786ab266`; the merge commit's second parent came out `39103bd3`. Nothing was wrong with the merge, but every number in the Phase 1 scoping — commit count, the file list, the claim "nothing new upstream" — was quietly about a different range than the one that actually merged, and it was only caught by noticing the merge diffstat had 57 files in it when the analysis had predicted approximately none.

     Phase 0/1 now pin `TIP=$(git rev-parse excalidraw/master)` and use the SHA everywhere, and Phase 3 re-derives the range from the merge commit's second parent rather than trusting the ref.

- **Phases unexercised:** 3 (conflict triage) again — nothing conflicted, so the playbook is _still_ unvalidated after two runs. Phase 4 again took only the happy path. Phase 8 again could not run: `gh run list` is still empty repo-wide, ten months of workflows and not one execution.
- **Changes made to the skill:**
  - Phase 0 gained the merge-base integrity check and the `git diff --name-only excalidraw/master master` diagnostic, with an explicit carve-out from the "stop if `fork:check` fails" rule. Evidence: the rule fired on a repo whose only defect was repairable by proceeding.
  - Phase 0/1 pin the upstream tip to a SHA; Phase 3 re-derives the merged range from the second parent. Evidence: the ref moved mid-run and invalidated the scoping silently.
  - Phase 7 now requires the PR body to open with the merge-method requirement, and the phase says plainly that a squash-merged sync PR reintroduces the defect. Evidence: this entire run. The old Phase 7 ended at "never merge the PR" and said nothing about _how_ the human should — which is the one instruction that would have prevented it.
  - The "facts that trip people up" table gains the merge-method row, next to the existing "never push straight to `master`" row. Both are about the same thing: the sync's guarantees live in the commit graph, and both squash and direct-push destroy them.
  - Generalised the count lesson from run 1: it applied to `SKILL.md` then and to `unobravo/FORK.md` now, so Phase 5 says register totals are read from `fork:check`, never written down.

---

## 2026-08-05 — 39103bd3..e4ab6267 (12 commits)

Third run, and the first with real upstream _content_ touching fork-modified files — bucket fill, a ViewportStatusFrame + user-follow-state refactor, several linear-element fixes. Two prior runs merged locale/color-picker churn that missed the register entirely; this one landed on seven registered files at once. It still merged clean, and CI ran for the first time in the fork's history.

- **PR:** #23
- **Predicted trouble (Phase 1):** seven registered files upstream touched — `excalidraw-app/App.tsx` (L1/2/4), `excalidraw-app/collab/Collab.tsx` (L4), and the five level-3 files `types.ts` / `index.tsx` / `components/App.tsx` / `LayerUI.tsx` / `HelpDialog.tsx`, plus the registered `contextmenu.test.tsx.snap`. Overlays predicted clean (none of `App{MainMenu,WelcomeScreen,Footer}.tsx` in the diff).
- **Conflicts:** **none.** `ort` auto-merged all 62 files, including all seven registered ones. Phase 3 went unexercised for the third straight run.
- **Overlay drift:** all three clean, hashes unchanged. A refactor this large touched none of the overlaid files.
- **Register changes:** none. No row added or dropped; nine new files (bucketFill engine + tests, ViewportStatusFrame, debugCollaborators, UserList/colorPicker tests) all upstream-owned. `fork:check` base advanced 39103bd3 → e4ab6267, still 33 registered.
- **Questions asked:** three, all up front, before the merge — (1) conflict autonomy: resolve per doctrine and escalate only on true product-intent doubt, vs stop-and-ask each file; (2) review-loop scope: only merge-caused defects in scope; (3) run Phase 9 or not. Only (1) was load-bearing, and only because the operator's brief ("drive to a finished PR") directly contradicts the skill's per-conflict stop-and-ask. It never bound in practice — zero conflicts — but it would have on a contentful merge that _did_ conflict, so it needed asking. (2) and (3) were effectively defaults.
- **Commands that failed:** two.
  1. `yarn test:all` failed at the vitest stage — **20 failures, every one inside `.claude/worktrees/pr-label-versioning/`**, a dead git-ignored worktree left over from merged PR #21 that vitest collects because `vitest.config.mts` sets no `exclude`. Re-running vitest with `--exclude '**/.claude/**'` gave 129 files / 1895 tests / 0 failures. The `&&`-chain reaching the vitest stage already proved fork:check + typecheck + test:code + test:other passed. CI's clean-checkout `coverage` job later confirmed the main tree green with no worktree in sight.
  2. The `lint` CI job went **red on the Phase 9 commit**, which touched only these two markdown files. `lint` runs `test:other` = `prettier --list-different` over `**/*.md`, so an unformatted RUNLOG/SKILL edit fails CI even though it is not code. Fixed with `yarn prettier --write` on both files and an amended commit. Lesson: now that CI runs, **prettier-format your Phase 9 markdown edits before committing** — `test:all` locally would have caught it too, but Phase 9 happens after the Phase 6 gate, so nothing re-runs prettier unless you do.
- **Surprises:** two, the first large.

  1. **GitHub Actions ran — for the first time ever on this fork.** Both prior runs and the standing project memory said `gh run list` is empty repo-wide (GitHub's fork gate). On PR #23 the jobs executed and **all passed**: `fork-check` (14s), `lint`, `size`, `coverage` (4m40s), `semantic`, `label-scope`, `Check Bump Label`. Someone enabled Actions in the repo's Actions tab between 2026-08-04 and 2026-08-05. This inverts the skill's central operating assumption: CI is now a real gate, `fork-check` finally runs in CI as `CLAUDE.md` always claimed, and a Phase-0 `gh run list` is no longer expected empty. The first no-checkout review agent, running on the stale memory, filed a P3 "CI did not execute" that was already false — and so did the PR body's first draft, which had to be corrected.

  2. **A clean merge on seven gated files still demanded the full Phase 4 / grep verification, and that was the whole job.** With no conflicts, the entire risk was the silent-gate-drop mode: `ort` resolving a moved gate line in upstream's favour. Verified explicitly — all `// UNOBRAVO:` markers present (Collab relay-auth line 538 intact), all level-3 prop consumers present with no new ungated surface (`rg 'libraryEnabled|externalLinksEnabled'` clean), the `contextmenu.test.tsx.snap` `predicate` field surviving (104 occurrences) while upstream's `followedBy`/`userToFollow` appState fields dropped. Two independent zero-context Opus reviews then confirmed zero P0/P1/P2. The lesson the skill already states ("Phase 4 even when the merge had zero conflicts") held up under its first real test — a large refactor is exactly where a call site gets dropped, and `clampOpenSidebar`'s survived at both definition and call site.

- **Phases unexercised:** 3 (conflict triage) — still unexercised after three runs; the playbook remains reasoning, not experience, even though this was the first merge with the surface area to exercise it. It resolved clean anyway.
- **Changes made to the skill:**
  - The "GitHub Actions may not run here at all" callout and Phases 0/8 are rewritten from "never runs, treat green as meaningless" to "was fork-gated through 2026-08-04, went live on PR #23; check `gh run list` and read real jobs as evidence when they ran." Evidence: this run's fully-green CI. Kept the _check_ (a fork can be re-gated) but flipped the default expectation.
  - Phase 6 gains an explicit worktree warning: vitest collects `.claude/worktrees/*`, so run the suite with `--exclude '**/.claude/**'` (or remove the dead worktree) or the main-tree signal is buried under phantom failures against old code. Evidence: cost real time here and in the PR #22 session before it — twice now.
