// Copies build-time assets into the web app:
// - the shared demo library (source of truth: ../shared)
// - the pdf.js worker, served from /pdf.worker.min.mjs
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const copies = [
  ["../../shared/sample-library.json", "../src/data/sample-library.json"],
  ["../node_modules/pdfjs-dist/build/pdf.worker.min.mjs", "../public/pdf.worker.min.mjs"],
];
for (const [from, to] of copies) {
  const dest = resolve(here, to);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(resolve(here, from), dest);
}
console.log("copied sample library and pdf worker");
