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
