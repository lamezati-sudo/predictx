"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Mode = "login" | "signup";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [mode, setMode]         = useState<Mode>("login");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError]       = useState<string | null>(null);
  const [info, setInfo]         = useState<string | null>(null);
  const [busy, setBusy]         = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);

    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { username: username || email.split("@")[0] } },
        });
        if (error) throw error;
        // If email confirmation is on, there's no session yet
        if (!data.session) {
          setInfo("Check your email to confirm your account, then log in.");
          setMode("login");
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#080808] px-4 text-[#e2e2e2]">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight">
            Predict<span className="text-[#00c47a]">X</span>
          </h1>
          <p className="mt-1 text-xs text-[#555]">
            Gamified prediction trading — BTC · ETH · SOL
          </p>
        </div>

        <div className="rounded-2xl border border-[#1a1a1a] bg-[#0d0d0d] p-6">
          {/* Tabs */}
          <div className="mb-5 flex rounded-lg border border-[#1a1a1a] p-1">
            {(["login", "signup"] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setError(null); setInfo(null); }}
                className="flex-1 rounded-md py-2 text-xs font-semibold uppercase tracking-widest transition-all"
                style={{
                  background: mode === m ? "#1a1a1a" : "transparent",
                  color:      mode === m ? "#e2e2e2" : "#444",
                }}
              >
                {m === "login" ? "Log in" : "Sign up"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            {mode === "signup" && (
              <Field label="Username" >
                <input
                  type="text" value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="trader_42"
                  className="auth-input"
                />
              </Field>
            )}
            <Field label="Email">
              <input
                type="email" required value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="auth-input"
              />
            </Field>
            <Field label="Password">
              <input
                type="password" required value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••" minLength={6}
                className="auth-input"
              />
            </Field>

            {error && (
              <p className="rounded-md bg-[#ff3b5b15] px-3 py-2 text-xs text-[#ff3b5b]">{error}</p>
            )}
            {info && (
              <p className="rounded-md bg-[#00c47a15] px-3 py-2 text-xs text-[#00c47a]">{info}</p>
            )}

            <button
              type="submit" disabled={busy}
              className="w-full rounded-lg bg-[#00c47a] py-3 text-sm font-bold uppercase tracking-widest text-black transition-all hover:bg-[#00d886] disabled:opacity-50"
            >
              {busy ? "…" : mode === "login" ? "Log in" : "Create account"}
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-[10px] text-[#333]">
          Play-money demo. New accounts start with $10,000.
        </p>
      </div>

      <style jsx>{`
        :global(.auth-input) {
          width: 100%;
          border-radius: 0.5rem;
          border: 1px solid #1e1e1e;
          background: #0a0a0a;
          padding: 0.625rem 0.75rem;
          font-size: 0.875rem;
          color: #fff;
          outline: none;
        }
        :global(.auth-input:focus) { border-color: #2e2e2e; }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-[#3a3a3a]">
        {label}
      </span>
      {children}
    </label>
  );
}
