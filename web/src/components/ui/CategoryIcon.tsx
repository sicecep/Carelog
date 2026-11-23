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

type CategoryId = Module & LogCategory;

// One icon and one colour per category, used everywhere a category appears
// (DESIGN.md §9). Class strings are literal so Tailwind can see them.
const CATEGORY_STYLES = {
  meal: { icon: ForkKnife, tone: "bg-[var(--color-cat-meal-soft)] text-[var(--color-cat-meal-ink)]" },
  medication: { icon: Pill, tone: "bg-[var(--color-cat-medication-soft)] text-[var(--color-cat-medication-ink)]" },
  activity: { icon: PersonSimpleRun, tone: "bg-[var(--color-cat-activity-soft)] text-[var(--color-cat-activity-ink)]" },
  sleep: { icon: Moon, tone: "bg-[var(--color-cat-sleep-soft)] text-[var(--color-cat-sleep-ink)]" },
  diaper: { icon: Baby, tone: "bg-[var(--color-cat-diaper-soft)] text-[var(--color-cat-diaper-ink)]" },
  mood: { icon: Smiley, tone: "bg-[var(--color-cat-mood-soft)] text-[var(--color-cat-mood-ink)]" },
  health: { icon: Heart, tone: "bg-[var(--color-cat-health-soft)] text-[var(--color-cat-health-ink)]" },
  learning: { icon: BookOpen, tone: "bg-[var(--color-cat-learning-soft)] text-[var(--color-cat-learning-ink)]" },
  therapy: { icon: FirstAid, tone: "bg-[var(--color-cat-therapy-soft)] text-[var(--color-cat-therapy-ink)]" },
  note: { icon: NotePencil, tone: "bg-[var(--color-cat-note-soft)] text-[var(--color-cat-note-ink)]" },
} as const satisfies Record<CategoryId, { icon: typeof ForkKnife; tone: string }>;

/** PRD order (LOG-002.1): Meals, Meds, Activities, Sleep, Diaper, Mood, Health, Learning, Therapy, Notes. */
export const CATEGORY_ORDER = Object.keys(CATEGORY_STYLES) as CategoryId[];

const FALLBACK = CATEGORY_STYLES.note;

const SIZES = {
  md: { box: "h-10 w-10", icon: 22 },
  lg: { box: "h-12 w-12", icon: 28 },
} as const;

interface CategoryIconProps {
  category: string;
  size?: keyof typeof SIZES;
}

/** The category icon in a soft circle of the category's colour. Decorative:
 *  the category label always sits next to it. */
export function CategoryIcon({ category, size = "md" }: CategoryIconProps) {
  const style = CATEGORY_STYLES[category as CategoryId] ?? FALLBACK;
  const { box, icon } = SIZES[size];
  const Icon = style.icon;
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full ${box} ${style.tone}`}
      aria-hidden="true"
    >
      <Icon size={icon} />
    </span>
  );
}
