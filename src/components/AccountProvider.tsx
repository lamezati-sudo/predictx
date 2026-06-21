"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useGameStore, type PredictionRow, type ProfileRow } from "@/store/game-store";

/**
 * Loads the authenticated user's profile + predictions from Supabase and keeps
 * them in sync in realtime. Mount once near the root of the authed app.
 */
export function AccountProvider({ children }: { children: React.ReactNode }) {
  const setUser           = useGameStore((s) => s.setUser);
  const syncProfile       = useGameStore((s) => s.syncProfile);
  const syncPredictions   = useGameStore((s) => s.syncPredictions);
  const upsertPrediction  = useGameStore((s) => s.upsertPrediction);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      setUser(user.id, (user.user_metadata?.username as string) ?? null);

      const [{ data: profile }, { data: preds }] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", user.id).single(),
        supabase.from("predictions").select("*").order("opened_at", { ascending: false }).limit(100),
      ]);
      if (cancelled) return;
      if (profile) syncProfile(profile as ProfileRow);
      if (preds)   syncPredictions(preds as PredictionRow[]);

      // Realtime — profile balance/stats
      const channel = supabase
        .channel("account")
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${user.id}` },
          (payload) => syncProfile(payload.new as ProfileRow)
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "predictions", filter: `user_id=eq.${user.id}` },
          (payload) => {
            if (payload.new && Object.keys(payload.new).length) {
              upsertPrediction(payload.new as PredictionRow);
            }
          }
        )
        .subscribe();

      return () => { supabase.removeChannel(channel); };
    }

    const cleanupPromise = init();
    return () => {
      cancelled = true;
      cleanupPromise.then((fn) => fn?.());
    };
  }, [setUser, syncProfile, syncPredictions, upsertPrediction]);

  return <>{children}</>;
}
