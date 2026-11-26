"use client";

import { useAppTheme } from "@/lib/theme";

/** Applies the saved light or dark choice on app pages (spec 17.2). */
export function AppTheme() {
  useAppTheme();
  return null;
}
