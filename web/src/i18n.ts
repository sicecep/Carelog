import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";

export const locales = ["id", "en"] as const;
export const defaultLocale = "id" as const;
export type Locale = (typeof locales)[number];

export default getRequestConfig(async ({ requestLocale }) => {
  // In next-intl v4 the `[locale]` segment arrives via `requestLocale`
  // (the `locale` param is only set when passed explicitly).
  const requested = await requestLocale;
  const locale = hasLocale(locales, requested) ? requested : defaultLocale;

  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
  };
});
