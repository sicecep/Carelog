"use client";

import { forwardRef, ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { Baby, User, Users, Heart } from "phosphor-react";

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
        className={cn("chip", selected && "chip-selected", className)}
        {...props}
      >
        <Icon className="chip-icon" size={32} weight="thin" />
        <span className="text-base font-medium">{t(`careType.${type}`)}</span>
        {selected && (
          <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        )}
      </button>
    );
  }
);

CareTypeChip.displayName = "CareTypeChip";
