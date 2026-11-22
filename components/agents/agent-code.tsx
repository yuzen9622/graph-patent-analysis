"use client";

import {
  Fragment,
  useEffect,
  useState,
} from "react";
import { createCssVariablesTheme, createHighlighter, type Highlighter } from "shiki";
import { cn } from "@/lib/utils";

export type AgentCodeLanguage =
  | "bash"
  | "diff"
  | "json"
  | "text"
  | "tsx"
  | "typescript";

export interface AgentCodeToken {
  content: string;
  offset: number;
  className?: string;
}

export type AgentCodeTokenLines = AgentCodeToken[][];

export interface AgentCodeProps {
  code: string;
  language?: AgentCodeLanguage;
  className?: string;
}

export interface AgentCodeLineProps {
  code: string;
  tokens?: AgentCodeToken[];
  className?: string;
}

const syntaxTheme = createCssVariablesTheme();
const tokenClass: Record<string, string> = {
  "var(--shiki-token-comment)": "text-muted-foreground",
  "var(--shiki-token-string)": "text-secondary",
  "var(--shiki-token-string-expression)": "text-secondary",
  "var(--shiki-token-constant)": "text-primary",
  "var(--shiki-token-keyword)": "text-primary",
  "var(--shiki-token-function)": "text-secondary",
  "var(--shiki-token-link)": "text-primary",
  "var(--shiki-token-inserted)": "text-success",
  "var(--shiki-token-deleted)": "text-destructive",
  "var(--shiki-token-changed)": "text-warning",
};
let agentCodeHighlighter: Promise<Highlighter> | null = null;
const tokenCache = new Map<string, AgentCodeTokenLines>();

function getAgentCodeHighlighter() {
  if (!agentCodeHighlighter) {
    agentCodeHighlighter = createHighlighter({
      themes: [syntaxTheme],
      langs: ["bash", "diff", "json", "tsx", "typescript"],
    });
  }
  return agentCodeHighlighter;
}

function tokenCacheKey(code: string, language: AgentCodeLanguage) {
  return `${language}\u0000${code}`;
}

export function useAgentCodeTokens(
  code: string,
  language: AgentCodeLanguage,
) {
  const key = tokenCacheKey(code, language);
  const cached = tokenCache.get(key);
  const [result, setResult] = useState<{
    key: string;
    code: string;
    language: AgentCodeLanguage;
    lines: AgentCodeTokenLines;
  } | null>(cached ? { key, code, language, lines: cached } : null);

  useEffect(() => {
    const current = tokenCache.get(key);
    if (current) return;

    let cancelled = false;
    getAgentCodeHighlighter().then((highlighter) => {
      if (cancelled) return;
      const lines = highlighter
        .codeToTokens(code, {
          lang: language,
          theme: syntaxTheme.name!,
        }).tokens
        .map((line) =>
          line.map((token) => ({
            content: token.content,
            offset: token.offset,
            className: tokenClass[token.color ?? ""] ?? "text-foreground",
          })),
      );
      tokenCache.set(key, lines);
      setResult({ key, code, language, lines });
    });
    return () => {
      cancelled = true;
    };
  }, [code, key, language]);

  if (cached) return cached;
  if (result?.key === key) return result.lines;
  if (result?.language === language && code.startsWith(result.code)) {
    return result.lines;
  }
  return null;
}

export function AgentCodeLine({
  code,
  tokens,
  className,
}: AgentCodeLineProps) {
  return (
    <span className={className}>
      {tokens
        ? tokens.map((token) => (
            <span
              key={`${token.offset}-${token.content}`}
              className={token.className}
            >
              {token.content}
            </span>
          ))
        : code}
    </span>
  );
}

export function AgentCode({
  code,
  language = "bash",
  className,
}: AgentCodeProps) {
  const tokens = useAgentCodeTokens(code, language);
  const lines: Array<{ content: string; offset: number }> = [];
  let offset = 0;
  for (const content of code.split("\n")) {
    lines.push({ content, offset });
    offset += content.length + 1;
  }

  return (
    <pre
      className={cn(
        "m-0 overflow-x-auto whitespace-pre font-mono text-xs leading-5 text-foreground/85",
        className,
      )}
    >
      <code>
        {lines.map((line, index) => (
          <Fragment key={line.offset}>
            <AgentCodeLine code={line.content} tokens={tokens?.[index]} />
            {index < lines.length - 1 ? "\n" : null}
          </Fragment>
        ))}
      </code>
    </pre>
  );
}
