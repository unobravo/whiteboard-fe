import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { PluginOption, ResolvedConfig } from "vite";

/**
 * Copies the woff2 families into `<outDir>/fonts/<Family>/…` so a self-hosted
 * build can serve them from its own origin.
 *
 * Upstream has no equivalent: it points `EXCALIDRAW_ASSET_PATH` and the
 * `@font-face` sources at its own CDN, which is an unconditional third-party
 * request on every page load — see the note in
 * `scripts/woff2/woff2-vite-plugins.js`. Dropping the CDN without this plugin
 * would be worse, not better: `ExcalidrawFontFace.ASSETS_FALLBACK_URL` is
 * `https://esm.sh/@excalidraw/excalidraw/dist/prod/`, a different third party.
 *
 * Rollup already emits the statically-imported faces under `fonts/<Family>/`
 * (see `assetFileNames` in `excalidraw-app/vite.config.mts`), but the families
 * loaded on demand — Xiaolai and the other CJK ranges — are resolved at runtime
 * from `EXCALIDRAW_ASSET_PATH` and never enter the bundle graph. This copies the
 * whole tree so both kinds resolve.
 */
// resolved against this file, not against `config.root` — Vite's root defaults
// to `process.cwd()`, so keying off it would break the moment someone runs the
// build from the repo root with `--config`
const SOURCE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../packages/excalidraw/fonts",
);

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
      const sourceDir = SOURCE_DIR;

      if (!fs.existsSync(sourceDir)) {
        // loud on purpose: shipping without the font tree silently falls back
        // to esm.sh, which is the thing this plugin exists to prevent
        throw new Error(
          `unobravo:font-assets — no font source directory at ${sourceDir}`,
        );
      }

      let copied = 0;

      for (const family of fs.readdirSync(sourceDir)) {
        const familyDir = path.join(sourceDir, family);

        if (!fs.statSync(familyDir).isDirectory()) {
          continue;
        }

        for (const file of fs.readdirSync(familyDir)) {
          if (!file.endsWith(".woff2")) {
            continue;
          }

          fs.mkdirSync(path.join(outDir, "fonts", family), {
            recursive: true,
          });
          fs.copyFileSync(
            path.join(familyDir, file),
            path.join(outDir, "fonts", family, file),
          );
          copied++;
        }
      }

      if (!copied) {
        throw new Error(
          `unobravo:font-assets — found no .woff2 files under ${sourceDir}`,
        );
      }
    },
  };
};
