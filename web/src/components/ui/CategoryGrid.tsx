"use client";

import { useTranslations } from "next-intl";
import { type LogCategory, type Module } from "@/lib/constants.generated";
import { CATEGORY_ORDER, CategoryIcon } from "@/components/ui/CategoryIcon";

interface CategoryGridProps {
  onSelect: (category: LogCategory) => void;
  /** The recipient's enabled modules: only these categories are offered. */
  modules: readonly Module[];
}

// One button per LOG-002.1 category, in PRD order. Every module has a button;
// the recipient's enabled modules decide which ones show.
export function CategoryGrid({ onSelect, modules }: CategoryGridProps) {
  const t = useTranslations("reports.categories");
  // A recipient saved before modules existed has none; offer everything
  // rather than an empty sheet.
  const visible =
    modules.length === 0 ? CATEGORY_ORDER : CATEGORY_ORDER.filter((id) => modules.includes(id));

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4" role="group">
      {visible.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => onSelect(id)}
          className="chip chip-sm touch-target flex flex-col items-center justify-center gap-2 p-4 transition-all"
        >
          <CategoryIcon category={id} size="lg" />
          <span className="text-base font-medium text-[var(--color-text)]">{t(id)}</span>
        </button>
      ))}
    </div>
  );
}
