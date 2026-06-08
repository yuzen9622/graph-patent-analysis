import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";

export type ProviderType = "nvidia" | "gemini" | "openai";

const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";

export function getModel(provider: ProviderType, apiKey: string) {
  switch (provider) {
    case "nvidia": {
      const nvidia = createOpenAI({
        baseURL: NVIDIA_BASE_URL,
        apiKey,
      });
      return nvidia("meta/llama-3.1-70b-instruct");
    }
    case "gemini": {
      const gemini = createGoogleGenerativeAI({ apiKey });
      return gemini("gemini-3-flash-preview");
    }
    case "openai": {
      const openai = createOpenAI({ apiKey });
      return openai("gpt-4o-mini");
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
