"use client";

import { forwardRef, ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { Baby, User, Users, Heart, CheckCircle } from "phosphor-react";

type CareTypeId = "infant" | "child" | "elderly" | "patient";

export interface CareTypeChipProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "onSelect"> {
  type: CareTypeId;
  selected: boolean;
  onSelect: (type: CareTypeId) => void;
  /** Scoped to the `onboarding` namespace — labels resolve as `careType.<type>`. */
  t: (key: string) => string;
}

const icons = {
  infant: Baby,
  child: User,
  elderly: Users,
  patient: Heart,
};

export const CareTypeChip = forwardRef<HTMLButtonElement, CareTypeChipProps>(
  ({ type, selected, onSelect, t, className, ...props }, ref) => {
    const Icon = icons[type];

    return (
      <button
        ref={ref}
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={() => onSelect(type)}
        className={cn(
          "chip shadow-sm relative transition-all duration-200",
          selected && "chip-selected ring-2 ring-[var(--color-accent)] ring-offset-2",
          className
        )}
        {...props}
      >
        <div className={cn(
          "w-12 h-12 rounded-full flex items-center justify-center mb-1 transition-colors",
          selected ? "bg-[var(--color-accent)] text-white" : "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
        )}>
          <Icon size={28} weight={selected ? "fill" : "regular"} />
        </div>
        <span className={cn(
          "text-base font-semibold",
          selected ? "text-[var(--color-accent-ink)]" : "text-[var(--color-text)]"
        )}>
          {t(`careType.${type}`)}
        </span>
        {selected && (
          <div className="absolute top-2 right-2">
            <div className="w-5 h-5 bg-[var(--color-accent)] rounded-full flex items-center justify-center shadow-sm">
              <CheckCircle size={14} weight="fill" className="text-white" />
            </div>
          </div>
        )}
      </button>
    );
  }
);

CareTypeChip.displayName = "CareTypeChip";
