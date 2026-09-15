"use client";

/* eslint-disable @next/next/no-img-element -- photo previews are transient
   object URLs and the timeline renders remote storage URLs; next/image gains
   nothing in either case. */

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { X, CheckCircle, Clock, Camera, Trash } from "phosphor-react";
import { cn } from "@/lib/utils";
import { type LogCategory, VITAL_SPECS } from "@/lib/constants.generated";
import { LOG_SUBCATEGORIES, type LogSubcategory } from "@/lib/log-subcategories";
import { recipientApi, uploadsApi, APIError } from "@/lib/api-client";
import { compressPhoto } from "@/lib/photo";
import { CategoryGrid } from "./CategoryGrid";
import { buildBackfillOptions, type BackfillOption } from "@/lib/backfill";

interface LoggingSheetProps {
  /** Whether the sheet is open. Controlled by the parent (e.g. a FAB). */
  open: boolean;
  onClose: () => void;
  recipientId: string;
  workspaceId: string;
  /** Called after a successful save so the parent can refresh a timeline, etc. */
  onLogged?: () => void;
}

type Step = "category" | "subcategory" | "backfill" | "vital";

const NOTE_MAX = 500;
const PHOTO_MAX = 5;

// PendingPhoto couples the raw File with its preview object URL so the
// thumbnails can render before anything is uploaded.
interface PendingPhoto {
  file: File;
  previewUrl: string;
}

