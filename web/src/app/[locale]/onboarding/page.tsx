"use client";

import { useState, useCallback, useEffect } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardContent } from "@/components/ui/Card";
import { CareTypeChip } from "@/components/ui/Chip";
import { ArrowLeft, CheckCircle, User } from "phosphor-react";
import {
  CARE_TYPES,
  DEFAULT_MODULES_FOR_CARE_TYPE,
  CareType,
  Module,
} from "@/lib/constants.generated";
import { APIError, authApi, recipientApi, type AuthWorkspace } from "@/lib/api-client";
import { RecipientDetailsFields } from "@/components/ui/RecipientDetailsFields";
import { ModulePicker } from "@/components/ui/ModulePicker";
import {
  EMPTY_RECIPIENT_DETAILS,
  parseRecipientDetails,
  type RecipientDetailsDraft,
  type RecipientDetailsErrors,
} from "@/lib/recipient-details";

type Step = 1 | 2 | 3;

export default function OnboardingPage() {
  const t = useTranslations("onboarding");
  const tCommon = useTranslations("common");
  const tNav = useTranslations("nav");
  const locale = useLocale();
  const router = useRouter();
  // ?new=1 arrives from the Add Recipient button on an existing workspace:
  // skip the welcome intro and start at the form. First-time users (no
  // recipients yet, routed here after login) still get the intro.
  const directAdd = useSearchParams().get("new") === "1";
  const [step, setStep] = useState<Step>(directAdd ? 2 : 1);
  const [name, setName] = useState("");
  const [careType, setCareType] = useState<CareType | null>(null);
  const [enabledModules, setEnabledModules] = useState<Module[]>([]);
  const [details, setDetails] = useState<RecipientDetailsDraft>(EMPTY_RECIPIENT_DETAILS);
  const [detailErrors, setDetailErrors] = useState<RecipientDetailsErrors>({});
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
        if (!active) {
          console.warn("onboarding: no workspace found for user");
        }
      })
      .catch((err) => {
        console.error("onboarding: failed to resolve workspace", err);
        if (err instanceof APIError && err.status === 401) {
          router.push(`/${locale}/login`);
        }
      })
      .finally(() => setWorkspaceLoading(false));
  }, [locale, router]);

  const handleCareTypeSelect = useCallback((type: CareType) => {
    setCareType(type);
    // Pre-select the care type's suggested modules; step 3 still offers
    // every module, and the owner may switch any of them on.
    const defaults = DEFAULT_MODULES_FOR_CARE_TYPE[type];
    if (defaults) {
      setEnabledModules([...defaults]);
    }
  }, []);

  const canSubmitStep2 = name.trim().length > 0 && careType !== null;
  const canSubmitStep3 = enabledModules.length > 0;

  // Step 2 -> 3: the optional details must be valid (or empty) to continue.
  const handleStep2Next = () => {
    const { errors } = parseRecipientDetails(details);
    setDetailErrors(errors);
    if (Object.keys(errors).length === 0) setStep(3);
  };

  const handleSubmit = async () => {
    if (!workspace) {
      setError(tCommon("error"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // Call the Go API with workspace header
      const { values } = parseRecipientDetails(details);
      const res = await recipientApi.create(workspace.id, {
        full_name: name,
        care_type: careType!,
        enabled_modules: enabledModules,
        // Empty optional fields are left out rather than sent as blanks.
        ...(values.gender && { gender: values.gender }),
        ...(values.date_of_birth && { date_of_birth: values.date_of_birth }),
        ...(values.weight_kg != null && { weight_kg: values.weight_kg }),
        ...(values.height_cm != null && { height_cm: values.height_cm }),
      });

      if (!res.data) {
        throw new Error("create recipient failed");
      }

      // First-time users land on the dashboard afterwards; an add-in-place
      // flow returns to the list they started from.
      router.push(directAdd ? `/${locale}/recipients` : `/${locale}/dashboard`);
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

  // Where "back" from each step leads. Step 2 normally returns to the welcome
  // intro; in direct-add mode there is no intro, so it exits to the
  // recipients list instead.
  const exitStep2 = useCallback(() => {
    if (directAdd) router.push(`/${locale}/recipients`);
    else setStep(1);
  }, [directAdd, locale, router]);

  const backLabels = {
    1: "",
    2: directAdd ? tNav("recipients") : t("welcome"),
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
                  <Button variant="ghost" size="icon" onClick={exitStep2} aria-label={t("back")}>
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

                <RecipientDetailsFields
                  idPrefix="onboarding-details"
                  value={details}
                  onChange={(next) => {
                    setDetails(next);
                    setDetailErrors({});
                  }}
                  errors={detailErrors}
                />

                <div className="flex gap-3">
                  <Button variant="secondary" className="flex-1" onClick={exitStep2}>
                    {t("back")}
                  </Button>
                  <Button className="flex-1" disabled={!canSubmitStep2} onClick={handleStep2Next}>
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
                  <ModulePicker value={enabledModules} onChange={setEnabledModules} label={t("modulesLabel")} />
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