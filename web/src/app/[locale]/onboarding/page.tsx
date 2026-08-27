"use client";

import { useState, useCallback, useEffect } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardContent } from "@/components/ui/Card";
import { CareTypeChip } from "@/components/ui/Chip";
import { ArrowLeft, CheckCircle, User } from "phosphor-react";
import {
  CARE_TYPES,
  MODULES,
  DEFAULT_MODULES_FOR_CARE_TYPE,
  CareType,
  Module,
} from "@/lib/constants.generated";
import { APIError, authApi, recipientApi, type AuthWorkspace } from "@/lib/api-client";

type Step = 1 | 2 | 3;

export default function OnboardingPage() {
  const t = useTranslations("onboarding");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState("");
  const [careType, setCareType] = useState<CareType | null>(null);
  const [enabledModules, setEnabledModules] = useState<Module[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The workspace is provisioned server-side on first login, so it should
  // always resolve. Track the load so the submit button can't fire before the
  // ID is known — the API rejects a create without X-Workspace-ID.
  const [workspace, setWorkspace] = useState<AuthWorkspace | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);

  useEffect(() => {
    authApi
      .me()
      .then((res) => {
        const list = res.data?.workspaces ?? [];
        const active = list.find((w) => w.active) ?? list[0] ?? null;
        setWorkspace(active);
      })
      .catch((err) => {
        console.error("onboarding: failed to resolve workspace", err);
      })
      .finally(() => setWorkspaceLoading(false));
  }, []);

  const handleCareTypeSelect = useCallback((type: CareType) => {
    setCareType(type);
    // Get default modules for this care type from generated constants
    const defaults = DEFAULT_MODULES_FOR_CARE_TYPE[type];
    if (defaults) {
      setEnabledModules([...defaults]);
    }
  }, []);

  const handleModuleToggle = useCallback((module: Module) => {
    setEnabledModules((prev) =>
      prev.includes(module) ? prev.filter((m) => m !== module) : [...prev, module]
    );
  }, []);

  const canSubmitStep2 = name.trim().length > 0 && careType !== null;
  const canSubmitStep3 = enabledModules.length > 0;

  const handleSubmit = async () => {
    if (!workspace) {
      setError(tCommon("error"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // Call the Go API with workspace header
      const res = await recipientApi.create(workspace.id, {
        full_name: name,
        care_type: careType!,
        enabled_modules: enabledModules,
      });

      if (!res.data) {
        throw new Error("create recipient failed");
      }

      // Redirect to dashboard using Next.js router
      router.push(`/${locale}/dashboard`);
      router.refresh();
    } catch (err) {
      // Show the API's own message when it has one — a bare "something went
      // wrong" hides real causes like a plan limit being hit.
      console.error("onboarding: create recipient failed", err);
      setError(err instanceof APIError ? err.message : tCommon("error"));
    } finally {
      setSubmitting(false);
    }
  };

  const backLabels = {
    1: "",
    2: t("welcome"),
    3: t("createProfile"),
  };

  return (
    <div className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        {/* Progress indicator (hidden on step 1) */}
        {step > 1 && (
          <div className="mb-6" role="progressbar" aria-valuenow={step - 1} aria-valuemin={1} aria-valuemax={2} aria-label={t("progressLabel")}>
            <div className="flex justify-between text-xs font-medium text-[var(--color-text-muted)] mb-1">
              <span>{t("step")} {step - 1} / 2</span>
              <span>{backLabels[step]}</span>
            </div>
            <div className="h-1.5 bg-[var(--color-border)] rounded-full overflow-hidden">
              <div
                className="h-full bg-[var(--color-accent)] transition-all duration-300"
                style={{ width: `${((step - 1) / 2) * 100}%` }}
              />
            </div>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-[var(--color-error-soft)] border border-[var(--color-error)] text-[var(--color-error-ink)] text-sm" role="alert">
            {error}
          </div>
        )}

        <Card>
          <CardContent className="space-y-6">
            {/* Step 1: Welcome */}
            {step === 1 && (
              <div className="text-center space-y-6">
                <div className="mx-auto w-16 h-16 rounded-2xl bg-[var(--color-accent-soft)] flex items-center justify-center">
                  <User size={32} weight="fill" className="text-[var(--color-accent)]" />
                </div>
                <div>
                  <h1 className="text-3xl font-semibold text-[var(--color-text)]">{t("welcome")}</h1>
                  <p className="mt-2 text-base text-[var(--color-text-muted)]">{t("welcomeSubtitle")}</p>
                </div>
                <Button className="w-full" size="default" onClick={() => setStep(2)}>
                  {t("getStarted")}
                </Button>
              </div>
            )}

            {/* Step 2: Create Profile */}
            {step === 2 && (
              <div className="space-y-6">
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="icon" onClick={() => setStep(1)} aria-label={t("back")}>
                    <ArrowLeft size={20} weight="thin" />
                  </Button>
                  <h2 className="text-2xl font-semibold text-[var(--color-text)] flex-1">{t("createProfile")}</h2>
                </div>

                <Input
                  label={t("nameLabel")}
                  placeholder={t("namePlaceholder")}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                  required
                  error={!name.trim() && step > 2 ? t("nameRequired") : undefined}
                />

                <fieldset className="space-y-3">
                  <legend className="text-base font-medium text-[var(--color-text)]">
                    {t("careTypeLabel")}
                  </legend>
                  <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label={t("careTypeLabel")}>
                    {CARE_TYPES.map((id) => (
                      <CareTypeChip
                        key={id}
                        type={id}
                        selected={careType === id}
                        onSelect={handleCareTypeSelect}
                        t={t}
                      />
                    ))}
                  </div>
                  {careType === null && name.trim().length > 0 && (
                    <p className="text-sm text-[var(--color-error)]" role="alert">
                      {t("careTypeRequired")}
                    </p>
                  )}
                </fieldset>

                <div className="flex gap-3">
                  <Button variant="secondary" className="flex-1" onClick={() => setStep(1)}>
                    {t("back")}
                  </Button>
                  <Button className="flex-1" disabled={!canSubmitStep2} onClick={() => setStep(3)}>
                    {t("next")}
                  </Button>
                </div>
              </div>
            )}

            {/* Step 3: Customize Modules */}
            {step === 3 && (
              <div className="space-y-6">
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="icon" onClick={() => setStep(2)} aria-label={t("back")}>
                    <ArrowLeft size={20} weight="thin" />
                  </Button>
                  <h2 className="text-2xl font-semibold text-[var(--color-text)] flex-1">{t("customizeModules")}</h2>
                </div>

                <p className="text-sm text-[var(--color-text-muted)]">{t("modulesHint")}</p>

                <fieldset className="space-y-2">
                  <legend className="text-base font-medium text-[var(--color-text)]">
                    {t("modulesLabel")}
                  </legend>
                  <div className="space-y-2 max-h-64 overflow-y-auto pr-2" role="group" aria-label={t("modulesLabel")}>
                    {MODULES.map((module) => (
                      <label
                        key={module}
                        className="flex items-center gap-3 p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] cursor-pointer transition-colors hover:bg-[var(--color-surface-hover)] touch-target"
                      >
                        <input
                          type="checkbox"
                          checked={enabledModules.includes(module)}
                          onChange={() => handleModuleToggle(module)}
                          className="w-5 h-5 shrink-0 rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-ring)]"
                        />
                        <span className="text-base text-[var(--color-text)]">{t(`modules.${module}`)}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <p className="text-xs text-[var(--color-text-muted)] text-center">{t("modulesCanChangeLater")}</p>

                <div className="flex gap-3">
                  <Button variant="secondary" className="flex-1" onClick={() => setStep(2)}>
                    {t("back")}
                  </Button>
                  <Button
                    className="flex-1"
                    loading={submitting}
                    disabled={!canSubmitStep3 || submitting || workspaceLoading || !workspace}
                    onClick={handleSubmit}
                  >
                    <CheckCircle size={18} weight="fill" className="mr-2" />
                    {t("createProfileSubmit")}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}