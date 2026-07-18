// LLM 層：有設定金鑰走 AI，沒設定走規則引擎（離線也能完整運作）。
// 設定方式（OpenAI 相容介面）：
//   LLM_API_KEY   — API 金鑰
//   LLM_BASE_URL  — 例如 https://api.openai.com/v1
//   LLM_MODEL     — 例如 gpt-4o-mini
import type { LlmStatus } from "../contracts/types";

const MODEL = process.env.LLM_MODEL || "gpt-4o-mini";
const BASE_URL = (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");

export function llmStatus(): LlmStatus {
  return {
    configured: Boolean(process.env.LLM_API_KEY),
    model: MODEL,
    mode: process.env.LLM_API_KEY ? "ai" : "rule",
  };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** 回傳 AI 文字；未設定金鑰或呼叫失敗時回傳 null（呼叫端降級規則引擎） */
export async function chat(messages: ChatMessage[]): Promise<string | null> {
  const key = process.env.LLM_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: MODEL, messages, temperature: 0.4 }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}