export function LoggingSheet({ open, onClose, recipientId, workspaceId, onLogged }: LoggingSheetProps) {
  const t = useTranslations("logging");
  const tCategories = useTranslations("reports.categories");
  const tSubcategories = useTranslations("logging.subcategories");
  const tVitalFields = useTranslations("logging.vitalFields");

  const [step, setStep] = useState<Step>("category");
  const [category, setCategory] = useState<LogCategory | null>(null);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [occurredAt, setOccurredAt] = useState<Date | undefined>(undefined);
  const [backfillMode, setBackfillMode] = useState(false);
  const [pendingSub, setPendingSub] = useState<LogSubcategory | undefined>(undefined);
  const [vitalValues, setVitalValues] = useState<Record<string, string>>({});
  // CGR-008: photos picked before submit; compressed + uploaded on save.
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  // Ref so the unmount cleanup revokes the LATEST object URLs — a
  // photos-keyed cleanup would revoke still-displayed previews on every add.
  const photosRef = useRef<PendingPhoto[]>([]);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  const backfillOptions = useMemo(() => buildBackfillOptions(), []);

  // The spec for the vital being entered, when the sheet is on the vital step.
  const vitalSpec = pendingSub ? VITAL_SPECS[pendingSub] : undefined;

  // Object URLs leak for the tab's lifetime if never revoked. Add/remove
  // revoke eagerly; this catches whatever is still pending at unmount.
  useEffect(() => {
    return () => {
      for (const p of photosRef.current) URL.revokeObjectURL(p.previewUrl);
    };
  }, []);

  const reset = useCallback(() => {
    for (const p of photos) URL.revokeObjectURL(p.previewUrl);
    setStep("category");
    setCategory(null);
    setSubmitting(null);
    setSuccess(false);
    setError(null);
    setNoteText("");
    setOccurredAt(undefined);
    setBackfillMode(false);
    setPendingSub(undefined);
    setVitalValues({});
    setPhotos([]);
  }, [photos]);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const addPhotos = useCallback(
    (files: FileList | null) => {
      if (!files) return;
      setError(null);
      setPhotos((prev) => {
        const room = PHOTO_MAX - prev.length;
        const taken = Array.from(files).slice(0, room);
        return [
          ...prev,
          ...taken.map((file) => ({ file, previewUrl: URL.createObjectURL(file) })),
        ];
      });
    },
    []
  );

  const removePhoto = useCallback((index: number) => {
    setPhotos((prev) => {
      const [removed] = prev.splice(index, 1);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return [...prev];
    });
  }, []);

  // uploadPhotos compresses and uploads every pending photo, returning the
  // issued URLs. Runs before entry creation so the entry carries them.
  const uploadPhotos = useCallback(async (): Promise<string[]> => {
    const urls: string[] = [];
    for (const p of photos) {
      const blob = await compressPhoto(p.file);
      const res = await uploadsApi.upload(workspaceId, blob);
      if (!res.data) throw new Error("upload failed");
      urls.push(res.data.url);
    }
    return urls;
  }, [photos, workspaceId]);

  const submitEntry = useCallback(
    async (
      cat: LogCategory,
      sub: LogSubcategory | undefined,
      text?: string,
      time?: Date,
      vitals?: Record<string, number>
    ) => {
      setSubmitting(sub ?? (text ? "__text__" : "__none__"));
      setError(null);
      try {
        // CGR-008: photos upload first; a failure here aborts the entry so
        // a "photo attached" promise is never silently broken.
        const photoUrls = photos.length > 0 ? await uploadPhotos() : undefined;
        await recipientApi.createEntry(workspaceId, recipientId, {
          category: cat,
          subcategory: sub,
          value_text: text,
          value_json: vitals,
          photo_urls: photoUrls,
          occurred_at: (time ?? occurredAt ?? new Date()).toISOString(),
        });
        setSuccess(true);
        onLogged?.();
        setTimeout(() => {
          handleClose();
        }, 1200);
      } catch (err) {
        setError(err instanceof APIError ? err.message : t("errorGeneric"));
      } finally {
        setSubmitting(null);
      }
    },
    [workspaceId, recipientId, onLogged, handleClose, t, occurredAt, photos, uploadPhotos]
  );

  const handleCategorySelect = useCallback((cat: LogCategory) => {
    setCategory(cat);
    setError(null);
    const subs = LOG_SUBCATEGORIES[cat] ?? [];
    if (cat === "note") {
      setStep("subcategory");
    } else if (subs.length === 0) {
      if (backfillMode) {
        setPendingSub(undefined);
        setStep("backfill");
      } else {
        void submitEntry(cat, undefined);
      }
    } else {
      setStep("subcategory");
    }
  }, [backfillMode, submitEntry]);

  const handleSubSelect = useCallback((sub: LogSubcategory) => {
    if (VITAL_SPECS[sub]) {
      // Vitals (CGR-009) need a numeric measurement before they can be
      // logged — a health record without a number is worse than none.
      setPendingSub(sub);
      setVitalValues({});
      setError(null);
      setStep("vital");
      return;
    }
    if (backfillMode) {
      setPendingSub(sub);
      setStep("backfill");
    } else {
      if (category) void submitEntry(category, sub);
    }
  }, [category, backfillMode, submitEntry]);

  const handleBackfillSelect = useCallback((opt: BackfillOption) => {
    if (!category) return;
    const vitals = vitalSpec ? parseVitalValues(vitalSpec, vitalValues) : undefined;
    if (vitalSpec && vitals === undefined) return; // invalid entries: stay put
    void submitEntry(
      category,
      pendingSub,
      category === "note" ? noteText : undefined,
      opt.date,
      vitals
    );
  }, [category, pendingSub, noteText, vitalSpec, vitalValues, submitEntry]);

  if (!open) return null;

  const subcategories = category ? LOG_SUBCATEGORIES[category] ?? [] : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="logging-sheet-title"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-lg rounded-t-xl bg-[var(--color-surface)] p-5 shadow-lg sm:rounded-xl sm:p-6 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 id="logging-sheet-title" className="text-xl font-medium text-[var(--color-text)]">
            {step === "category" ? t("title") : tCategories(category!)}
          </h2>
          <button
            type="button"
            aria-label={t("close")}
            onClick={handleClose}
            className="btn-base btn-ghost btn-icon touch-target"
          >
            <X size={20} weight="bold" aria-hidden="true" />
          </button>
        </div>

        {success ? (
          <div className="toast-success flex items-center gap-2" role="status">
            <CheckCircle size={20} weight="fill" aria-hidden="true" />
            <span>{t("logged")}</span>
          </div>
        ) : step === "category" ? (
          <CategoryGrid onSelect={handleCategorySelect} />
        ) : step === "backfill" ? (
          <div>
            <button
              type="button"
              onClick={() =>
                setStep(
                  pendingSub && VITAL_SPECS[pendingSub]
                    ? "vital"
                    : category === "note" || subcategories.length > 0
                      ? "subcategory"
                      : "category"
                )
              }
              className="mb-4 text-base font-semibold text-[var(--color-accent)] touch-target"
            >
              {t("back")}
            </button>

            {backfillOptions.blocks.length > 0 && (
              <div className="mb-4">
                <p className="mb-2 text-sm font-semibold text-[var(--color-text)]">
                  {t("backfillBlocksLabel")}
                </p>
                <div className="grid grid-cols-3 gap-3">
                  {backfillOptions.blocks.map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      disabled={submitting !== null}
                      onClick={() => handleBackfillSelect(opt)}
                      className="touch-target flex w-full items-center justify-center rounded-lg border-[1.5px] border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-3 text-base font-semibold text-[var(--color-text)] transition-all hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] disabled:opacity-50"
                    >
                      {t(`backfillBlocks.${opt.key}`)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <p className="mb-2 text-sm font-semibold text-[var(--color-text)]">
              {t("backfillSlotsLabel")}
            </p>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {backfillOptions.slots.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  disabled={submitting !== null}
                  onClick={() => handleBackfillSelect(opt)}
                  className="touch-target flex w-full items-center justify-center rounded-lg border-[1.5px] border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-3 text-base font-semibold tabular-nums text-[var(--color-text)] transition-all hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] disabled:opacity-50"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        ) : step === "vital" && vitalSpec && category ? (
          <div>
            <button
              type="button"
              onClick={() => setStep("subcategory")}
              className="mb-4 text-sm font-medium text-[var(--color-accent)] touch-target"
            >
              {t("back")}
            </button>

            <div className="space-y-4">
              {vitalSpec.fields.map((field) => {
                const raw = vitalValues[field] ?? "";
                const parsed = raw.trim() === "" ? NaN : Number(raw);
                // A spec always carries ranges for exactly its own fields;
                // the fallbacks only satisfy the Partial<Record> type.
                const min = vitalSpec.min[field] ?? Number.NEGATIVE_INFINITY;
                const max = vitalSpec.max[field] ?? Number.POSITIVE_INFINITY;
                const outOfRange = Number.isFinite(parsed) && (parsed < min || parsed > max);
                return (
                  <div key={field}>
                    <label
                      htmlFor={`vital-${field}`}
                      className="mb-1 block text-sm font-semibold text-[var(--color-text)]"
                    >
                      {tVitalFields(field)} ({vitalSpec.unit})
                    </label>
                    <input
                      id={`vital-${field}`}
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      autoFocus={field === vitalSpec.fields[0]}
                      value={raw}
                      onChange={(e) => setVitalValues((prev) => ({ ...prev, [field]: e.target.value }))}
                      aria-invalid={outOfRange}
                      className={cn(
                        "input-base touch-target w-full py-3 text-base tabular-nums",
                        outOfRange && "border-[var(--color-error-ink)]"
                      )}
                    />
                    {outOfRange && (
                      <p className="mt-1 text-xs text-[var(--color-error-ink)]" role="alert">
                        {t("vitalRangeError", { min, max, unit: vitalSpec.unit })}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex items-center justify-between gap-4">
              <button
                type="button"
                onClick={() => setBackfillMode(!backfillMode)}
                className={cn(
                  "flex-1 rounded-lg border-2 px-4 py-3 text-sm font-medium transition-all touch-target",
                  backfillMode
                    ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]"
                    : "border-[var(--color-border)] text-[var(--color-text-muted)]"
                )}
              >
                {t("backfillToggle")}
              </button>
              <button
                type="button"
                disabled={submitting !== null || parseVitalValues(vitalSpec, vitalValues) === undefined}
                onClick={() => {
                  const vitals = parseVitalValues(vitalSpec, vitalValues);
                  if (vitals === undefined) return;
                  if (backfillMode) {
                    setStep("backfill");
                  } else {
                    void submitEntry(category, pendingSub, undefined, undefined, vitals);
                  }
                }}
                className="btn-base btn-primary flex-[2] py-3 text-base disabled:opacity-50"
              >
                {submitting !== null ? t("noteSaving") : t("vitalSave")}
              </button>
            </div>
          </div>
        ) : category === "note" ? (
          <div>
            <button
              type="button"
              onClick={() => setStep("category")}
              className="mb-4 text-sm font-medium text-[var(--color-accent)] touch-target"
            >
              {t("back")}
            </button>

            <textarea
              autoFocus
              rows={4}
              maxLength={NOTE_MAX}
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder={t("notePlaceholder")}
              className="input-base w-full resize-y py-3 text-base"
            />
            <p className="mt-1 text-right text-xs text-[var(--color-text-muted)]">
              {noteText.length}/{NOTE_MAX}
            </p>

            <PhotoRow
              photos={photos}
              disabled={submitting !== null}
              onAdd={addPhotos}
              onRemove={removePhoto}
              label={t("addPhoto")}
              limitLabel={t("photoLimit", { max: PHOTO_MAX })}
            />

            <div className="mt-3 flex items-center justify-between gap-4">
              <button
                type="button"
                onClick={() => setBackfillMode(!backfillMode)}
                className={cn(
                  "flex-1 rounded-lg border-2 px-4 py-3 text-sm font-medium transition-all touch-target",
                  backfillMode ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]" : "border-[var(--color-border)] text-[var(--color-text-muted)]"
                )}
              >
                {t("backfillToggle")}
              </button>
              <button
                type="button"
                disabled={submitting !== null || noteText.trim().length === 0}
                onClick={() => {
                  if (backfillMode) {
                    setStep("backfill");
                  } else {
                    void submitEntry("note", undefined, noteText.trim());
                  }
                }}
                className="btn-base btn-primary flex-[2] py-3 text-base disabled:opacity-50"
              >
                {submitting !== null ? t("noteSaving") : t("noteSave")}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setStep("category")}
                className="text-sm font-medium text-[var(--color-accent)] touch-target"
              >
                {t("back")}
              </button>
              <button
                type="button"
                onClick={() => setBackfillMode(!backfillMode)}
                className={cn(
                  "rounded-full border-2 px-3 py-1 text-xs font-medium transition-all touch-target",
                  backfillMode ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]" : "border-[var(--color-border)] text-[var(--color-text-muted)]"
                )}
              >
                {t("backfillToggle")}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {subcategories.map((sub) => (
                <button
                  key={sub}
                  type="button"
                  disabled={submitting !== null}
                  onClick={() => handleSubSelect(sub as LogSubcategory)}
                  className={cn(
                    "touch-target flex w-full items-center justify-center rounded-lg border-[1.5px] border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-3 text-base font-semibold text-[var(--color-text)] transition-all hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] disabled:opacity-50",
                    submitting === sub && "opacity-60"
                  )}
                >
                  {tSubcategories(`${category}.${sub}` as const)}
                </button>
              ))}
            </div>

            <PhotoRow
              photos={photos}
              disabled={submitting !== null}
              onAdd={addPhotos}
              onRemove={removePhoto}
              label={t("addPhoto")}
              limitLabel={t("photoLimit", { max: PHOTO_MAX })}
            />
          </div>
        )}

        {error && <p role="alert" className="mt-4 text-sm text-[var(--color-error-ink)]">{error}</p>}

        <p className="mt-4 flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
          <Clock size={14} aria-hidden="true" />
          {backfillMode ? t("backfillHint") : t("autoTimestampHint")}
        </p>
      </div>
    </div>
  );
}

// parseVitalValues validates the raw text inputs against the spec's ranges
// (mirroring the server's rules) and returns the numeric payload, or
// undefined when any field is missing, non-numeric, or out of range —
// including the blood-pressure rule that systolic must exceed diastolic.
function parseVitalValues(
  spec: (typeof VITAL_SPECS)[keyof typeof VITAL_SPECS],
  raw: Record<string, string>
): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  for (const field of spec.fields) {
    const text = (raw[field] ?? "").trim();
    if (text === "") return undefined;
    const num = Number(text);
    if (!Number.isFinite(num)) return undefined;
    const min = spec.min[field] ?? Number.NEGATIVE_INFINITY;
    const max = spec.max[field] ?? Number.POSITIVE_INFINITY;
    if (num < min || num > max) return undefined;
    out[field] = num;
  }
  if ("systolic" in out && "diastolic" in out && out.systolic <= out.diastolic) {
    return undefined;
  }
  return out;
}

// PhotoRow (CGR-008): the add-photo control + pending thumbnails shared by
// the subcategory and note steps. The file input is hidden behind a labelled
// button (a bare input[type=file] is neither 56px nor screen-reader friendly).
// multiple + image/* keeps the native picker camera-capable on phones.
function PhotoRow({
  photos,
  disabled,
  onAdd,
  onRemove,
  label,
  limitLabel,
}: {
  photos: PendingPhoto[];
  disabled: boolean;
  onAdd: (files: FileList | null) => void;
  onRemove: (index: number) => void;
  label: string;
  limitLabel: string;
}) {
  const inputId = "logging-photo-input";
  const full = photos.length >= PHOTO_MAX;
  return (
    <div className="mt-4">
      <input
        id={inputId}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        disabled={disabled || full}
        onChange={(e) => {
          onAdd(e.target.files);
          // Allow re-picking the same file after removing it.
          e.target.value = "";
        }}
      />
      <div className="flex items-center justify-between gap-3">
        <label
          htmlFor={inputId}
          aria-disabled={disabled || full}
          className={cn(
            "touch-target inline-flex cursor-pointer items-center gap-2 rounded-lg border-2 px-4 py-2 text-sm font-medium transition-all",
            disabled || full
              ? "cursor-not-allowed border-[var(--color-border)] text-[var(--color-text-muted)] opacity-50"
              : "border-[var(--color-border-strong)] text-[var(--color-text)] hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]"
          )}
        >
          <Camera size={18} weight="bold" aria-hidden="true" />
          <span>{label}</span>
        </label>
        <span className="text-xs text-[var(--color-text-muted)]">{limitLabel}</span>
      </div>
      {photos.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-3">
          {photos.map((p, i) => (
            <li key={p.previewUrl} className="relative">
              <img
                src={p.previewUrl}
                alt=""
                className="h-20 w-20 rounded-lg border border-[var(--color-border)] object-cover"
              />
              <button
                type="button"
                aria-label={`${label} ${i + 1}`}
                onClick={() => onRemove(i)}
                className="absolute -right-2 -top-2 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-surface)] shadow-md touch-target"
              >
                <Trash size={16} weight="fill" aria-hidden="true" className="text-[var(--color-error-ink)]" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
