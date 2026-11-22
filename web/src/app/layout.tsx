import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CareLog",
  description: "Care logging for families and caregivers",
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
