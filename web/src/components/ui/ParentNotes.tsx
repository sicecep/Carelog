"use client";

import { useState, useCallback, useEffect } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle, FileText } from "phosphor-react";
import { api, APIError } from "@/lib/api-client";

interface ParentNote {
  id: string;
  note_type: "standing" | "daily";
  content: string;
  note_date?: string;
}

interface ParentNotesProps {
  recipientId: string;
  workspaceId: string;
  /**
   * Owners get the editor; everyone else gets a read-only panel.
   *
   * OWN-004's point is that the CAREGIVER sees the instructions every day
   * without the owner repeating them over WhatsApp — so this must render for
   * non-owners too, just not as editable fields. The API already rejects
   * writes from viewers (RequireWriter), but a caregiver seeing textareas
   * they can partially save would be its own bug.
   */
  canEdit: boolean;
}

/**
 * Standing instructions (OWN-004) + today's note (OWN-005).
 *
 * Standing notes persist until changed; daily notes are scoped to a date and
 * are upserted per day, so yesterday's "dokter jam 3" never leaks into today.
 */
export function ParentNotes({ recipientId, workspaceId, canEdit }: ParentNotesProps) {
  const t = useTranslations("parentnotes");
  const [standingNote, setStandingNote] = useState("");
  const [dailyNote, setDailyNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchNotes = async () => {
      try {
        const res = await api.get<ParentNote[]>(`/api/v1/recipients/${recipientId}/notes`, {
          "X-Workspace-ID": workspaceId,
        });
        for (const note of res.data ?? []) {
          if (note.note_type === "standing") setStandingNote(note.content);
          if (note.note_type === "daily") setDailyNote(note.content);
        }
      } catch (err) {
        console.error("parent notes fetch failed", err);
      } finally {
        setLoading(false);
      }
    };
    if (recipientId && workspaceId) fetchNotes();
  }, [recipientId, workspaceId]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const today = new Date().toISOString().split("T")[0];
      // Standing note is sent even when empty: clearing the field must clear
      // the instruction, not silently leave the old one in place.
      await api.post(
        `/api/v1/recipients/${recipientId}/notes`,
        { note_type: "standing", content: standingNote },
        { "X-Workspace-ID": workspaceId }
      );
      await api.post(
        `/api/v1/recipients/${recipientId}/notes`,
        { note_type: "daily", content: dailyNote, note_date: today },
        { "X-Workspace-ID": workspaceId }
      );
      setSaved(true);
    } catch (err) {
      setError(err instanceof APIError ? err.message : t("saveError"));
    } finally {
      setSaving(false);
    }
  }, [recipientId, workspaceId, standingNote, dailyNote, t]);

  if (loading) return null;

  // Read-only view for caregivers/viewers. Rendered only when there is
  // something to read — an empty panel would just be noise above the timeline.
  if (!canEdit) {
    if (!standingNote.trim() && !dailyNote.trim()) return null;
    return (
      <section
        aria-labelledby="parent-notes-heading"
        className="card mb-6 border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
      >
        <h3
          id="parent-notes-heading"
          className="flex items-center gap-2 text-lg font-semibold text-[var(--color-accent-ink)]"
        >
          <FileText size={20} weight="fill" aria-hidden="true" />
          {t("title")}
        </h3>
        <div className="mt-3 space-y-3">
          {standingNote.trim() && (
            <div>
              <p className="text-sm font-medium text-[var(--color-text-muted)]">
                {t("standingLabel")}
              </p>
              <p className="whitespace-pre-wrap text-base text-[var(--color-text)]">
                {standingNote}
              </p>
            </div>
          )}
          {dailyNote.trim() && (
            <div>
              <p className="text-sm font-medium text-[var(--color-text-muted)]">
                {t("dailyLabel")}
              </p>
              <p className="whitespace-pre-wrap text-base text-[var(--color-text)]">
                {dailyNote}
              </p>
            </div>
          )}
        </div>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="parent-notes-heading"
      className="card mb-6 border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
    >
      <h3
        id="parent-notes-heading"
        className="flex items-center gap-2 text-lg font-semibold text-[var(--color-accent-ink)]"
      >
        <FileText size={20} weight="fill" aria-hidden="true" />
        {t("title")}
      </h3>

      <div className="mt-3 space-y-4">
        <div>
          <label
            htmlFor="standing-note"
            className="mb-1 block text-sm font-medium text-[var(--color-text-muted)]"
          >
            {t("standingLabel")}
          </label>
          <textarea
            id="standing-note"
            rows={3}
            maxLength={1000}
            value={standingNote}
            onChange={(e) => {
              setStandingNote(e.target.value);
              setSaved(false);
            }}
            placeholder={t("standingPlaceholder")}
            className="input-base w-full resize-y py-3"
          />
        </div>

        <div>
          <label
            htmlFor="daily-note"
            className="mb-1 block text-sm font-medium text-[var(--color-text-muted)]"
          >
            {t("dailyLabel")}
          </label>
          <textarea
            id="daily-note"
            rows={2}
            maxLength={500}
            value={dailyNote}
            onChange={(e) => {
              setDailyNote(e.target.value);
              setSaved(false);
            }}
            placeholder={t("dailyPlaceholder")}
            className="input-base w-full resize-y py-3"
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-sm text-[var(--color-error-ink)]">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="mt-2 text-sm text-[var(--color-accent-ink)]">
          {t("saved")}
        </p>
      )}

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="btn-base btn-primary touch-target mt-3 w-full"
      >
        {saving ? (
          t("saving")
        ) : (
          <>
            <CheckCircle size={20} weight="fill" aria-hidden="true" /> {t("save")}
          </>
        )}
      </button>
    </section>
  );
}
