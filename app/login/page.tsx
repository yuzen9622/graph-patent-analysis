"use client";

import { useState } from "react";
import { BarChart2, LogIn, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Only allow same-origin relative paths back from ?next=. */
function safeNextPath(): string {
  if (typeof window === "undefined") return "/";
  const raw = new URLSearchParams(window.location.search).get("next");
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "登入失敗，請再試一次。");
        setPending(false);
        return;
      }
      // Full navigation so the server re-renders with the new session cookie.
      window.location.assign(safeNextPath());
    } catch {
      setError("無法連線至伺服器，請稍後再試。");
      setPending(false);
    }
  }

  return (
    <main className="min-h-dvh bg-background text-foreground flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-8">
          <BarChart2 size={22} className="text-success" aria-hidden />
          <div>
            <h1 className="font-serif text-lg font-bold leading-tight">
              王老師專利知識圖譜分析平台
            </h1>
            <p className="text-[0.65rem] text-muted-foreground mt-0.5 font-mono tracking-wide">
              Patent Knowledge Graph Analysis
            </p>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-xl border border-border bg-card p-6 flex flex-col gap-4"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="username">帳號</Label>
            <Input
              id="username"
              name="username"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={pending}
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="password">密碼</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={pending}
              required
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <Button type="submit" disabled={pending} className="mt-1 w-full">
            {pending ? (
              <>
                <Loader2 size={16} className="animate-spin" aria-hidden />
                登入中…
              </>
            ) : (
              <>
                <LogIn size={16} aria-hidden />
                登入
              </>
            )}
          </Button>
        </form>

        <p className="text-xs text-muted-foreground mt-4 leading-relaxed">
          本平台為研究用途，帳號由系統管理者建立。若需要帳號或忘記密碼，請聯絡管理者。
        </p>
      </div>
    </main>
  );
}
