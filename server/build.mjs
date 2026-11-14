import { build } from "esbuild";
import { rmSync } from "node:fs";

// Bundles src/ into one file Node can run. tsc only type-checks (noEmit).
// The output directory is cleared first so a renamed file cannot linger (BB-017).
rmSync("dist", { recursive: true, force: true });

build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: "dist/index.js",
  packages: "external",
  sourcemap: true,
})
  .then(() => console.log("server build ok"))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
