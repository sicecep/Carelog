"use client";

import { useState, useCallback } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { recipientApi, APIError, Recipient } from "@/lib/api-client";
import { BottomSheet } from "./BottomSheet";
import { RecipientDetailsFields } from "./RecipientDetailsFields";
import { ModulePicker } from "./ModulePicker";
import { MODULES, type Module } from "@/lib/constants.generated";
import {
  detailsDraftFrom,
  parseRecipientDetails,
  sameDetails,
  type RecipientDetailsDraft,
  type RecipientDetailsErrors,
} from "@/lib/recipient-details";

interface EditRecipientSheetProps {
  open: boolean;
  onClose: () => void;
  recipient: Recipient;
  workspaceId: string;
  onUpdated: (updated: Recipient) => void;
}

// Same cap as an invitee's name. The API stores TEXT, so this keeps a
// pasted paragraph out of headings and report bylines.
const NAME_MAX = 100;

// The saved modules in canonical order, so a reorder alone is not a change.
const savedModulesOf = (recipient: Recipient): Module[] =>
  MODULES.filter((m) => (recipient.enabled_modules ?? []).includes(m));

/**
 * Owner edits a care recipient's name, what gets logged (modules) and
 * optional profile details (gender, date of birth, weight, height). Built on the shared
 * BottomSheet (DESIGN.md §8.5): focus trap, Escape, scroll lock and focus
 * return come from Radix.
 */
export function EditRecipientSheet({ open, onClose, recipient, workspaceId, onUpdated }: EditRecipientSheetProps) {
  const t = useTranslations("recipients");
  const tDetails = useTranslations("recipientDetails");
  const locale = useLocale();
  const savedDetails = detailsDraftFrom(recipient, locale);
  const [fullName, setFullName] = useState(recipient.full_name);
  const [displayName, setDisplayName] = useState(recipient.display_name || "");
  const [details, setDetails] = useState<RecipientDetailsDraft>(savedDetails);
  const savedModules = savedModulesOf(recipient);
  const [modules, setModules] = useState<Module[]>(savedModules);
  const [detailErrors, setDetailErrors] = useState<RecipientDetailsErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const original = { full: recipient.full_name, display: recipient.display_name || "" };
  const hasChanges =
    fullName !== original.full ||
    displayName !== original.display ||
    !sameDetails(details, savedDetails) ||
    modules.join() !== savedModules.join();

  // Closing without saving throws the edits away, so the next open starts
  // from the saved profile instead of a stale draft.
  const handleClose = useCallback(() => {
    setFullName(recipient.full_name);
    setDisplayName(recipient.display_name || "");
    setDetails(detailsDraftFrom(recipient, locale));
    setModules(savedModulesOf(recipient));
    setDetailErrors({});
    setError(null);
    onClose();
  }, [recipient, locale, onClose]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (fullName.trim() === "") {
        setError(t("editNameRequired"));
        return;
      }
      // Every recipient needs at least one module, or a caregiver has
      // nothing to log.
      if (modules.length === 0) {
        setError(t("editModulesRequired"));
        return;
      }
      const { values, errors } = parseRecipientDetails(details);
      setDetailErrors(errors);
      if (Object.keys(errors).length > 0) {
        setError(tDetails("fixErrors"));
        return;
      }
      setSubmitting(true);
      setError(null);
      try {
        const res = await recipientApi.update(workspaceId, recipient.id, {
          full_name: fullName.trim(),
          // Always sent: "" clears the nickname (an absent field keeps it).
          display_name: displayName.trim(),
          enabled_modules: modules,
          // Likewise for the optional details: "" / null clears a field the
          // owner emptied.
          gender: values.gender ?? "",
          date_of_birth: values.date_of_birth ?? "",
          weight_kg: values.weight_kg,
          height_cm: values.height_cm,
        });
        if (res.data) onUpdated(res.data);
        // DESIGN.md §8.7: close straight away and confirm with a toast.
        onClose();
        toast.success(t("editSaved"));
      } catch (err) {
        setError(
          err instanceof APIError && err.code === "validation_error" && err.message.startsWith("full_name")
            ? t("editNameRequired")
            : t("editError")
        );
      } finally {
        setSubmitting(false);
      }
    },
    [workspaceId, recipient.id, fullName, displayName, modules, details, onUpdated, onClose, t, tDetails]
  );

  return (
    <BottomSheet
      open={open}
      onClose={handleClose}
      title={t("editTitle")}
      closeLabel={t("editClose")}
      // An unsaved rename is not lost to a stray tap or Escape; the close
      // button still discards it deliberately.
      preventDismiss={hasChanges}
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div>
          <label
            htmlFor="edit-recipient-full-name"
            className="mb-1 block text-base font-semibold text-[var(--color-text)]"
          >
            {t("editFullName")}
          </label>
          <input
            id="edit-recipient-full-name"
            type="text"
            required
            maxLength={NAME_MAX}
            autoComplete="off"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="input-base w-full"
          />
        </div>
        <div>
          <label
            htmlFor="edit-recipient-display-name"
            className="mb-1 block text-base font-semibold text-[var(--color-text)]"
          >
            {t("editDisplayName")}{" "}
            <span className="text-sm font-normal text-[var(--color-text-muted)]">({t("editOptional")})</span>
          </label>
          <input
            id="edit-recipient-display-name"
            type="text"
            maxLength={NAME_MAX}
            autoComplete="off"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            aria-describedby="edit-recipient-display-hint"
            className="input-base w-full"
          />
          <p id="edit-recipient-display-hint" className="mt-1 text-sm text-[var(--color-text-muted)]">
            {t("editDisplayNameHint")}
          </p>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-base font-semibold text-[var(--color-text)]">{t("editModules")}</legend>
          <p className="text-sm text-[var(--color-text-muted)]">{t("editModulesHint")}</p>
          <ModulePicker value={modules} onChange={setModules} label={t("editModules")} />
        </fieldset>

        <RecipientDetailsFields
          idPrefix="edit-recipient-details"
          value={details}
          onChange={(next) => {
            setDetails(next);
            setDetailErrors({});
          }}
          errors={detailErrors}
        />

        {error && (
          <p role="alert" className="text-sm text-[var(--color-error-ink)]">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting || !hasChanges}
          className="btn-base btn-primary touch-target w-full disabled:opacity-50"
        >
          {submitting ? t("editSaving") : t("editSave")}
        </button>
      </form>
    </BottomSheet>
  );
}
