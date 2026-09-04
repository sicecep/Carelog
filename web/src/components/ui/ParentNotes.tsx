"use client";

import { useState, useCallback, useEffect } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle, FileText } from "phosphor-react";
import { api, APIError } from "@/lib/api-client";

interface ParentNotesProps {
  recipientId: string;
  workspaceId: string;
}

export function ParentNotes({ recipientId, workspaceId }: ParentNotesProps) {
  const t = useTranslations("parentnotes");
  const [standingNote, setStandingNote] = useState("");
  const [dailyNote, setDailyNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchNotes = async () => {
      try {
        const res = await api.get<any[]>(`/api/v1/recipients/${recipientId}/notes`, {
          "X-Workspace-ID": workspaceId,
        });
        // Parse and set notes from response
        for (const note of res.data ?? []) {
          if (note.note_type === "standing") setStandingNote(note.content);
          if (note.note_type === "daily") setDailyNote(note.content);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    if (recipientId && workspaceId) fetchNotes();
  }, [recipientId, workspaceId]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const today = new Date().toISOString().split("T")[0];
      // Save standing note
      await api.post(`/api/v1/recipients/${recipientId}/notes`, {
        note_type: "standing",
        content: standingNote,
      }, { "X-Workspace-ID": workspaceId });

      // Save daily note
      if (dailyNote.trim()) {
        await api.post(`/api/v1/recipients/${recipientId}/notes`, {
          note_type: "daily",
          content: dailyNote,
          note_date: today,
        }, { "X-Workspace-ID": workspaceId });
      }
    } catch (err) {
      setError(err instanceof APIError ? err.message : t("saveError"));
    } finally {
      setSaving(false);
    }
  }, [recipientId, workspaceId, standingNote, dailyNote, t]);

  if (loading) return null;

  return (
    <div className="card mb-6 bg-[var(--color-accent-soft)] p-4">
      <h3 className="flex items-center gap-2 text-lg font-semibold text-[var(--color-accent-ink)]">
        <FileText size={20} weight="fill" />
        {t("title")}
      </h3>
      
      <div className="mt-3 space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-[var(--color-text-muted)]">{t("standingLabel")}</label>
          <textarea
            rows={3}
            maxLength={1000}
            value={standingNote}
            onChange={(e) => setStandingNote(e.target.value)}
            placeholder={t("standingPlaceholder")}
            className="input-base w-full"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-[var(--color-text-muted)]">{t("dailyLabel")}</label>
          <textarea
            rows={2}
            maxLength={500}
            value={dailyNote}
            onChange={(e) => setDailyNote(e.target.value)}
            placeholder={t("dailyPlaceholder")}
            className="input-base w-full"
          />
        </div>
      </div>

      {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}

      <button
        onClick={handleSave}
        disabled={saving}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-accent)] py-2 text-sm font-semibold text-white shadow hover:opacity-90 disabled:opacity-50"
      >
        {saving ? t("saving") : <><CheckCircle size={16} weight="fill" /> {t("save")}</>}
      </button>
    </div>
  );
}
