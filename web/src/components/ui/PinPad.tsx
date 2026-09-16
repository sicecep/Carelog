"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

/**
 * A 6-digit PIN entry pad (AUTH-005).
 *
 * Built as an on-screen keypad rather than a plain <input type="number">
 * deliberately: the target user is a caregiver on a low-end Android phone,
 * and the native numeric keyboard on those devices is inconsistent (some
 * render a full QWERTY with a number row, some resize the viewport and hide
 * the submit button). A fixed keypad is predictable and the digits are large
 * enough to hit without looking.
 *
 * The value is held as a string of digits and never rendered back to the
 * screen — filled positions show a dot, so a PIN can't be read over the
 * caregiver's shoulder (they often work in shared rooms).
 */

const PIN_LENGTH = 6;

export function PinPad({
  onComplete,
  disabled = false,
  error,
  autoSubmit = true,
}: {
  onComplete: (pin: string) => void;
  disabled?: boolean;
  error?: string | null;
  autoSubmit?: boolean;
}) {
  const t = useTranslations("pin");
  const [pin, setPin] = useState("");
  const liveRef = useRef<HTMLParagraphElement>(null);

  // Clear the entry whenever the parent reports a NEW failure, so the next
  // attempt starts from an empty pad instead of the caregiver having to
  // backspace six times.
  //
  // Adjusting state during render (React's documented pattern for "derive
  // from a prop change") rather than in an effect: an effect would paint the
  // stale dots first and then blank them, and React 19's linter correctly
  // flags the cascading render.
  const [prevError, setPrevError] = useState(error);
  if (error !== prevError) {
    setPrevError(error);
    if (error) setPin("");
  }

  const submit = useCallback(
    (value: string) => {
      onComplete(value);
    },
    [onComplete],
  );

  const press = useCallback(
    (digit: string) => {
      if (disabled) return;
      setPin((prev) => {
        if (prev.length >= PIN_LENGTH) return prev;
        const next = prev + digit;
        // Fire on the last digit. Scheduled out of the updater so the final
        // dot paints before the network call blocks the pad — otherwise the
        // caregiver taps 6 and sees only 5 dots while it spins.
        if (autoSubmit && next.length === PIN_LENGTH) {
          setTimeout(() => submit(next), 0);
        }
        return next;
      });
    },
    [disabled, autoSubmit, submit],
  );

  const backspace = useCallback(() => {
    if (disabled) return;
    setPin((prev) => prev.slice(0, -1));
  }, [disabled]);

  // Physical keyboard support: desktop owners setting their own PIN, and
  // anyone using an external keyboard for accessibility.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key >= "0" && e.key <= "9") {
        press(e.key);
      } else if (e.key === "Backspace") {
        backspace();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [press, backspace]);

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

  return (
    <div className="space-y-6">
      {/* Filled-dot display. aria-live announces progress for screen
          readers without ever exposing the digits themselves. */}
      <div
        className="flex justify-center gap-3"
        role="img"
        aria-label={t("digitsEntered", { count: pin.length, total: PIN_LENGTH })}
      >
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <span
            key={i}
            className={`h-4 w-4 rounded-full border-2 transition-colors ${
              i < pin.length
                ? "border-blue-600 bg-blue-600"
                : "border-gray-300 bg-transparent"
            }`}
          />
        ))}
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-center text-base text-red-700"
        >
          {error}
        </p>
      )}

      <p ref={liveRef} className="sr-only" aria-live="polite">
        {pin.length === PIN_LENGTH ? t("complete") : ""}
      </p>

      <div className="mx-auto grid max-w-xs grid-cols-3 gap-3">
        {keys.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => press(k)}
            disabled={disabled}
            aria-label={k}
            className="touch-target flex items-center justify-center rounded-xl border border-gray-300 bg-white text-2xl font-semibold text-gray-900 active:bg-gray-100 disabled:opacity-50"
          >
            {k}
          </button>
        ))}

        {/* Bottom row: blank, 0, backspace — the standard phone layout, so
            muscle memory from the dialer transfers. */}
        <span aria-hidden="true" />

        <button
          type="button"
          onClick={() => press("0")}
          disabled={disabled}
          aria-label="0"
          className="touch-target flex items-center justify-center rounded-xl border border-gray-300 bg-white text-2xl font-semibold text-gray-900 active:bg-gray-100 disabled:opacity-50"
        >
          0
        </button>

        <button
          type="button"
          onClick={backspace}
          disabled={disabled || pin.length === 0}
          aria-label={t("backspace")}
          className="touch-target flex items-center justify-center rounded-xl border border-gray-300 bg-white text-xl text-gray-900 active:bg-gray-100 disabled:opacity-30"
        >
          &larr;
        </button>
      </div>

      {!autoSubmit && (
        <button
          type="button"
          onClick={() => submit(pin)}
          disabled={disabled || pin.length !== PIN_LENGTH}
          className="btn-base w-full bg-blue-600 text-white disabled:opacity-50"
        >
          {t("confirm")}
        </button>
      )}
    </div>
  );
}
