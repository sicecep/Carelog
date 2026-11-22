import { defaultLocale } from "@/i18n";
import { bodyClassName, htmlClassName } from "./fonts";

// Unmatched URLs render outside the [locale] layout, so this page supplies
// its own document shell in the default locale.
export default function NotFound() {
  return (
    <html lang={defaultLocale} className={htmlClassName}>
      <body className={bodyClassName}>
        <main className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <h1 className="text-2xl font-semibold">404</h1>
          <p>Halaman tidak ditemukan.</p>
        </main>
      </body>
    </html>
  );
}
