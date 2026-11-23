import { copyFile, mkdir, rm } from "node:fs/promises";
import { build } from "esbuild";

const rootFiles = [
  "manifest.json",
  "popup.html",
  "styles.css",
  "idencified.svg",
  "THIRD_PARTY_NOTICES.md",
];

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

await build({
  entryPoints: ["main.ts"],
  outfile: "dist/popup.js",
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["firefox140"],
  minify: false,
  sourcemap: false,
  treeShaking: true,
  legalComments: "none",
  logLevel: "info",
});

for (const file of rootFiles) {
  await copyFile(file, `dist/${file}`);
}

console.log("IDENCIFIED built to dist/.");
