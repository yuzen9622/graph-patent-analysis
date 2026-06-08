"use client";

import { useState, useId } from "react";
import { Eye, EyeOff, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { ProviderType } from "@/lib/llm/providers";
import { cn } from "@/lib/utils";

interface ModelSelectorProps {
  provider: ProviderType;
  apiKey: string;
  onProviderChange: (provider: ProviderType) => void;
  onApiKeyChange: (apiKey: string) => void;
}

interface ProviderOption {
  value: ProviderType;
  label: string;
  model: string;
}

const PROVIDER_OPTIONS: ProviderOption[] = [
  { value: "nvidia", label: "NVIDIA NIM", model: "llama-3.1-70b" },
  { value: "gemini", label: "Google Gemini", model: "gemini-3-flash-preview" },
  { value: "openai", label: "OpenAI", model: "gpt-4o" },
];

type ValidationState = "idle" | "validating" | "valid" | "invalid";

const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK === "true";

export default function ModelSelector({
  provider,
  apiKey,
  onProviderChange,
  onApiKeyChange,
}: ModelSelectorProps) {
  const [showKey, setShowKey] = useState(false);
  const [validationState, setValidationState] =
    useState<ValidationState>("idle");
  const [validationMessage, setValidationMessage] = useState<string>("");

  const groupId = useId();
  const inputId = useId();

  const handleProviderChange = (newProvider: ProviderType) => {
    onProviderChange(newProvider);
    setValidationState("idle");
    setValidationMessage("");
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Provider radio cards — always 3 in a row */}
      <div>
        <p
          id={`${groupId}-label`}
          className="mb-3 text-xs font-semibold text-muted-foreground uppercase tracking-widest"
        >
          模型選擇
        </p>
        <div
          role="radiogroup"
          aria-labelledby={`${groupId}-label`}
          className="grid grid-cols-3 gap-3"
        >
          {PROVIDER_OPTIONS.map((opt) => {
            const isSelected = provider === opt.value;
            return (
              <label
                key={opt.value}
                className={cn(
                  "flex cursor-pointer flex-col gap-1.5 rounded-xl border px-4 py-3.5",
                  "transition-all duration-200 focus-within:outline focus-within:outline-2 focus-within:outline-primary",
                  "backdrop-blur-sm",
                  isSelected
                    ? "border-primary/40 bg-primary/12 shadow-md shadow-primary/15"
                    : "border-white/8 bg-white/[0.03] hover:border-white/16 hover:bg-white/[0.06]",
                )}
              >
                <input
                  type="radio"
                  name={`${groupId}-provider`}
                  value={opt.value}
                  checked={isSelected}
                  onChange={() => handleProviderChange(opt.value)}
                  className="sr-only"
                />
                <span
                  className={cn(
                    "text-sm font-semibold leading-tight transition-colors",
                    isSelected ? "text-primary" : "text-foreground",
                  )}
                >
                  {opt.label}
                </span>
                <span className="font-mono text-[0.68rem] text-muted-foreground leading-tight break-all">
                  {opt.model}
                </span>
              </label>
            );
          })}
        </div>
      </div>

      {/* API Key — full width */}
      <div>
        <label
          htmlFor={inputId}
          className="mb-2 block text-xs font-semibold text-muted-foreground uppercase tracking-widest"
        >
          API Key
        </label>

        <div className="relative">
          <input
            id={inputId}
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={(e) => {
              onApiKeyChange(e.target.value);
              setValidationState("idle");
              setValidationMessage("");
            }}
            disabled={USE_MOCK}
            placeholder={USE_MOCK ? "" : "貼上您的 API Key…"}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={
              validationMessage ? `${inputId}-status` : undefined
            }
            className={[
              "w-full rounded-xl border bg-black/[0.02] dark:bg-white/[0.04] backdrop-blur-sm py-2.5 pl-3 pr-10",
              "font-mono text-sm text-foreground placeholder-muted-foreground",
              "outline-none transition-all duration-200",
              "focus:outline focus:outline-2 focus:outline-primary",
              "disabled:cursor-not-allowed disabled:opacity-50",
              validationState === "valid"
                ? "border-success/50"
                : validationState === "invalid"
                  ? "border-error/50"
                  : "border-black/5 dark:border-white/8 hover:border-black/10 dark:hover:border-white/16",
            ].join(" ")}
          />

          <div className="absolute inset-y-0 right-0 flex items-center pr-3 gap-1.5">
            {validationState === "validating" && (
              <Loader2
                className="h-4 w-4 animate-spin text-muted-foreground"
                aria-hidden="true"
              />
            )}
            {validationState === "valid" && (
              <CheckCircle2
                className="h-4 w-4 text-success"
                aria-hidden="true"
              />
            )}
            {validationState === "invalid" && (
              <XCircle className="h-4 w-4 text-error" aria-hidden="true" />
            )}
            {!USE_MOCK && (
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                aria-label={showKey ? "隱藏 API Key" : "顯示 API Key"}
                className="cursor-pointer rounded text-muted-foreground hover:text-foreground focus:outline focus:outline-2 focus:outline-accent transition-colors duration-150"
              >
                {showKey ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            )}
          </div>
        </div>

        {USE_MOCK ? (
          <p className="mt-1.5 text-xs text-muted-foreground">
            （開發模式：不需要）
          </p>
        ) : validationMessage ? (
          <p
            id={`${inputId}-status`}
            role="alert"
            className={`mt-1.5 text-xs ${
              validationState === "valid" ? "text-success" : "text-error"
            }`}
          >
            {validationMessage}
          </p>
        ) : null}
      </div>
    </div>
  );
}
