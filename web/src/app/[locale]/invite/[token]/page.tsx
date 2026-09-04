"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import { invitationApi } from "@/lib/api-client";

export default function InviteClaimPage() {
  const t = useTranslations("invite");
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const claim = async () => {
    setLoading(true);
    try {
      const res = await invitationApi.claim(token);
      router.push(`/${res.data?.workspace_id}/dashboard`);
    } catch (err) {
      setError(t("errorClaiming"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card max-w-md mx-auto mt-20">
      <h1 className="text-xl font-bold mb-4">{t("title")}</h1>
      <p className="mb-6">{t("description")}</p>
      
      {error && <p className="text-red-500 mb-4">{error}</p>}
      
      <button 
        onClick={claim} 
        disabled={loading}
        className="btn-base btn-primary w-full"
      >
        {loading ? t("claiming") : t("accept")}
      </button>
    </div>
  );
}
