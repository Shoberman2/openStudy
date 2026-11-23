import type { Metadata, Viewport } from "next";
import { Caveat, Newsreader, Nunito } from "next/font/google";
import "./globals.css";

const nunito = Nunito({ variable: "--font-nunito", subsets: ["latin"], weight: ["400", "600", "700", "800", "900"] });
const newsreader = Newsreader({ variable: "--font-newsreader", subsets: ["latin"], style: ["normal", "italic"] });
// Only used to render the whiteboard photo on the landing page.
const caveat = Caveat({ variable: "--font-hand", subsets: ["latin"], weight: ["600", "700"] });

export const metadata: Metadata = {
  title: "OpenStudy: anything you want to learn, turned into lessons",
  description:
    "Drop in book screenshots, class slides, PDFs, or a photo of the whiteboard. OpenStudy sorts it, builds the lessons, and plans your study days until it sticks.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
};

// Applies a dark mode the person chose in Settings, before paint, on app pages only. The landing
// page and legal pages always stay light. Key shared with web/src/lib/theme.ts.
const THEME_SCRIPT = `try{if(location.pathname.startsWith("/app")&&localStorage.getItem("openstudy.theme")==="dark")document.documentElement.dataset.theme="dark"}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${nunito.variable} ${newsreader.variable} ${caveat.variable} antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
