"use client";

// Sends library events to the server (spec 12.3): categories and counts only, after a cursor,
// debounced, and never when the person turned "Share usage data" off.
import { pendingEvents } from "@/engine/events";
import type { LibEvent } from "@/engine/types";

const INSTALL_KEY = "openstudy.installId";
const CURSOR_KEY = "openstudy.eventsCursor";
const SHARE_KEY = "openstudy.shareUsage";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: events are sent again next time, the server keeps them anyway */
  }
}

export function installId(): string {
  let id = read(INSTALL_KEY);
  if (!id) {
    id = crypto.randomUUID();
    write(INSTALL_KEY, id);
  }
  return id;
}

export const sharingUsage = (): boolean => read(SHARE_KEY) !== "off";

/** Turning sharing back on starts from now, so events from while it was off stay on this device. */
export function setSharingUsage(on: boolean) {
  write(SHARE_KEY, on ? "on" : "off");
  if (on) write(CURSOR_KEY, new Date().toISOString());
}

let sending = false;

export async function sendEvents(events: LibEvent[], keepalive = false): Promise<void> {
  if (sending || !sharingUsage()) return;
  const batch = pendingEvents(events, read(CURSOR_KEY));
  if (!batch.length) return;
  sending = true;
  try {
    const { accessToken } = await import("./auth");
    const token = await accessToken().catch(() => null);
    const r = await fetch("/api/events", {
      method: "POST",
      keepalive,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ installId: installId(), platform: "web", appVersion: "web", events: batch }),
    });
    if (r.ok) write(CURSOR_KEY, batch[batch.length - 1].t);
  } catch {
    /* offline: the cursor stays, so these go next time */
  } finally {
    sending = false;
  }
}
