import { fetch } from "undici";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export interface GeminiConfig {
  apiKey: string;
  model: string;
}

export interface GeminiCallOptions {
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
  jsonMode?: boolean;
}

export interface GeminiResponse {
  text: string;
  finish_reason: string;
  prompt_tokens: number;
  output_tokens: number;
  model: string;
}

interface RawCandidate {
  content?: { parts?: Array<{ text?: string }> };
  finishReason?: string;
}

interface RawResponse {
  candidates?: RawCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: { message?: string; code?: number };
}

export function loadGeminiConfigFromEnv(): GeminiConfig {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set in env");
  const model = process.env.GEMINI_MODEL ?? "gemini-3-flash-preview";
  return { apiKey, model };
}

export async function generateText(
  cfg: GeminiConfig,
  userPrompt: string,
  opts: GeminiCallOptions = {},
): Promise<GeminiResponse> {
  const url = `${API_BASE}/models/${cfg.model}:generateContent?key=${cfg.apiKey}`;
  const body = {
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    ...(opts.systemInstruction
      ? { systemInstruction: { parts: [{ text: opts.systemInstruction }] } }
      : {}),
    generationConfig: {
      temperature: opts.temperature ?? 0.3,
      maxOutputTokens: opts.maxOutputTokens ?? 8192,
      ...(opts.jsonMode ? { responseMimeType: "application/json" } : {}),
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const raw = (await res.json()) as RawResponse;

  if (!res.ok || raw.error) {
    const msg = raw.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`Gemini API error: ${msg}`);
  }

  const cand = raw.candidates?.[0];
  const text = cand?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) {
    throw new Error(
      `Gemini returned no text. finishReason=${cand?.finishReason ?? "unknown"}, raw=${JSON.stringify(raw).slice(0, 300)}`,
    );
  }

  return {
    text,
    finish_reason: cand?.finishReason ?? "UNKNOWN",
    prompt_tokens: raw.usageMetadata?.promptTokenCount ?? 0,
    output_tokens: raw.usageMetadata?.candidatesTokenCount ?? 0,
    model: cfg.model,
  };
}
