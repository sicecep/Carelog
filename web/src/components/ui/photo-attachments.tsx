"use client";

import { Camera, Trash } from "phosphor-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { compressPhoto } from "@/lib/photo";
import { uploadsApi } from "@/lib/api-client";

// Shared photo attachment machinery for care log entries (CGR-008) and
// incident reports (CGR-015). Extracted from LoggingSheet so both sheets
// pick up the same FileList-live-view fix, the same object-URL cleanup, and
// the same 5-photo cap.

/** Maximum photos per entry/incident (server-enforced too — media.MaxPhotosPerEntry). */
export const PHOTO_MAX = 5;

/**
 * A photo the user has picked but not yet uploaded. Coupling the raw File
 * with its blob-preview URL so thumbnails render before any network call.
 */
export interface PendingPhoto {
  file: File;
  previewUrl: string;
}

/**
 * usePhotoAttachments manages the pending-photo state + cleanup for a sheet.
 *
 * Two subtleties, both proven bug-generating in CGR-008:
 *
 *  1. `FileList` is a LIVE view of the underlying <input>. Callers clear
 *     `input.value` immediately after invoking `addPhotos`, and React runs
 *     the state updater LATER — reading `files` inside the updater would
 *     always see an empty list. `Array.from(files)` here, BEFORE returning.
 *
 *  2. The unmount cleanup MUST read the latest photos via a ref. A cleanup
 *     keyed on the `photos` state would revoke object URLs of previews still
 *     displayed on every add.
 */
export function usePhotoAttachments() {
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const photosRef = useRef<PendingPhoto[]>([]);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  useEffect(() => {
    // Revoke whatever is still pending at unmount. Add/remove revoke eagerly.
    return () => {
      for (const p of photosRef.current) URL.revokeObjectURL(p.previewUrl);
    };
  }, []);

  const addPhotos = useCallback((files: FileList | null) => {
    const picked = files ? Array.from(files) : [];
    if (picked.length === 0) return;
    setPhotos((prev) => {
      const room = PHOTO_MAX - prev.length;
      const taken = picked.slice(0, room).map((file) => ({
        file,
        previewUrl: URL.createObjectURL(file),
      }));
      return [...prev, ...taken];
    });
  }, []);

  const removePhoto = useCallback((index: number) => {
    setPhotos((prev) => {
      const removed = prev[index];
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const clearPhotos = useCallback(() => {
    // Revoke immediately: if the caller is closing/resetting the sheet, the
    // previews are already off-screen so keeping the URLs alive leaks.
    setPhotos((prev) => {
      for (const p of prev) URL.revokeObjectURL(p.previewUrl);
      return [];
    });
  }, []);

  /**
   * Compress each pending photo and upload it, returning the issued URLs in
   * pick order. Runs BEFORE the parent create/update call so the record
   * carries the URLs on first insert (no dangling records if the write
   * fails after upload, but no dangling uploads if it succeeds).
   */
  const uploadPhotos = useCallback(
    async (workspaceId: string): Promise<string[]> => {
      const urls: string[] = [];
      for (const p of photos) {
        const blob = await compressPhoto(p.file);
        const res = await uploadsApi.upload(workspaceId, blob);
        if (!res.data) throw new Error("upload failed");
        urls.push(res.data.url);
      }
      return urls;
    },
    [photos],
  );

  return { photos, addPhotos, removePhoto, clearPhotos, uploadPhotos };
}

/**
 * PhotoRow renders the "add photo" button plus pending thumbnails.
 *
 * The file input is hidden behind a labelled button (a bare
 * `<input type="file">` is neither 56px nor screen-reader friendly).
 * `multiple` + `accept="image/*"` keeps the native picker camera-capable on
 * phones. Each PhotoRow instance needs a distinct `inputId` — two rows in
 * the same DOM sharing an id would make the second label a no-op.
 */
export function PhotoRow({
  photos,
  disabled,
  onAdd,
  onRemove,
  label,
  limitLabel,
  inputId,
}: {
  photos: PendingPhoto[];
  disabled: boolean;
  onAdd: (files: FileList | null) => void;
  onRemove: (index: number) => void;
  label: string;
  limitLabel: string;
  inputId: string;
}) {
  const full = photos.length >= PHOTO_MAX;
  return (
    <div className="mt-4" data-testid="photo-row">
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
              : "border-[var(--color-border-strong)] text-[var(--color-text)] hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]",
          )}
        >
          <Camera size={18} weight="bold" aria-hidden="true" />
          <span>{label}</span>
        </label>
        <span className="text-xs text-[var(--color-text-muted)]">{limitLabel}</span>
      </div>
      {photos.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-3" data-testid="photo-previews">
          {photos.map((p, i) => (
            <li key={p.previewUrl} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- next/image
                  doesn't accept blob: URLs, and these previews are user-supplied
                  pre-upload data, not remote assets. */}
              <img
                src={p.previewUrl}
                alt=""
                className="h-20 w-20 rounded-lg border border-[var(--color-border)] object-cover"
              />
              <button
                type="button"
                aria-label={`${label} ${i + 1}`}
                onClick={() => onRemove(i)}
                className="touch-target absolute -right-2 -top-2 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-surface)] shadow-md"
              >
                <Trash
                  size={16}
                  weight="fill"
                  aria-hidden="true"
                  className="text-[var(--color-error-ink)]"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
