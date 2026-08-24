import createMiddleware from "next-intl/middleware";
import { locales, defaultLocale } from "./src/i18n";

export default createMiddleware({
  locales,
  defaultLocale,
  localePrefix: "always", // always prefix with locale (e.g. /id/dashboard)
});

export const config = {
  // Match all pathnames except for:
  // - API routes (handled by Go backend)
  // - _next folder (static files, image optimization)
  // - files with extensions (favicon.ico, sitemap.xml, robots.txt, etc.)
  matcher: [
    "/((?!api|_next|_vercel|.*\\..*).*)",
    // Ensure /_next/data is also matched for i18n routing
    "/_next/data/:path*",
  ],
};