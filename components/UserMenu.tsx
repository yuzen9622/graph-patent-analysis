"use client";

import { useEffect, useState } from "react";
import { LogOut, User } from "lucide-react";

/**
 * Shows the signed-in account and a logout action. The session cookie is
 * httpOnly, so the username comes from /api/auth/me (populated by proxy.ts).
 */
export default function UserMenu() {
  const [username, setUsername] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { username?: string | null } | null) => {
        if (!cancelled && body?.username) setUsername(body.username);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!username) return null;

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.assign("/login");
  }

  return (
    <div className="ml-auto flex items-center gap-3">
      <span className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground">
        <User size={12} aria-hidden />
        {username}
      </span>
      <button
        type="button"
        onClick={handleLogout}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-full px-2.5 py-1 transition-colors"
      >
        <LogOut size={12} aria-hidden />
        登出
      </button>
    </div>
  );
}
