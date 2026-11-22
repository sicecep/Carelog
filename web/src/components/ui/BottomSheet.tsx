"use client";

import { useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "phosphor-react";
import { cn } from "@/lib/utils";

interface BottomSheetProps {
  /** Whether the sheet is open. Controlled by the parent. */
  open: boolean;
  /** Called for every dismissal: close button, Escape, or a tap on the overlay. */
  onClose: () => void;
  /** Visible heading; also the dialog's accessible name. */
  title: React.ReactNode;
  /** Accessible label for the close (X) button — pass a translated string. */
  closeLabel: string;
  /**
   * Block dismissal by Escape or tapping outside, e.g. while a form has
   * unsaved input (DESIGN.md §8.5: the incident sheet must not be lost to a
   * stray tap). The close button still works; the caller decides what it does.
   */
  preventDismiss?: boolean;
  /** Extra classes for the panel (rarely needed). */
  className?: string;
  children: React.ReactNode;
}

/**
 * Shared bottom sheet for caregiver flows (DESIGN.md §8.5), built on Radix
 * Dialog — not Vaul, which is unmaintained. Radix provides what the
 * hand-built sheets lacked: focus trapped inside while open, focus returned
 * to the opener on close, Escape to close, background scroll locked, and the
 * rest of the page hidden from screen readers.
 *
 * Mobile: anchored to the bottom, full width, top corners rounded.
 * From `sm` up: centred dialog. No drag-to-dismiss.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  closeLabel,
  preventDismiss = false,
  className,
  children,
}: BottomSheetProps) {
  // Radix only restores focus to a <Dialog.Trigger>. Our sheets are opened by
  // the parent's own buttons, so without this focus fell to <body> on close
  // and keyboard / screen-reader users lost their place on the page.
  // onOpenAutoFocus fires before focus moves in, so activeElement is still
  // the element that opened the sheet.
  const returnFocusTo = useRef<HTMLElement | null>(null);

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[var(--color-overlay)]" />
        <Dialog.Content
          // No separate description: the title plus the sheet's own content
          // is what's announced. Radix requires this to be explicit.
          aria-describedby={undefined}
          onOpenAutoFocus={() => {
            returnFocusTo.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(e) => {
            const target = returnFocusTo.current;
            if (target && target.isConnected) {
              e.preventDefault();
              target.focus();
            }
          }}
          onEscapeKeyDown={(e) => { if (preventDismiss) e.preventDefault(); }}
          onInteractOutside={(e) => { if (preventDismiss) e.preventDefault(); }}
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-lg overflow-y-auto",
            "max-h-[85dvh] rounded-t-xl bg-[var(--color-surface)] p-5 shadow-lg",
            "pb-[calc(1.25rem+env(safe-area-inset-bottom))]",
            "sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:p-6",
            className
          )}
        >
          <div className="mb-5 flex items-center justify-between gap-3">
            <Dialog.Title className="text-xl font-medium text-[var(--color-text)]">
              {title}
            </Dialog.Title>
            <Dialog.Close
              aria-label={closeLabel}
              className="btn-base btn-ghost btn-icon touch-target shrink-0"
            >
              <X size={20} weight="bold" aria-hidden="true" />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
