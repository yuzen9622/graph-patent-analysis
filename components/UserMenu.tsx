"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LogOut, Settings, User } from "lucide-react";

interface SessionUser {
  username: string;
  role: "admin" | "researcher";
}

/**
 * Shows the signed-in account and a logout action. The session cookie is
 * httpOnly, so the username comes from /api/auth/me (populated by proxy.ts).
 */
export default function UserMenu() {
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((body: Partial<SessionUser> | null) => {
        if (
          !cancelled &&
          body?.username &&
          (body.role === "admin" || body.role === "researcher")
        ) {
          setUser({ username: body.username, role: body.role });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!user) return null;

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.assign("/login");
  }

  return (
    <div className="ml-auto flex items-center gap-2 sm:gap-3">
      <span className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground">
        <User size={12} aria-hidden />
        {user.username}
      </span>
      {user.role === "admin" && (
        <Link
          href="/admin/users"
          className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Settings size={12} aria-hidden />
          帳號管理
        </Link>
      )}
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
