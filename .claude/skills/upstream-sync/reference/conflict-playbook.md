# Conflict playbook

What to do when a specific class of file conflicts during an upstream sync. Grown from real runs — if you resolve something not covered here, add it.

The rule underneath all of it: **the fork's job is to remove surfaces, not to fight upstream.** When upstream changes how something works, take upstream's version and re-apply the gate on top. When upstream changes _whether_ a gated surface exists, the gate may no longer be needed at all — which is the good outcome, and belongs in the PR body.

## Regenerated, never hand-merged

| Path | Why | How |
| --- | --- | --- |
| `yarn.lock` | a hand-merged lockfile is a lockfile nobody can reproduce | `git checkout --theirs yarn.lock && yarn install` |
| `packages/**/__snapshots__/*.snap` | the snapshot is output, not source | `git checkout --theirs <file> && yarn test:update`, then **read the diff** — a snapshot change that re-adds a gated menu entry is a dropped gate, not a formatting change |

`packages/excalidraw/tests/__snapshots__/contextmenu.test.tsx.snap` is registered in FORK.md precisely because the fork's gates change it. After regenerating, confirm the fork's expected omissions are still omitted.

## By fork mechanism

Look the file up in the `fork-check:files` table first; the Level column tells you what is at stake.

### Level 1 — a public `<Excalidraw>` prop

Only `excalidraw-app/App.tsx` passes these. A conflict here is upstream restructuring the props object. Take upstream's structure, re-add the fork's props (`aiEnabled`, `libraryEnabled`, `externalLinksEnabled`). Zero judgement needed unless upstream renamed the prop.

### Level 2 — overlays

Conflicts are rare (the overlays live in an owned directory). What is _not_ rare is drift with no conflict — see Phase 4 of `SKILL.md`. If `excalidraw-app/App.tsx` conflicts on the overlay import lines, upstream moved or renamed the component being overlaid: check whether `excalidraw-app/components/App{MainMenu,WelcomeScreen,Footer}.tsx` still exist under those names.

### Level 3 — upstream-shaped props

`libraryEnabled` and `externalLinksEnabled` are threaded through 11 upstream files (`types.ts`, `index.tsx`, `App.tsx`, `LayerUI.tsx`, `DefaultSidebar.tsx`, `HelpDialog.tsx`, `CommandPalette.tsx`, `BraveMeasureTextError.tsx`, `actionAddToLibrary.ts`, `data/library.ts`).

A conflict is almost always upstream editing the same prop list or the same JSX block. Take upstream's version wholesale, then re-thread the prop. **Then grep for the prop across the whole tree** — if upstream added a new consumer of the surface the prop gates, the gate now has a hole:

```bash
rg 'libraryEnabled|externalLinksEnabled' packages/ excalidraw-app/
```

Known gap worth re-checking on every sync: `ActionManager.handleKeyDown` filters on `UIOptions.canvasActions` and `keyTest` only, never on `predicate`. If upstream gives `actionAddToLibrary` a keybinding, the `libraryEnabled` gate is bypassed by keypress **with no test failure**. FORK.md documents this; a sync is when it would land.

### Level 4 — inline `// UNOBRAVO:` gates

`excalidraw-app/components/TopErrorBoundary.tsx`, `excalidraw-app/sentry.ts`, `excalidraw-app/data/LocalData.ts`, plus parts of `excalidraw-app/App.tsx`.

The fragile ones. Upstream moving the guarded line resolves cleanly in upstream's favour and the gate is gone. After **any** merge that touches these files, whether or not it conflicted:

```bash
rg -n 'UNOBRAVO' excalidraw-app/ packages/
```

Count the markers against what FORK.md describes. A missing marker is a dropped gate.

Keep the comment to one line when re-applying. A multi-line rationale next to upstream code turns the next nearby upstream edit into a conflict — that is why the reasoning lives in FORK.md.

## Config and infra files

| File | Note |
| --- | --- |
| `.env.production` | endpoints deliberately still point at Excalidraw, with `TODO(unobravo)` markers. Upstream adding a variable is fine; take it and check whether it is a new egress point |
| `package.json`, `excalidraw-app/package.json` | take upstream's dependency changes; preserve the fork's `fork:check` and `test:all` scripts |
| `.github/workflows/lint.yml` | the `fork-check` job is the fork's. Take upstream's changes to the other jobs, keep that job intact |
| `excalidraw-app/index.html` | the fork removed the Excalidraw+ auto-redirect, Simple Analytics, `rel="canonical"`, absolute `og:url`/`twitter:url`, and unused Google Fonts preconnects. If upstream re-adds any of them, drop it again and note it |
| `excalidraw-app/vite.config.mts` | carries `unobravo/vite/fontAssetsPlugin`. Keep the plugin registration |
| `public/robots.txt`, `tsconfig.json`, `scripts/woff2/woff2-vite-plugins.js` | mechanical; take upstream unless it undoes a documented fork intent |

## When upstream deletes a file the fork registered

Not a conflict — a `stale` row plus a broken import. Decide what the gate was protecting and where it moved. This always needs the user: the gate's _purpose_ survives even when its location does not.

## When upstream makes a fork change unnecessary

Best case. Upstream adds a prop, option, or config that does what a level-3 or level-4 gate was doing by hand. Drop the fork's version, drop the FORK.md row, and say so in the PR body — this is the fork shrinking, which is the goal `CLAUDE.md` states outright.
