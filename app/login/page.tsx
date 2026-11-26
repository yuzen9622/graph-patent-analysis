"use client";

import styles from "./login.module.css";
import { useState } from "react";
import { LogIn, Loader2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
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
    <main>
      <a href="#username" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4">跳至登入表單</a>
      <section className={styles.page} aria-labelledby="login-title">
        <div className={styles.content}>
          <header className="grid gap-4">
            <p>專利研究室</p>
            <h1 id="login-title" className="text-3xl font-semibold">臺灣專利檢索與分析</h1>
            <p className="hidden text-muted-foreground md:block">查詢專利或匯入 Excel，查看申請人、專利與技術概念之間的關係。</p>
          </header>
          <Card>
            <CardHeader>
              <CardDescription>王老師專利知識圖譜分析平台</CardDescription>
              <CardTitle><h2>登入研究平台</h2></CardTitle>
            </CardHeader>
            <CardContent>
              <form
              onSubmit={handleSubmit}
              className="flex flex-col gap-6"
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor="username">帳號</Label>
                <Input
                  id="username"
                  name="username"
                  autoComplete="username"
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

            </CardContent>
            <CardFooter><CardDescription>本平台供研究使用。如需帳號或忘記密碼，請聯絡管理員。</CardDescription></CardFooter>
          </Card>
        </div>
      </section>
    </main>
  );
}
