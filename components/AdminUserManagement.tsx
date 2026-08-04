"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type UserRole = "admin" | "researcher";

export interface UserRecord {
  id: string;
  username: string;
  display_name: string | null;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
}

interface AdminUserManagementProps {
  currentUserId: string;
}

interface UserFormState {
  username: string;
  password: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
}

const EMPTY_CREATE_FORM: UserFormState = {
  username: "",
  password: "",
  displayName: "",
  role: "researcher",
  isActive: true,
};

function formatDate(value: string | null): string {
  if (!value) return "尚未登入";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as
    | { error?: string; message?: string }
    | null;
  return body?.error ?? body?.message ?? fallback;
}

async function requestUsers(signal?: AbortSignal): Promise<UserRecord[]> {
  const response = await fetch("/api/admin/users", {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, "無法讀取帳號清單。"));
  }
  const body = (await response.json()) as { users: UserRecord[] };
  return body.users;
}

export default function AdminUserManagement({
  currentUserId,
}: AdminUserManagementProps) {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<UserFormState>(EMPTY_CREATE_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<UserFormState | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const loadUsers = useCallback(async (signal?: AbortSignal) => {
    try {
      setUsers(await requestUsers(signal));
      setError(null);
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setError(loadError instanceof Error ? loadError.message : "無法讀取帳號清單。");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void requestUsers(controller.signal)
      .then((records) => {
        setUsers(records);
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : "無法讀取帳號清單。");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  function clearMessages() {
    setError(null);
    setSuccess(null);
  }

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearMessages();
    setBusy(true);
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: createForm.username.trim(),
          password: createForm.password,
          display_name: createForm.displayName.trim() || null,
          role: createForm.role,
        }),
      });
      if (!response.ok) {
        throw new Error(await errorMessage(response, "新增帳號失敗。"));
      }
      setCreateForm(EMPTY_CREATE_FORM);
      setShowCreate(false);
      setSuccess("帳號已新增。");
      await loadUsers();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "新增帳號失敗。");
    } finally {
      setBusy(false);
    }
  }

  function beginEdit(user: UserRecord) {
    clearMessages();
    setConfirmDeleteId(null);
    setEditingId(user.id);
    setEditForm({
      username: user.username,
      password: "",
      displayName: user.display_name ?? "",
      role: user.role,
      isActive: user.is_active,
    });
  }

  async function handleUpdate(event: React.FormEvent<HTMLFormElement>, user: UserRecord) {
    event.preventDefault();
    if (!editForm) return;
    clearMessages();
    setBusy(true);

    const changes: {
      username: string;
      password?: string;
      display_name: string | null;
      role: UserRole;
      is_active: boolean;
    } = {
      username: editForm.username.trim(),
      display_name: editForm.displayName.trim() || null,
      role: editForm.role,
      is_active: editForm.isActive,
    };
    if (editForm.password) changes.password = editForm.password;

    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });
      if (!response.ok) {
        throw new Error(await errorMessage(response, "修改帳號失敗。"));
      }
      if (user.id === currentUserId && editForm.password) {
        window.location.assign("/login");
        return;
      }
      setEditingId(null);
      setEditForm(null);
      setSuccess("帳號已更新。");
      await loadUsers();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "修改帳號失敗。");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(user: UserRecord) {
    clearMessages();
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(await errorMessage(response, "刪除帳號失敗。"));
      }
      setConfirmDeleteId(null);
      setSuccess(`已刪除帳號 ${user.username}。`);
      await loadUsers();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "刪除帳號失敗。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-4" aria-label="帳號清單">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          共 {users.length} 個帳號
        </p>
        <Button
          type="button"
          onClick={() => {
            clearMessages();
            setShowCreate((visible) => !visible);
          }}
          disabled={busy}
          aria-expanded={showCreate}
          aria-controls="create-user-form"
        >
          {showCreate ? <X aria-hidden /> : <Plus aria-hidden />}
          {showCreate ? "取消新增" : "新增帳號"}
        </Button>
      </div>

      <div aria-live="polite" className="sticky top-4 z-20 flex flex-col gap-3">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {success && (
          <Alert className="border-success/30 bg-success/5 text-success">
            <Check aria-hidden />
            <AlertDescription className="text-current">{success}</AlertDescription>
          </Alert>
        )}
      </div>

      {showCreate && (
        <form
          id="create-user-form"
          onSubmit={handleCreate}
          className="rounded-xl border border-border bg-card p-4 sm:p-5"
        >
          <h2 className="mb-4 font-semibold">新增帳號</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <FormField label="帳號" htmlFor="create-username">
              <Input
                id="create-username"
                autoComplete="off"
                autoFocus
                required
                maxLength={100}
                value={createForm.username}
                onChange={(event) =>
                  setCreateForm((form) => ({ ...form, username: event.target.value }))
                }
                disabled={busy}
              />
            </FormField>
            <FormField label="顯示名稱" htmlFor="create-display-name">
              <Input
                id="create-display-name"
                autoComplete="off"
                maxLength={100}
                value={createForm.displayName}
                onChange={(event) =>
                  setCreateForm((form) => ({ ...form, displayName: event.target.value }))
                }
                disabled={busy}
              />
            </FormField>
            <FormField label="密碼" htmlFor="create-password">
              <Input
                id="create-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={200}
                value={createForm.password}
                onChange={(event) =>
                  setCreateForm((form) => ({ ...form, password: event.target.value }))
                }
                disabled={busy}
              />
            </FormField>
            <FormField label="角色" htmlFor="create-role">
              <select
                id="create-role"
                value={createForm.role}
                onChange={(event) =>
                  setCreateForm((form) => ({
                    ...form,
                    role: event.target.value as UserRole,
                  }))
                }
                disabled={busy}
                className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
              >
                <option value="researcher">研究人員</option>
                <option value="admin">管理員</option>
              </select>
            </FormField>
          </div>
          <div className="mt-4 flex justify-end">
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
              建立帳號
            </Button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="flex min-h-48 items-center justify-center rounded-xl border border-border bg-card text-sm text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
          讀取帳號中…
        </div>
      ) : users.length === 0 ? (
        <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 text-center">
          <UserRound className="mb-3 text-muted-foreground" aria-hidden />
          <p className="font-medium">尚無帳號</p>
          <p className="mt-1 text-sm text-muted-foreground">請使用「新增帳號」建立第一個帳號。</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {users.map((user) => {
            const isCurrentUser = user.id === currentUserId;
            const isEditing = user.id === editingId && editForm;
            const isConfirmingDelete = user.id === confirmDeleteId;

            return (
              <article key={user.id} className="rounded-xl border border-border bg-card p-4 sm:p-5">
                {isEditing ? (
                  <form onSubmit={(event) => handleUpdate(event, user)}>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                      <FormField label="帳號" htmlFor={`edit-username-${user.id}`}>
                        <Input
                          id={`edit-username-${user.id}`}
                          required
                          autoFocus
                          maxLength={100}
                          value={editForm.username}
                          onChange={(event) =>
                            setEditForm((form) =>
                              form ? { ...form, username: event.target.value } : form,
                            )
                          }
                          disabled={busy}
                        />
                      </FormField>
                      <FormField label="顯示名稱" htmlFor={`edit-display-${user.id}`}>
                        <Input
                          id={`edit-display-${user.id}`}
                          maxLength={100}
                          value={editForm.displayName}
                          onChange={(event) =>
                            setEditForm((form) =>
                              form ? { ...form, displayName: event.target.value } : form,
                            )
                          }
                          disabled={busy}
                        />
                      </FormField>
                      <FormField label="新密碼（可留空）" htmlFor={`edit-password-${user.id}`}>
                        <Input
                          id={`edit-password-${user.id}`}
                          type="password"
                          autoComplete="new-password"
                          minLength={8}
                          maxLength={200}
                          value={editForm.password}
                          onChange={(event) =>
                            setEditForm((form) =>
                              form ? { ...form, password: event.target.value } : form,
                            )
                          }
                          disabled={busy}
                        />
                      </FormField>
                      <FormField label="角色" htmlFor={`edit-role-${user.id}`}>
                        <select
                          id={`edit-role-${user.id}`}
                          value={editForm.role}
                          onChange={(event) =>
                            setEditForm((form) =>
                              form
                                ? { ...form, role: event.target.value as UserRole }
                                : form,
                            )
                          }
                          disabled={busy || isCurrentUser}
                          title={isCurrentUser ? "不能修改自己的角色" : undefined}
                          className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <option value="researcher">研究人員</option>
                          <option value="admin">管理員</option>
                        </select>
                      </FormField>
                      <fieldset className="flex flex-col gap-2" disabled={busy || isCurrentUser}>
                        <legend className="text-sm font-medium">帳號狀態</legend>
                        <label className="flex h-8 items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={editForm.isActive}
                            onChange={(event) =>
                              setEditForm((form) =>
                                form ? { ...form, isActive: event.target.checked } : form,
                              )
                            }
                            className="size-4 accent-accent"
                          />
                          啟用
                        </label>
                      </fieldset>
                    </div>
                    {isCurrentUser && (
                      <p className="mt-3 text-xs text-muted-foreground">
                        為避免失去管理權限，不能修改自己的角色或啟用狀態；更改密碼後需重新登入。
                      </p>
                    )}
                    <div className="mt-4 flex flex-wrap justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setEditingId(null);
                          setEditForm(null);
                        }}
                        disabled={busy}
                      >
                        <X aria-hidden />
                        取消
                      </Button>
                      <Button type="submit" disabled={busy}>
                        {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
                        儲存修改
                      </Button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="font-semibold">{user.display_name || user.username}</h2>
                          {isCurrentUser && (
                            <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
                              目前帳號
                            </span>
                          )}
                          <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                            {user.role === "admin" ? "管理員" : "研究人員"}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs ${
                              user.is_active
                                ? "bg-success/10 text-success"
                                : "bg-destructive/10 text-destructive"
                            }`}
                          >
                            {user.is_active ? "已啟用" : "已停用"}
                          </span>
                        </div>
                        <p className="mt-1 break-all font-mono text-sm text-muted-foreground">
                          {user.username}
                        </p>
                        <dl className="mt-3 grid gap-x-6 gap-y-2 text-xs text-muted-foreground sm:grid-cols-2">
                          <div>
                            <dt className="inline font-medium text-foreground">建立時間：</dt>{" "}
                            <dd className="inline">{formatDate(user.created_at)}</dd>
                          </div>
                          <div>
                            <dt className="inline font-medium text-foreground">最後登入：</dt>{" "}
                            <dd className="inline">{formatDate(user.last_login_at)}</dd>
                          </div>
                        </dl>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => beginEdit(user)}
                          disabled={busy}
                        >
                          <Pencil aria-hidden />
                          修改
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          onClick={() => {
                            clearMessages();
                            setEditingId(null);
                            setEditForm(null);
                            setConfirmDeleteId(user.id);
                          }}
                          disabled={busy || isCurrentUser}
                          title={isCurrentUser ? "不能刪除目前帳號" : undefined}
                        >
                          <Trash2 aria-hidden />
                          刪除
                        </Button>
                      </div>
                    </div>

                    {isConfirmingDelete && (
                      <div
                        role="alert"
                        className="mt-4 flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <p className="text-sm text-destructive">
                          確定要刪除帳號「{user.username}」？此動作無法復原。
                        </p>
                        <div className="flex shrink-0 gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setConfirmDeleteId(null)}
                            disabled={busy}
                          >
                            取消
                          </Button>
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            onClick={() => void handleDelete(user)}
                            disabled={busy}
                          >
                            {busy ? (
                              <Loader2 className="animate-spin" aria-hidden />
                            ) : (
                              <Trash2 aria-hidden />
                            )}
                            確認刪除
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}

      {!loading && error && users.length === 0 && (
        <Button type="button" variant="outline" onClick={() => void loadUsers()} className="self-start">
          <RefreshCw aria-hidden />
          重新讀取
        </Button>
      )}
    </section>
  );
}

function FormField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
