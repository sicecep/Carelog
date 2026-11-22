import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { locales, type Locale } from "@/i18n";
import { Toaster } from "@/components/ui/Toaster";
import { bodyClassName, htmlClassName } from "../fonts";

interface LocaleLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function LocaleLayout({
  children,
  params,
}: LocaleLayoutProps) {
  const { locale } = await params;

  if (!locales.includes(locale as Locale)) notFound();

  // Bind the [locale] segment to this request BEFORE anything renders.
  // Without it getRequestConfig sees an undefined requestLocale and falls back
  // to defaultLocale ("id"), so every server component rendered English routes
  // in Indonesian while the client provider below had the right messages.
  // This project has no middleware.ts, which is the other way to supply it.
  setRequestLocale(locale as Locale);

  const messages = await getMessages({ locale: locale as Locale });

  // This layout owns <html> so `lang` follows the route locale; screen readers
  // pick pronunciation from it (DESIGN.md §11).
  return (
    <html lang={locale} className={htmlClassName}>
      <body className={bodyClassName}>
        <NextIntlClientProvider messages={messages}>
          {children}
          <Toaster />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}