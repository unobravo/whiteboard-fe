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
