import type { Metadata } from "next";
import { LibraryProvider } from "@/lib/store";

export const metadata: Metadata = { title: "OpenStudy" };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <LibraryProvider>{children}</LibraryProvider>;
}
