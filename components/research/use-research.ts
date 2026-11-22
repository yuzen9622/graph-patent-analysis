"use client";

import { useCallback, useEffect, useRef, useEffectEvent, useState } from "react";
import { useExternalStoreRuntime, type AppendMessage, type AttachmentAdapter, type CompleteAttachment, type ThreadMessageLike } from "@assistant-ui/react";
import { z } from "zod";
import { DEFAULT_LIMITS, validateUploadFiles } from "@/lib/analyze-limits";
import { isJobActive, latestResearchJob, proposalEventSchema, searchPlanSchema, researchJobSchema, type ResearchJob, type SearchPlan } from "@/lib/patent-search/contracts";

export interface ResearchMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  chunks: string[];
  phase: "planning" | "ready" | "error";
  job?: ResearchJob;
  error?: string;
  retryPrompt?: string;
  contextPlan?: SearchPlan | null;
  attachments?: readonly CompleteAttachment[];
}

const chatMessages = z.object({
  title: z.string().nullable(),
  messages: z.array(z.object({
    id: z.string(), role: z.enum(["user", "assistant"]), text: z.string(), chunks: z.array(z.string()),
    phase: z.enum(["ready", "planning", "error"]), job: researchJobSchema.optional(),
    error: z.string().optional(), retryPrompt: z.string().optional(), contextPlan: searchPlanSchema.nullish(),
  })),
});
const serviceSchema = z.object({ chats: z.array(z.object({ id: z.string(), title: z.string().nullable(), pinned: z.boolean(), preview: z.string(), updated_at: z.string() })), workerAvailable: z.boolean(), modelAvailable: z.boolean(), jobs: z.array(z.object({ id: z.string().uuid(), pinned: z.boolean(), title: z.string().nullable(), summary: z.string(), keywords: z.array(z.string()).nullish().transform(value => value ?? []), status: z.string(), created_at: z.string() })) });
type Service = z.infer<typeof serviceSchema>;
const jobResponse = z.object({ job: researchJobSchema });

async function responseData(response: Response): Promise<unknown> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(body);
    throw new Error(error.success ? error.data.error : "研究服務未回應，請稍後重試。");
  }
  return body;
}

async function fetchJob(url: string, init?: RequestInit) {
  return jobResponse.parse(await responseData(await fetch(url, init))).job;
}

const attachmentAdapter: AttachmentAdapter = {
  accept: ".xlsx",
  async add({ file }) {
    const failure = validateUploadFiles([{ name: file.name, size: file.size }], DEFAULT_LIMITS);
    if (failure) throw new Error(failure.error);
    return { id: crypto.randomUUID(), type: "document", name: file.name, contentType: file.type, file, status: { type: "requires-action", reason: "composer-send" } };
  },
  async send(attachment, options) {
    options?.signal?.throwIfAborted();
    return { ...attachment, status: { type: "complete" }, content: [] };
  },
  async remove() { /* Files stay in the composer only; there is no remote upload to delete. */ },
};

export function useResearchService() {
  const [service, setService] = useState<Service | null>(null);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const latestRequest = useRef(0);
  const refreshService = useCallback(() => {
    const request = ++latestRequest.current;
    return fetch("/api/patent-search", { cache: "no-store" })
      .then(responseData)
      .then(data => {
        if (request !== latestRequest.current) return;
        setService(serviceSchema.parse(data));
        setServiceError(null);
      })
      .catch((error: unknown) => {
        if (request === latestRequest.current) setServiceError(error instanceof Error ? error.message : "研究服務無法連線。");
      });
  }, []);

  useEffect(() => { void refreshService(); }, [refreshService]);
  useEffect(() => {
    if (service?.workerAvailable !== false) return;
    const timer = setInterval(refreshService, 5000);
    return () => clearInterval(timer);
  }, [service?.workerAvailable, refreshService]);
  return { service, serviceError, refreshService };
}

