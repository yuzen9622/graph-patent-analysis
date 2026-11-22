"use client";

import { useState, type ReactElement } from "react";
import { Ellipsis, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import styles from "./history.module.css";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type HistoryKind = "chat" | "research" | "graph";
export type HistoryChanged = (kind: HistoryKind, id: string, deleted: boolean) => void;

export function HistoryMenu({ kind, id, title, pinned, onChanged, children, showRowActions }: {
  kind: HistoryKind; id: string; title: string; pinned?: boolean; onChanged: HistoryChanged;
  children: ReactElement; showRowActions?: boolean;
}) {
  const [dialog, setDialog] = useState<"rename" | "delete" | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(change: { title: string } | { pinned: boolean } | "delete") {
    if (busy) return;
    setBusy(true);
    const deleting = change === "delete";
    try {
      const path = deleting && kind === "graph" ? `/api/analyses/${id}` : `/api/history/${kind}/${id}`;
      const response = await fetch(path, deleting ? { method: "DELETE" } : {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(change),
      });
      if (!response.ok) throw new Error((await response.json()).error);
      setDialog(null);
      onChanged(kind, id, deleting);
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : "無法更新紀錄，請重試。");
    } finally { setBusy(false); }
  }

  function items(Item: typeof ContextMenuItem) {
    return <>
        <Item disabled={busy} onClick={() => void save({ pinned: !pinned })}>
          {pinned ? <PinOff /> : <Pin />}{pinned ? "取消釘選" : "釘選"}
        </Item>
        <Item onClick={() => { setName(title); setDialog("rename"); }}><Pencil />重新命名</Item>
        <Item variant="destructive" onClick={() => setDialog("delete")}><Trash2 />刪除</Item>
    </>;
  }

  return <>
    <ContextMenu>
      <ContextMenuTrigger render={children} />
      <ContextMenuContent>
        {items(ContextMenuItem)}
      </ContextMenuContent>
    </ContextMenu>
    {showRowActions && <div className={styles.actions}>
      <Button variant="ghost" size="icon-xs" className={styles.pin} disabled={busy} aria-pressed={!!pinned}
        aria-label={`${pinned ? "取消釘選" : "釘選"} ${title}`} onClick={() => void save({ pinned: !pinned })}>
        <Pin aria-hidden />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" />} aria-label={`${title}的更多操作`}><Ellipsis aria-hidden /></DropdownMenuTrigger>
        <DropdownMenuContent align="end">{items(DropdownMenuItem)}</DropdownMenuContent>
      </DropdownMenu>
    </div>}
    <Dialog open={dialog !== null} onOpenChange={open => { if (!open && !busy) setDialog(null); }}>
      <DialogContent>
        <form className="grid gap-4" onSubmit={event => {
          event.preventDefault();
          if (dialog === "delete") void save("delete");
          else if (name.trim()) void save({ title: name.trim() });
        }}>
          <DialogTitle>{dialog === "rename" ? "重新命名" : "刪除紀錄？"}</DialogTitle>
          <DialogDescription>{dialog === "rename" ? "輸入新的紀錄名稱。" : `「${title}」將被刪除，此操作無法復原。`}</DialogDescription>
          {dialog === "rename" && <Input aria-label="紀錄名稱" autoFocus maxLength={200} value={name} onFocus={event => event.target.select()} onChange={event => setName(event.target.value)} />}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setDialog(null)}>取消</Button>
            <Button type="submit" variant={dialog === "delete" ? "destructive" : "default"} disabled={busy || (dialog === "rename" && !name.trim())}>{dialog === "rename" ? "儲存" : "刪除紀錄"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
