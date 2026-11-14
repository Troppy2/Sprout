import { build } from "esbuild";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";

// Bundles the service worker and the popup into dist/ and copies the static
// files next to them. Load extension/dist as the unpacked extension.
// The output directory is cleared first so removed files cannot linger (BB-017).
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist/popup", { recursive: true });
mkdirSync("dist/approve", { recursive: true });

const common = {
  bundle: true,
  platform: "browser",
  target: "chrome120",
  format: "esm",
  sourcemap: true,
};

async function main() {
  await build({ ...common, entryPoints: ["src/background.ts"], outdir: "dist" });
  await build({ ...common, entryPoints: ["src/popup/popup.ts"], outfile: "dist/popup/popup.js" });

  // The approve window (MVP 1 grants and submit confirms). It reuses popup/tokens.css.
  await build({ ...common, entryPoints: ["src/approve/approve.ts"], outfile: "dist/approve/approve.js" });

  copyFileSync("manifest.json", "dist/manifest.json");
  // App icons (concept A seedling, source: icons/sprout.svg).
  mkdirSync("dist/icons", { recursive: true });
  for (const px of [16, 32, 48, 128]) copyFileSync(`icons/icon-${px}.png`, `dist/icons/icon-${px}.png`);
  copyFileSync("src/approve/approve.html", "dist/approve/approve.html");
  copyFileSync("src/approve/approve.css", "dist/approve/approve.css");
  copyFileSync("src/popup/popup.html", "dist/popup/popup.html");
  copyFileSync("src/popup/popup.css", "dist/popup/popup.css");
  copyFileSync("styles/tokens.css", "dist/popup/tokens.css");

  console.log("extension build ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
