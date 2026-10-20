import "server-only";
import { execFile } from "node:child_process";
import { join } from "node:path";

/**
 * Apple Notes can be read only by the web app running locally on a Mac (spec 9.2), and only when
 * started with `npm run dev:notes`, which opts in and binds to 127.0.0.1. The Host check stops DNS
 * rebinding; the loopback bind stops other machines on the network (they could fake the Host header).
 */
export function localNotesEnabled(host: string | null): boolean {
  if (process.platform !== "darwin" || process.env.OPENSTUDY_LOCAL_NOTES !== "1") return false;
  const name = (host ?? "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  return name === "localhost" || name === "127.0.0.1" || name === "::1";
}

export class NotesPermissionError extends Error {}

/** Runs scripts/apple-notes.jxa and returns its NotesExport JSON text. */
export function readAppleNotes(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "osascript",
      ["-l", "JavaScript", join(process.cwd(), "scripts", "apple-notes.jxa")],
      { maxBuffer: 512 * 1024 * 1024, timeout: 5 * 60 * 1000 },
      (err, stdout, stderr) => {
        if (!err) return resolve(stdout);
        if (err.killed || /-1743|not allowed/i.test(stderr)) reject(new NotesPermissionError(stderr || "timed out"));
        else reject(new Error(stderr || err.message));
      },
    );
  });
}
