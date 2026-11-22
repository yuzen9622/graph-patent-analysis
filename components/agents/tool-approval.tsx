"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
// beui.dev/components/agents/tool-approval

import {
  Check,
  ChevronDown,
  CircleAlert,
  LoaderCircle,
  ShieldCheck,
  X,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  AgentCode,
  type AgentCodeLanguage,
} from "@/components/agents/agent-code";
import { AgentDisclosure } from "@/components/agents/agent-disclosure";
import { EASE_OUT, SPRING_SWAP } from "@/lib/ease";
import { useMessages } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type ToolApprovalStatus =
  | "pending"
  | "approving"
  | "approved"
  | "denied"
  | "running"
  | "complete"
  | "error";

/** English defaults. Override per instance with `labels`, or app-wide with `LocaleProvider`. */
export const toolApprovalMessages = {
  title: "Allow this tool to run?",
  viewDetails: "View details",
  allowOnce: "Allow once",
  alwaysAllow: "Always allow",
  deny: "Deny",
  pending: "Approval required",
  approving: "Approving",
  approved: "Approved",
  denied: "Denied",
  running: "Running",
  complete: "Completed",
  error: "Failed",
};

export type ToolApprovalMessages = typeof toolApprovalMessages;

export interface ToolApprovalParameter {
  id: string;
  label: ReactNode;
  value: ReactNode;
}

export interface ToolApprovalCodeProps {
  code: string;
  language?: AgentCodeLanguage;
  className?: string;
}

export interface ToolApprovalProps {
  tool: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  parameters?: ToolApprovalParameter[];
  status?: ToolApprovalStatus;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onApprove?: () => void;
  onAlwaysAllow?: () => void;
  onDeny?: () => void;
  /** Override any built-in string. */
  labels?: Partial<ToolApprovalMessages>;
  className?: string;
}


export function ToolApprovalCode({
  code,
  language = "bash",
  className,
}: ToolApprovalCodeProps) {
  return (
    <AgentCode
      code={code}
      language={language}
      className={cn(
        // Parameter values sit in a narrow grid column with nowhere to scroll
        // on touch, so they wrap instead of clipping (as ToolResultOutput does).
        "whitespace-pre-wrap break-words rounded-lg border border-border/50 bg-muted/30 px-2.5 py-2",
        className,
      )}
    />
  );
}

export function ToolApproval({
  tool,
  title,
  description,
  parameters = [],
  status = "pending",
  open,
  defaultOpen = false,
  onOpenChange,
  onApprove,
  onAlwaysAllow,
  onDeny,
  labels,
  className,
}: ToolApprovalProps) {
  const reduce = useReducedMotion() ?? false;
  const t = useMessages("toolApproval", toolApprovalMessages, labels);
  const baseId = useId();
  const detailsId = `${baseId}-details`;
  const previousStatus = useRef(status);
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const currentOpen = open ?? internalOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (open === undefined) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange, open],
  );
  const busy = status === "approving" || status === "running";
  const pending = status === "pending";
  const error = status === "error";

  useEffect(() => {
    if (previousStatus.current === "pending" && status !== "pending") {
      setOpen(false);
    }
    previousStatus.current = status;
  }, [setOpen, status]);

  return (
    <Card
      data-state={status}
      aria-busy={busy}
      className={cn(
        "w-full",
        className,
      )}
    >
      <CardContent className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl border border-border/60 bg-background text-muted-foreground",
            error && "text-destructive",
          )}
        >
          {busy ? (
            <LoaderCircle className={cn("size-4", !reduce && "animate-spin")} />
          ) : error ? (
            <CircleAlert className="size-4" />
          ) : status === "denied" ? (
            <X className="size-4" />
          ) : status === "approved" || status === "complete" ? (
            <Check className="size-4" />
          ) : (
            <ShieldCheck className="size-4" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-medium text-foreground">{title ?? t("title")}</div>
              <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                {tool}
              </div>
            </div>
            <Badge variant={error ? "destructive" : "secondary"}>{t(status)}</Badge>
          </div>
          {description ? (
            <p className="mt-2 leading-5 text-muted-foreground">{description}</p>
          ) : null}

          {parameters.length ? (
            <Button variant="ghost"
              type="button"
              aria-expanded={currentOpen}
              aria-controls={detailsId}
              onClick={() => setOpen(!currentOpen)}
              className="mt-2 inline-flex items-center gap-1"
            >
              {t("viewDetails")}
              <motion.span
                aria-hidden="true"
                animate={{ rotate: currentOpen ? 180 : 0 }}
                transition={reduce ? { duration: 0 } : SPRING_SWAP}
              >
                <ChevronDown className="size-3.5" />
              </motion.span>
            </Button>
          ) : null}
        </div>
      </CardContent>

      <AgentDisclosure
        id={detailsId}
        open={currentOpen}
      >
        <dl className="mx-4 mb-4 grid gap-2">
          {parameters.map((parameter) => (
            <div
              key={parameter.id}
              className="grid sm:grid-cols-[minmax(0,6rem)_minmax(0,1fr)] items-center gap-3 text-xs"
            >
              <dt className="text-muted-foreground">{parameter.label}</dt>
              <dd className="min-w-0 break-words font-mono text-foreground/85">
                {parameter.value}
              </dd>
            </div>
          ))}
        </dl>
      </AgentDisclosure>

      <AnimatePresence initial={false}>
        {pending ? (
          <motion.div
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0.12 : 0.22, ease: EASE_OUT }}
            className="flex flex-wrap items-center gap-2 px-4 py-3"
          >
            <Button
              type="button"
              onClick={onApprove}
            >
              {t("allowOnce")}
            </Button>
            {onAlwaysAllow ? (
              <Button
                type="button"
                onClick={onAlwaysAllow}
              >
                {t("alwaysAllow")}
              </Button>
            ) : null}
            <Button variant="ghost"
              type="button"
              onClick={onDeny}
            >
              {t("deny")}
            </Button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </Card>
  );
}
