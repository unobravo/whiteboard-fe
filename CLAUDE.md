# CLAUDE.md

## This is a fork

`unobravo/whiteboard-fe` is a fork of `excalidraw/excalidraw`, kept in sync by merging upstream periodically. Everything outside `unobravo/` and `excalidraw-app/components/unobravo/` is someone else's code that keeps moving.

So the cost of a change is not how long it takes to write — it is what it does to the next merge. Before editing an upstream file, look for a way not to. In order of preference:

1. A public `<Excalidraw>` prop, or an existing option. Costs nothing.
2. An overlay component in `excalidraw-app/components/unobravo/`, swapped in by changing one import. Costs one line.
3. A new prop shaped the way upstream would have written it, so it can be sent upstream as a PR and the fork shrinks. `aiEnabled` is the model to copy.
4. An inline gate, marked `// UNOBRAVO:` and kept to a single line. Last resort.

Two rules that follow from that:

- **Every upstream file you touch goes in `unobravo/FORK.md`**, with what changed and why. `yarn fork:check` fails otherwise, and it runs in CI.
- **Keep comments short in upstream files.** A six-line rationale next to their code turns any nearby upstream edit into a conflict. Put the reasoning in `unobravo/FORK.md`, leave a one-line pointer.

Read `unobravo/FORK.md` before changing anything under `packages/` or `excalidraw-app/`.

## Project Structure

Excalidraw is a **monorepo** with a clear separation between the core library and the application:

- **`packages/excalidraw/`** - Main React component library published to npm as `@excalidraw/excalidraw`
- **`excalidraw-app/`** - Full-featured web application (excalidraw.com) that uses the library
- **`packages/`** - Core packages: `@excalidraw/common`, `@excalidraw/element`, `@excalidraw/math`, `@excalidraw/utils`
- **`examples/`** - Integration examples (NextJS, browser script)

## Development Workflow

1. **Package Development**: Work in `packages/*` for editor features
2. **App Development**: Work in `excalidraw-app/` for app-specific features
3. **Testing**: Always run `yarn test:update` before committing
4. **Type Safety**: Use `yarn test:typecheck` to verify TypeScript

## Development Commands

```bash
yarn test:typecheck  # TypeScript type checking
yarn test:update     # Run all tests (with snapshot updates)
yarn fix             # Auto-fix formatting and linting issues
```

## Architecture Notes

### Package System

- Uses Yarn workspaces for monorepo management
- Internal packages use path aliases (see `vitest.config.mts`)
- Build system uses esbuild for packages, Vite for the app
- TypeScript throughout with strict configuration
