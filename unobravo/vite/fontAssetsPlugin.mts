import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { PluginOption, ResolvedConfig } from "vite";

/**
 * Fills the gaps in the woff2 files Rollup emits, so a self-hosted build can
 * serve every face from its own origin.
 *
 * Upstream points `EXCALIDRAW_ASSET_PATH` and the `@font-face` sources at its
 * own CDN, which is an unconditional third-party request on every page load —
 * see the note in `scripts/woff2/woff2-vite-plugins.js`. Dropping the CDN
 * without replacing it would be worse, not better: the editor's last-resort
 * fallback is `https://esm.sh/@excalidraw/excalidraw/dist/prod/`, a different
 * third party.
 *
 * Most families need nothing from this plugin. `packages/excalidraw/fonts/Fonts.ts`
 * statically imports every family — Xiaolai's 209 CJK files included — so Rollup
 * already emits them, and `assetFileNames` in `excalidraw-app/vite.config.mts`
 * places them under `fonts/<prefix>/`.
 *
 * Assistant is the exception, and the reason this exists. It is referenced only
 * from `fonts.css`, which `woff2BrowserPlugin` rewrites to absolute
 * `/fonts/Assistant/…` URLs — absolute, so Rollup leaves them alone and emits
 * nothing. Its `url(./Assistant-Regular.woff2)` fallback does not resolve
 * either: those files live in `Assistant/`, not beside the stylesheet. Without
 * this plugin the UI font 404s and one of the four preloads points at nothing.
 * Verified by building with the plugin disabled.
 *
 * The destination mirrors `assetFileNames` — the directory comes from the
 * filename prefix, not from the source directory — so a family Rollup already
 * emitted is overwritten in place rather than duplicated into a second,
 * unreferenced directory. `Cascadia/CascadiaCode-Regular.woff2` belongs in
 * `fonts/CascadiaCode/`, which is where the bundle's URLs point.
 */
// resolved against this file, not against `config.root` — Vite's root defaults
// to `process.cwd()`, so keying off it would break the moment someone runs the
// build from the repo root with `--config`
const SOURCE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../packages/excalidraw/fonts",
);

/**
 * The faces `index.html` preloads. If one of these is missing from the build,
 * the page issues a `<link rel="preload">` for a 404 and the editor falls
 * through to esm.sh — so the build should fail rather than ship.
 */
const PRELOADED = [
  "fonts/Excalifont/Excalifont-Regular-a88b72a24fb54c9f94e3b5fdaa7481c9.woff2",
  "fonts/Nunito/Nunito-Regular-XRXI3I6Li01BKofiOc5wtlZ2di8HDIkhdTQ3j6zbXWjgeg.woff2",
  "fonts/Assistant/Assistant-SemiBold.woff2",
  "fonts/ComicShanns/ComicShanns-Regular-279a7b317d12eb88de06167bd672b4b4.woff2",
];

/** Mirrors `assetFileNames` in `excalidraw-app/vite.config.mts`. */
const familyDirFor = (fileName: string) => fileName.split("-")[0];

export const fontAssetsPlugin = (): PluginOption => {
  let outDir: string;

  return {
    name: "unobravo:font-assets",
    // `apply` filters the plugin out entirely for `serve`, so the hook below
    // only ever runs for a real build
    apply: "build",
    configResolved(config: ResolvedConfig) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    writeBundle() {
      if (!fs.existsSync(SOURCE_DIR)) {
        throw new Error(
          `unobravo:font-assets — no font source directory at ${SOURCE_DIR}`,
        );
      }

      for (const family of fs.readdirSync(SOURCE_DIR)) {
        const familyDir = path.join(SOURCE_DIR, family);

        if (!fs.statSync(familyDir).isDirectory()) {
          continue;
        }

        for (const file of fs.readdirSync(familyDir)) {
          if (!file.endsWith(".woff2")) {
            continue;
          }

          const target = path.join(outDir, "fonts", familyDirFor(file));

          fs.mkdirSync(target, { recursive: true });
          fs.copyFileSync(path.join(familyDir, file), path.join(target, file));
        }
      }

      // assert the output, not the input: a source tree that exists proves
      // nothing about what actually landed in the build
      const missing = PRELOADED.filter(
        (file) => !fs.existsSync(path.join(outDir, file)),
      );

      if (missing.length) {
        throw new Error(
          `unobravo:font-assets — the build preloads fonts it does not ship:\n${missing
            .map((file) => `  ${file}`)
            .join("\n")}`,
        );
      }
    },
  };
};
