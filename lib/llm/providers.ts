import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";

export type ProviderType = "nvidia" | "gemini" | "openai";

export const PROVIDER_MODELS: Record<ProviderType, string> = {
  nvidia: "meta/llama-3.1-70b-instruct",
  gemini: "gemini-3-flash-preview",
  openai: "gpt-4o-mini",
};

/** Environment variable that holds each provider's API key (server-side only). */
const PROVIDER_ENV_VAR: Record<ProviderType, string> = {
  nvidia: "NVIDIA_API_KEY",
  gemini: "GEMINI_API_KEY",
  openai: "OPENAI_API_KEY",
};

/**
 * Read the provider's API key from the server environment.
 * Returns an empty string when the variable is unset.
 */
export function getEnvApiKey(provider: ProviderType): string {
  return process.env[PROVIDER_ENV_VAR[provider]] ?? "";
}

const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";

export function getModel(provider: ProviderType, apiKey: string) {
  switch (provider) {
    case "nvidia": {
      const nvidia = createOpenAI({
        baseURL: NVIDIA_BASE_URL,
        apiKey,
      });
      return nvidia(PROVIDER_MODELS.nvidia);
    }
    case "gemini": {
      const gemini = createGoogleGenerativeAI({ apiKey });
      return gemini(PROVIDER_MODELS.gemini);
    }
    case "openai": {
      const openai = createOpenAI({ apiKey });
      return openai(PROVIDER_MODELS.openai);
    }
  }
}

export async function validateApiKey(
  provider: ProviderType,
  apiKey: string,
): Promise<boolean> {
  try {
    const model = getModel(provider, apiKey);
    await generateText({
      model,
      prompt: "hi",
      maxOutputTokens: 5,
    });
    return true;
  } catch {
    return false;
  }
}
