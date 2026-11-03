import "server-only";
import { aiEnabled, structuredCall } from "./claude";
import type { Ai } from "@/engine/tutor/service";

/** The model when a key is configured, else null, which puts the tutor in Demo mode (spec 15.5). */
export function tutorAi(): Ai | null {
  return aiEnabled() ? { call: structuredCall } : null;
}
