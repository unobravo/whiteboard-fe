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
