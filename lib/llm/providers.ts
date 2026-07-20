import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";

export type ProviderType = "nvidia" | "gemini" | "openai";

export const PROVIDER_MODELS: Record<ProviderType, string> = {
  nvidia: "meta/llama-3.1-70b-instruct",
  gemini: "gemini-3-flash-preview",
  openai: "gpt-4o-mini",
};

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
