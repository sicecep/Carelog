"use client";

import { useTranslations } from "next-intl";
import {
  ForkKnife,
  Moon,
  Baby,
  Pill,
  Smiley,
  Heart,
  NotePencil,
  PersonSimpleRun,
  BookOpen,
  FirstAid,
} from "phosphor-react";
import { type LogCategory, type Module } from "@/lib/constants.generated";

// Icon + i18n key for each LOG-002.1 category button, in PRD order: Meals,
// Vitamins/Meds, Activities, Sleep, Diaper, Mood, Health, then Learning,
// Therapy and Notes. Every module has a button; the recipient's enabled
// modules decide which ones show.
const CATEGORIES = [
  { id: "meal", icon: ForkKnife },
  { id: "medication", icon: Pill },
  { id: "activity", icon: PersonSimpleRun },
  { id: "sleep", icon: Moon },
  { id: "diaper", icon: Baby },
  { id: "mood", icon: Smiley },
  { id: "health", icon: Heart },
  { id: "learning", icon: BookOpen },
  { id: "therapy", icon: FirstAid },
  { id: "note", icon: NotePencil },
] as const satisfies ReadonlyArray<{ id: Module & LogCategory; icon: typeof ForkKnife }>;

interface CategoryGridProps {
  onSelect: (category: LogCategory) => void;
  /** The recipient's enabled modules: only these categories are offered. */
  modules: readonly Module[];
}

export function CategoryGrid({ onSelect, modules }: CategoryGridProps) {
  const t = useTranslations("reports.categories");
  // A recipient saved before modules existed has none; offer everything
  // rather than an empty sheet.
  const visible =
    modules.length === 0 ? CATEGORIES : CATEGORIES.filter(({ id }) => modules.includes(id));

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4" role="group">
      {visible.map(({ id, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onSelect(id)}
          className="chip chip-sm touch-target flex flex-col items-center justify-center gap-2 p-4 transition-all"
        >
          <Icon size={24} className="text-[var(--color-accent)]" aria-hidden="true" />
          <span className="text-sm font-medium text-[var(--color-text)]">{t(id)}</span>
        </button>
      ))}
    </div>
  );
}
