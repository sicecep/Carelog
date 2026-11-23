import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CareLog",
  description: "Care logging for families and caregivers",
  // iOS ignores the manifest for these: "Add to Home Screen" reads the
  // apple-touch-icon and opens full-screen only with appleWebApp set.
  icons: { apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "CareLog", statusBarStyle: "default" },
};

// The phone's status/address bar takes the page colour so the app bar and
// the system bar read as one surface (DESIGN.md §2.1 / §2.5 surface tokens).
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFFFFF" },
    { media: "(prefers-color-scheme: dark)", color: "#1F2522" },
  ],
};

// <html> and <body> are rendered by app/[locale]/layout.tsx so the document
// language follows the route locale (DESIGN.md §11: lang="id" / lang="en").
// This pass-through layout only exists because app/page.tsx and
// app/not-found.tsx live outside [locale]; not-found renders its own <html>.
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
