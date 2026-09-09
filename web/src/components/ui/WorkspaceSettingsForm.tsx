"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Workspace, workspaceApi, APIError } from "@/lib/api-client";

interface WorkspaceSettingsFormProps {
  workspace: Workspace;
  locale: string;
}

// A short list beats a full IANA picker: these are the zones an Indonesian
// household actually needs (WIB/WITA/WIT), plus UTC as a neutral fallback.
// The API validates against real tzdata, so this list constrains the UI
// without being the security boundary.
const TIMEZONES = [
  "Asia/Jakarta",
  "Asia/Makassar",
  "Asia/Jayapura",
  "Asia/Singapore",
  "UTC",
];

export function WorkspaceSettingsForm({ workspace, locale }: WorkspaceSettingsFormProps) {
  const t = useTranslations("workspaceSettings");
  const router = useRouter();

  const canEdit = workspace.role === "owner";

  const [name, setName] = useState(workspace.name);
  const [wsLocale, setWsLocale] = useState<Workspace["locale"]>(workspace.locale);
  const [timezone, setTimezone] = useState(workspace.timezone);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Delete is behind a two-step reveal plus an exact-name match, because it
  // cascades to every recipient, report and incident in the workspace.
  const [showDelete, setShowDelete] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);

  const dirty =
    name !== workspace.name ||
    wsLocale !== workspace.locale ||
    timezone !== workspace.timezone;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await workspaceApi.update(workspace.id, { name, locale: wsLocale, timezone });
      setSaved(true);
      // The locale lives in the URL, so a language change has to re-route
      // rather than just re-render.
      if (wsLocale !== workspace.locale) {
        router.push(`/${wsLocale}/settings`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof APIError ? err.message : t("errorGeneric"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await workspaceApi.delete(workspace.id, confirmName);
      // The workspace is gone; there is nothing left to render here.
      router.push(`/${locale}/login`);
    } catch (err) {
      setError(err instanceof APIError ? err.message : t("errorGeneric"));
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-8">
      {!canEdit && (
        <p className="card p-4 text-sm text-[var(--color-text-muted)]">{t("readOnlyNotice")}</p>
      )}

      <section aria-labelledby="general-heading" className="card p-6">
        <h2
          id="general-heading"
          className="mb-4 text-lg font-semibold text-[var(--color-text)]"
        >
          {t("generalHeading")}
        </h2>

        <form onSubmit={handleSave} className="space-y-5">
          <div>
            <label
              htmlFor="ws-name"
              className="mb-1 block text-sm font-medium text-[var(--color-text)]"
            >
              {t("nameLabel")}
            </label>
            <input
              id="ws-name"
              type="text"
              value={name}
              disabled={!canEdit || saving}
              maxLength={80}
              placeholder={t("namePlaceholder")}
              onChange={(e) => setName(e.target.value)}
              className="touch-target min-h-[56px] w-full rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 text-base text-[var(--color-text)] disabled:opacity-60"
            />
          </div>

          <div>
            <label
              htmlFor="ws-locale"
              className="mb-1 block text-sm font-medium text-[var(--color-text)]"
            >
              {t("localeLabel")}
            </label>
            <select
              id="ws-locale"
              value={wsLocale}
              disabled={!canEdit || saving}
              onChange={(e) => setWsLocale(e.target.value as Workspace["locale"])}
              className="touch-target min-h-[56px] w-full rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 text-base text-[var(--color-text)] disabled:opacity-60"
            >
              <option value="id">{t("localeID")}</option>
              <option value="en">{t("localeEN")}</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="ws-timezone"
              className="mb-1 block text-sm font-medium text-[var(--color-text)]"
            >
              {t("timezoneLabel")}
            </label>
            <select
              id="ws-timezone"
              value={timezone}
              disabled={!canEdit || saving}
              onChange={(e) => setTimezone(e.target.value)}
              className="touch-target min-h-[56px] w-full rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 text-base text-[var(--color-text)] disabled:opacity-60"
            >
              {/* Keep the stored value selectable even if it predates this
                  list, so saving the form can't silently change it. */}
              {!TIMEZONES.includes(timezone) && <option value={timezone}>{timezone}</option>}
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">{t("timezoneHint")}</p>
          </div>

          <div>
            <span className="mb-1 block text-sm font-medium text-[var(--color-text)]">
              {t("planLabel")}
            </span>
            <p className="text-base text-[var(--color-text)]">
              {workspace.plan}{" "}
              <span className="text-xs text-[var(--color-text-muted)]">
                ({t("planReadOnly")})
              </span>
            </p>
          </div>

          {error && (
            <p role="alert" className="text-sm text-[var(--color-error-ink)]">
              {error}
            </p>
          )}
          {saved && !error && (
            <p role="status" className="text-sm text-[var(--color-success-ink)]">
              {t("saved")}
            </p>
          )}

          {canEdit && (
            <button
              type="submit"
              disabled={saving || !dirty}
              className="btn-base btn-primary touch-target min-h-[56px] px-5 disabled:opacity-50"
            >
              {saving ? t("saving") : t("save")}
            </button>
          )}
        </form>
      </section>

      {canEdit && (
        <section
          aria-labelledby="danger-heading"
          className="rounded-lg border border-[var(--color-error-ink)] p-6"
        >
          <h2
            id="danger-heading"
            className="mb-2 text-lg font-semibold text-[var(--color-error-ink)]"
          >
            {t("dangerHeading")}
          </h2>
          <h3 className="mb-1 font-medium text-[var(--color-text)]">{t("deleteTitle")}</h3>
          <p className="mb-4 text-sm text-[var(--color-text-muted)]">{t("deleteWarning")}</p>

          {!showDelete ? (
            <button
              type="button"
              onClick={() => setShowDelete(true)}
              className="btn-base btn-ghost touch-target min-h-[56px] px-4 text-[var(--color-error-ink)] hover:bg-[var(--color-error-soft)]"
            >
              {t("deleteButton")}
            </button>
          ) : (
            <div className="space-y-3">
              <label
                htmlFor="ws-confirm"
                className="block text-sm font-medium text-[var(--color-text)]"
              >
                {t("deleteConfirmLabel", { name: workspace.name })}
              </label>
              <input
                id="ws-confirm"
                type="text"
                value={confirmName}
                disabled={deleting}
                placeholder={t("deleteConfirmPlaceholder")}
                onChange={(e) => setConfirmName(e.target.value)}
                className="touch-target min-h-[56px] w-full rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 text-base text-[var(--color-text)]"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleDelete}
                  // Enabled only on an exact match, so the button itself
                  // reflects the same rule the API enforces.
                  disabled={deleting || confirmName.trim() !== workspace.name.trim()}
                  className="btn-base touch-target min-h-[56px] bg-[var(--color-error-ink)] px-4 text-white disabled:opacity-50"
                >
                  {deleting ? t("deleting") : t("deleteConfirmButton")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowDelete(false);
                    setConfirmName("");
                  }}
                  disabled={deleting}
                  className="btn-base btn-secondary touch-target min-h-[56px] px-4"
                >
                  {t("cancel")}
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
