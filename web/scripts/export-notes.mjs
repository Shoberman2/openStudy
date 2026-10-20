// Exports every Apple Note on this Mac to apple-notes.json (shared/SPEC.md 9.2).
// Open that file in OpenStudy (web: Import > Files, iPhone: Import files) to sort it into projects.
// Usage: node scripts/export-notes.mjs [output path]
import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") {
  console.error("Apple Notes can only be read on a Mac.");
  process.exit(1);
}
const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.argv[2] ?? "apple-notes.json");
console.log("Reading Apple Notes. macOS may ask once to let your terminal control Notes.");
execFile("osascript", ["-l", "JavaScript", resolve(here, "apple-notes.jxa")], { maxBuffer: 512 * 1024 * 1024, timeout: 5 * 60 * 1000 }, (err, stdout, stderr) => {
  if (err) {
    console.error(err.killed ? "Timed out. If macOS asked to let your terminal control Notes, allow it and run this again." : stderr.trim() || err.message);
    if (/-1743|not allowed/i.test(stderr)) console.error("Allow it in System Settings > Privacy & Security > Automation, then run this again.");
    process.exit(1);
  }
  const data = JSON.parse(stdout);
  writeFileSync(out, JSON.stringify(data));
  const folders = new Set(data.notes.map((n) => n.folder)).size;
  console.log(`Saved ${data.notes.length} notes from ${folders} folders to ${out}`);
});
