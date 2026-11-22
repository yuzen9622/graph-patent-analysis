"use client";

import { ZodError } from "zod";
import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { validateSearchPlan, type SearchPlan } from "@/lib/patent-search/contracts";
import styles from "./research.module.css";

export interface SearchDraft {
  exactApplicants?: boolean; keywords: string; match: "all" | "any"; applicants: string; dateField: "filing" | "publication";
  dateFrom: string; dateTo: string; ipc: string; limit: string;
}

export function draftFromPlan(plan?: SearchPlan): SearchDraft {
  return { exactApplicants: plan?.exactApplicants, keywords: plan?.keywords.join("、") ?? "", match: plan?.match ?? "all", applicants: plan?.applicants.join("\n") ?? "",
    dateField: plan?.dateField ?? "filing", dateFrom: plan?.dateFrom ?? "", dateTo: plan?.dateTo ?? "", ipc: plan?.ipc.join("、") ?? "", limit: String(plan?.limit ?? "") };
}

export function planFromDraft(draft: SearchDraft) {
  const split = (value: string) => value.split(/[、,，\n]+/).map((part) => part.trim()).filter(Boolean);
  return validateSearchPlan({ exactApplicants: draft.exactApplicants, keywords: split(draft.keywords), match: draft.match, applicants: draft.applicants.split("\n").map((name) => name.trim()).filter(Boolean),
    dateField: draft.dateField, dateFrom: draft.dateFrom || null, dateTo: draft.dateTo || null, ipc: split(draft.ipc), sort: "relevance", limit: draft.limit.trim() ? Number(draft.limit) : null });
}

export function SearchFields({ draft, onChange, disabled = false }: { draft: SearchDraft; onChange: (draft: SearchDraft) => void; disabled?: boolean }) {
  const id = useId();
  const set = (key: keyof SearchDraft, value: string) => onChange({ ...draft, [key]: value });
  return (
    <div className={styles.fields}>
      <div className={styles.wideField}><Label htmlFor={`${id}-keywords`}>主題關鍵字（選填，以逗號分隔）</Label><Input id={`${id}-keywords`} value={draft.keywords} onChange={(event) => set("keywords", event.target.value)} disabled={disabled} placeholder="金融、支付" /></div>
      <div><Label htmlFor={`${id}-match`}>關鍵字關係</Label><Select value={draft.match} onValueChange={(value) => { if (value) onChange({ ...draft, match: value === "all" ? "all" : "any" }); }} disabled={disabled}><SelectTrigger id={`${id}-match`} className="w-full"><SelectValue>{draft.match === "all" ? "全部符合（AND）" : "任一符合（OR）"}</SelectValue></SelectTrigger><SelectContent><SelectItem value="all">全部符合（AND）</SelectItem><SelectItem value="any">任一符合（OR）</SelectItem></SelectContent></Select></div>
      <div><Label htmlFor={`${id}-limit`}>取得筆數（選填）</Label><Input id={`${id}-limit`} type="number" min={1} placeholder="全部" value={draft.limit} onChange={(event) => set("limit", event.target.value)} disabled={disabled} /></div>
      <div className={styles.wideField}><Label htmlFor={`${id}-applicants`}>申請人（選填，每行一個）</Label><Textarea id={`${id}-applicants`} rows={2} value={draft.applicants} onChange={(event) => set("applicants", event.target.value)} disabled={disabled} placeholder="留空則不限申請人" /></div>
      <div><Label htmlFor={`${id}-datefield`}>日期條件</Label><Select value={draft.dateField} onValueChange={(value) => { if (value) onChange({ ...draft, dateField: value === "filing" ? "filing" : "publication" }); }} disabled={disabled}><SelectTrigger id={`${id}-datefield`} className="w-full"><SelectValue>{draft.dateField === "filing" ? "申請日" : "公開／公告日"}</SelectValue></SelectTrigger><SelectContent><SelectItem value="filing">申請日</SelectItem><SelectItem value="publication">公開／公告日</SelectItem></SelectContent></Select></div>
      <div><Label htmlFor={`${id}-ipc`}>IPC（選填）</Label><Input id={`${id}-ipc`} value={draft.ipc} onChange={(event) => set("ipc", event.target.value)} disabled={disabled} placeholder="例如 G06Q" /></div>
      <div><Label htmlFor={`${id}-from`}>起始日期（選填）</Label><Input id={`${id}-from`} type="date" value={draft.dateFrom} onChange={(event) => set("dateFrom", event.target.value)} disabled={disabled} /></div>
      <div><Label htmlFor={`${id}-to`}>結束日期（選填）</Label><Input id={`${id}-to`} type="date" value={draft.dateTo} onChange={(event) => set("dateTo", event.target.value)} disabled={disabled} /></div>
      <p className={`${styles.wideField} ${styles.fieldNote}`}>搜尋專利名稱與摘要，按官方關聯度排序。留空會取得全部符合條件的專利。</p>
    </div>
  );
}

export function fieldError(error: unknown) {
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    if (issue?.code === "custom") return issue.message;
    if (issue?.path[0] === "limit") return "取得筆數請輸入 正整數，或留空取得全部。";
    if (issue?.path[0] === "keywords") return "最多可填 8 組主題關鍵字，每組最多 100 字。";
    return "搜尋條件格式不正確，請檢查日期、IPC 或申請人欄位。";
  }
  return error instanceof Error ? error.message : "無法處理搜尋條件。";
}

