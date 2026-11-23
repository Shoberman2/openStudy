import type { Metadata } from "next";
import { LibraryProvider } from "@/lib/store";
import { AppTheme } from "@/components/app/AppTheme";

export const metadata: Metadata = { title: "OpenStudy" };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <LibraryProvider>
      <AppTheme />
      {children}
    </LibraryProvider>
  );
}
