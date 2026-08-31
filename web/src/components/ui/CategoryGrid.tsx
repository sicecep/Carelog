"use client";

import { useTranslations } from "next-intl";
import { ForkKnife, Moon, Baby, Pill, Smiley, Heart, NotePencil } from "phosphor-react";
import { type LogCategory } from "@/lib/constants.generated";

// Icon + i18n key for each LOG-002.1 category button. Order matches the PRD
// list: Meals, Vitamins/Meds, Activities, Sleep, Diaper, Mood, Health, Notes
// (Activities intentionally omitted until its subcategory set is modeled).
const CATEGORIES = [
  { id: "meal", icon: ForkKnife },
  { id: "medication", icon: Pill },
  { id: "sleep", icon: Moon },
  { id: "diaper", icon: Baby },
  { id: "mood", icon: Smiley },
  { id: "health", icon: Heart },
  { id: "note", icon: NotePencil },
] as const satisfies ReadonlyArray<{ id: LogCategory; icon: typeof ForkKnife }>;

interface CategoryGridProps {
  onSelect: (category: LogCategory) => void;
}

export function CategoryGrid({ onSelect }: CategoryGridProps) {
  const t = useTranslations("reports.categories");

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4" role="group">
      {CATEGORIES.map(({ id, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onSelect(id)}
          className="chip touch-target flex min-h-[56px] flex-col items-center justify-center gap-2 p-4 transition-all hover:border-[var(--color-accent)]"
        >
          <Icon size={24} className="text-[var(--color-accent)]" aria-hidden="true" />
          <span className="text-sm font-medium text-[var(--color-text)]">{t(id)}</span>
        </button>
      ))}
    </div>
  );
}
