import createMiddleware from "next-intl/middleware";
import { locales, defaultLocale } from "@/i18n";

// next-intl needs middleware to bind the [locale] path segment to the request.
// Without it getRequestConfig receives an undefined requestLocale and falls
// back to defaultLocale, so every server-rendered English route came out in
// Indonesian while client components had the correct messages.
//
// localePrefix "always" keeps the existing /id/... and /en/... URL shape; the
// app links to locale-prefixed paths everywhere, so anything else would break
// them.
export default createMiddleware({
  locales,
  defaultLocale,
  localePrefix: "always",
});

export const config = {
  // Skip API routes, the /healthz probe, Next internals, and anything with a
  // file extension (static assets). /healthz must be excluded explicitly: it
  // is a rewrite to the Go backend, and locale-prefixing it turns the probe
  // into a 307 to /id/healthz, which breaks liveness checks.
  matcher: ["/((?!api|healthz|_next|_vercel|.*\\..*).*)"],
};