export function useResearch({ initialJobId, chatId, onSelectChat, onSelectJob, onImportFiles, shared }: {
  shared: ReturnType<typeof useResearchService>;
  initialJobId: string | null;
  chatId: string | null;
  onSelectChat: (id: string) => void;
  onSelectJob: (id: string | null) => void;
  onImportFiles: (files: File[]) => Promise<void>;
}) {
  const { service, serviceError, refreshService } = shared;
  const [messages, setMessages] = useState<ResearchMessage[]>([]);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const liveChat = useRef<string | null>(null);
  const [loadedChat, setLoadedChat] = useState<string | null>(null);
  const [chatTitle, setChatTitle] = useState<string | null>(null);
  const planningId = messages.find((message) => message.phase === "planning")?.id;
  const activeId = messages.find((message) => message.job && isJobActive(message.job.status))?.job?.id;
  const restoring = Boolean(chatId && loadedChat !== chatId && !connectionError) || Boolean(initialJobId && !messages.some((message) => message.job?.id === initialJobId) && !connectionError);

  const mergeJob = useCallback((job: ResearchJob) => {
    setMessages((previous) => {
      if (previous.some((message) => message.job?.id === job.id)) {
        return previous.map((message) => {
          if (message.job?.id !== job.id) return message;
          const next = latestResearchJob(message.job, job);
          return next === message.job ? message : { ...message, job: next, error: undefined };
        });
      }
      return [...previous,
        { id: `request-${job.id}`, role: "user", text: job.prompt, chunks: [], phase: "ready" },
        { id: `job-${job.id}`, role: "assistant", text: job.summary, chunks: [job.summary], phase: "ready", job },
      ];
    });
  }, []);

  const selectRestoredChat = useEffectEvent(onSelectChat);
  useEffect(() => {
    if (!initialJobId) return;
    const controller = new AbortController();
    void fetch(`/api/patent-search/${encodeURIComponent(initialJobId)}/chat`, { method: "POST", signal: controller.signal })
      .then(responseData)
      .then(data => {
        const { chatId } = z.object({ chatId: z.string().uuid() }).parse(data);
        if (!controller.signal.aborted) selectRestoredChat(chatId);
      })
      .catch(error => { if (!controller.signal.aborted) setConnectionError(error instanceof Error ? error.message : "無法載入研究。"); });
    return () => controller.abort();
  }, [initialJobId]);
  useEffect(() => {
    if (!chatId || liveChat.current === chatId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const response = await fetch(`/api/research-chats/${chatId}`, { cache: "no-store", signal: controller.signal });
        const chat = chatMessages.parse(await responseData(response));
        if (controller.signal.aborted) return;
        setMessages(chat.messages);
        setChatTitle(chat.title);
        setLoadedChat(chatId);
        setConnectionError(null);
        if (chat.messages.some(message => message.phase === "planning")) timer = setTimeout(load, 1500);
        else void refreshService();
      } catch (error) {
        if (!controller.signal.aborted) setConnectionError(error instanceof Error ? error.message : "無法載入對話。");
      }
    }
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [chatId, refreshService]);
  useEffect(() => () => { requestRef.current?.abort(); }, []);

  useEffect(() => {
    if (!activeId) return;
    const source = new EventSource(`/api/patent-search/${activeId}/events`);
    source.onopen = () => setConnectionError(null);
    source.addEventListener("job", (event: MessageEvent) => {
      try {
        const job = researchJobSchema.parse(JSON.parse(event.data));
        mergeJob(job); setConnectionError(null);
        if (!isJobActive(job.status)) { source.close(); void refreshService(); }
      } catch { source.close(); setConnectionError("研究狀態格式不正確，請重新載入。"); }
    });
    source.addEventListener("unavailable", () => { source.close(); setConnectionError("研究狀態無法讀取，請重新載入或登入。"); });
    source.onerror = () => setConnectionError("狀態連線中斷，正在重新連線。任務仍由伺服器處理。");
    return () => source.close();
  }, [activeId, mergeJob, refreshService]);

  async function propose(prompt: string, contextPlan?: SearchPlan | null) {
    if (requestRef.current || initialJobId || (chatId && loadedChat !== chatId)) return;
    const previousPlan = contextPlan === undefined ? [...messages].reverse().find((message) => message.job)?.job?.plan ?? null : contextPlan;
    const conversation = chatId ?? liveChat.current ?? crypto.randomUUID();
    liveChat.current = conversation;
    setLoadedChat(conversation);
    if (!chatId) onSelectChat(conversation);
    setMessages(previous => [...previous, { id: crypto.randomUUID(), role: "user", text: prompt, chunks: [], phase: "ready" }]);
    const id = crypto.randomUUID();
    const cancellation = new AbortController();
    requestRef.current = cancellation;
    setMessages((previous) => [...previous, { id, role: "assistant", text: "", chunks: [], phase: "planning", retryPrompt: prompt, contextPlan: previousPlan }]);
    const update = (patch: Partial<ResearchMessage>) => setMessages((previous) => previous.map((message) => message.id === id ? { ...message, ...patch } : message));
    try {
      const response = await fetch("/api/patent-search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "guided", chatId: conversation, prompt, contextPlan: previousPlan ?? undefined }), signal: cancellation.signal });
      if (!response.ok) await responseData(response);
      if (!response.body) throw new Error("研究服務沒有傳回內容。");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = false;
      try {
        while (true) {
          const { value, done } = await reader.read();
          buffer += decoder.decode(value, { stream: !done });
          if (buffer.length > 65_536) throw new Error("研究回應超過預期大小。");
          const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            cancellation.signal.throwIfAborted();
            const event = proposalEventSchema.parse(JSON.parse(line));
            if (event.type === "text") {
              setMessages((previous) => previous.map((message) => {
                if (message.id !== id) return message;
                const chunks = event.text.startsWith(message.text) ? [...message.chunks, event.text.slice(message.text.length)].filter(Boolean) : [event.text];
                return { ...message, text: event.text, chunks };
              }));
            } else if (event.type === "reply") {
              completed = true;
              update({ phase: "ready", text: event.text, chunks: [event.text] });
            } else if (event.type === "proposal") {
              completed = true;
              update({ phase: "ready", text: event.job.summary, job: event.job });

            } else if (event.type === "error") throw new Error(event.message);
          }
          if (done) break;
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      if (!completed) throw new Error("搜尋規劃回應中斷，尚未執行任何檢索。");
    } catch (error) {
      update({ phase: "error", error: cancellation.signal.aborted ? "已停止搜尋規劃，尚未執行檢索。" : error instanceof Error ? error.message : "搜尋規劃失敗。" });
    } finally {
      if (requestRef.current === cancellation) requestRef.current = null;
      void refreshService();
    }
  }

  async function onNew(message: AppendMessage) {
    const text = message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n").trim();
    const attachments = message.attachments ?? [];
    const files = attachments.map((attachment) => attachment.file).filter((file): file is File => Boolean(file));
    if (files.length) {
      setMessages((previous) => [...previous, { id: crypto.randomUUID(), role: "user", text: text || "匯入 Excel 資料", chunks: [], phase: "ready", attachments: message.attachments }]);
      setImporting(true);
      try {
        await onImportFiles(files);
        setMessages((previous) => [...previous, { id: crypto.randomUUID(), role: "assistant", text: "已將附件交給匯入流程。請在匯入資料頁確認欄位、解析結果與分析筆數；附件內容沒有傳送給搜尋模型。", chunks: [], phase: "ready" }]);
      } finally { setImporting(false); }
      return;
    }
    if (text) await propose(text);
  }

  async function act(job: ResearchJob, action: "approve" | "cancel", plan?: SearchPlan) {
    if (pendingAction) return;
    setPendingAction(job.id);
    try {
      const next = await fetchJob(`/api/patent-search/${job.id}`, action === "cancel" ? { method: "DELETE" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: job.revision, plan }) });
      mergeJob(next);
    } catch (error) {
      setMessages((previous) => previous.map((message) => message.job?.id === job.id ? { ...message, error: error instanceof Error ? error.message : "研究操作失敗。" } : message));
      void refreshService();
    } finally { setPendingAction(null); }
  }

  async function structured(plan: SearchPlan) {
    if (pendingAction || planningId || activeId || initialJobId || (chatId && loadedChat !== chatId)) return;
    setPendingAction("structured");
    try {
      const conversation = chatId ?? liveChat.current ?? crypto.randomUUID();
      const job = await fetchJob("/api/patent-search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "structured", chatId: conversation, plan }) });
      liveChat.current = conversation; setLoadedChat(conversation);
      mergeJob(job);
      if (!chatId) onSelectChat(conversation);
      void refreshService();
    } finally { setPendingAction(null); }
  }

  async function importArtifact(job: ResearchJob) {
    if (!job.artifact) return;
    setImporting(true);
    try {
      const response = await fetch(`/api/patent-search/${job.id}/download`);
      if (!response.ok) await responseData(response);
      await onImportFiles([new File([await response.blob()], job.artifact.filename, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })]);
    } catch (error) { setConnectionError(error instanceof Error ? error.message : "無法匯入檔案。"); }
    finally { setImporting(false); }
  }

  async function downloadArtifact(job: ResearchJob) {
    if (!job.artifact) return;
    try {
      const response = await fetch(`/api/patent-search/${job.id}/download`);
      if (!response.ok) await responseData(response);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url; link.download = job.artifact.filename;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setConnectionError(error instanceof Error ? error.message : "無法下載檔案。"); }
  }

  const runtime = useExternalStoreRuntime<ResearchMessage>({
    messages,
    convertMessage: (message): ThreadMessageLike => ({ id: message.id, role: message.role, content: message.text, attachments: message.attachments, ...(message.role === "assistant" ? { status: message.phase === "planning" ? { type: "running" } : { type: "complete", reason: "stop" } } : {}) }),
    isRunning: Boolean(planningId || activeId || importing),
    isLoading: restoring,
    isSendDisabled: Boolean(planningId || activeId || importing || pendingAction || restoring || initialJobId || (chatId && loadedChat !== chatId)),
    onNew,
    onCancel: async () => {
      if (requestRef.current) requestRef.current.abort();
      const job = messages.find((message) => message.job?.id === activeId)?.job;
      if (job) await act(job, "cancel");
    },
    adapters: { attachments: attachmentAdapter },
  });

  return { title: chatId ? service?.chats.find(chat => chat.id === chatId)?.title ?? chatTitle : null, runtime, messages, service, serviceError, connectionError, pendingAction, importing, restoring, planning: Boolean(planningId), active: Boolean(activeId), refreshService, propose, act, structured, importArtifact, downloadArtifact,
    openJob: (id: string) => {
      if (id === initialJobId) return;
      liveChat.current = null; setLoadedChat(null); setChatTitle(null);
      setMessages([]);
      setConnectionError(null);
      onSelectJob(id);
    },
    openChat: (id: string) => {
      if (id === chatId) return;
      liveChat.current = null; setLoadedChat(null); setChatTitle(null); setConnectionError(null); setMessages([]); onSelectChat(id);
    },
    reset: () => { if (!planningId && !activeId && !importing) { liveChat.current = null; setLoadedChat(null); setChatTitle(null); setMessages([]); onSelectJob(null); setConnectionError(null); } },
  };
}

export type ResearchController = ReturnType<typeof useResearch>;
