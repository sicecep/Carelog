"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Play, Square } from "phosphor-react";
import { api } from "@/lib/api-client";

interface ShiftActionsProps {
  workspaceId: string;
  caregiverId: string;
  isActive: boolean;
  onShiftChange: () => void;
}

export function ShiftActions({ workspaceId, caregiverId, isActive, onShiftChange }: ShiftActionsProps) {
  const t = useTranslations("shifts");
  const [loading, setLoading] = useState(false);

  const checkIn = useCallback(async () => {
    setLoading(true);
    try {
      await api.post("/api/v1/shifts/check-in", { caregiver_id: caregiverId }, { "X-Workspace-ID": workspaceId });
      onShiftChange();
    } catch (err) {
      console.error("check-in failed", err);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, caregiverId, onShiftChange]);

  const checkOut = useCallback(async () => {
    setLoading(true);
    try {
      await api.post("/api/v1/shifts/check-out", { caregiver_id: caregiverId }, { "X-Workspace-ID": workspaceId });
      onShiftChange();
    } catch (err) {
      console.error("check-out failed", err);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, caregiverId, onShiftChange]);

  return (
    <div className="fixed bottom-4 left-4 right-4 z-20">
      {isActive ? (
        <button
          onClick={checkOut}
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 py-4 text-lg font-semibold text-white shadow-lg touch-target"
        >
          <Square size={24} weight="fill" />
          {t("endShift")}
        </button>
      ) : (
        <button
          onClick={checkIn}
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-accent)] py-4 text-lg font-semibold text-white shadow-lg touch-target"
        >
          <Play size={24} weight="fill" />
          {t("startShift")}
        </button>
      )}
    </div>
  );
}
