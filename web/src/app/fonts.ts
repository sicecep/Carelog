import { Geist, Geist_Mono } from "next/font/google";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Classes shared by every document shell that renders <html>: the [locale]
// root layout and the top-level not-found page.
export const htmlClassName = `${geistSans.variable} ${geistMono.variable} h-full antialiased`;
export const bodyClassName = "min-h-full flex flex-col";
