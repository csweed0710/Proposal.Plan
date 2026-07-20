// LLM 層：有設定金鑰走 AI，沒設定走規則引擎（離線也能完整運作）。
// OpenAI 相容介面——OpenAI、Anthropic（Claude）、Gemini 等皆可，只換三個環境變數：
//   LLM_API_KEY    — API 金鑰
//   LLM_BASE_URL   — OpenAI: https://api.openai.com/v1（預設）
//                    Claude: https://api.anthropic.com/v1
//                    Gemini: https://generativelanguage.googleapis.com/v1beta/openai
//   LLM_MODEL      — 例如 gpt-4o-mini、claude-sonnet-4-5、gemini-2.5-flash
//   LLM_MAX_TOKENS — 單次回應上限（預設 4096；Anthropic 相容端點必填）
import type { LlmStatus } from "../contracts/types";

const MODEL = process.env.LLM_MODEL || "gpt-4o-mini";
const BASE_URL = (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
const MAX_TOKENS = parseInt(process.env.LLM_MAX_TOKENS || "4096", 10);

let lastError: string | null = null;

export function llmStatus(): LlmStatus {
  return {
    configured: Boolean(process.env.LLM_API_KEY),
    model: MODEL,
    mode: process.env.LLM_API_KEY ? "ai" : "rule",
    lastError,
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
  // 推理系模型（gpt-5、o1、o3…）不吃 temperature，且用 max_completion_tokens
  const reasoning = /^(gpt-5|o1|o3|o4)/i.test(MODEL);
  const payload: Record<string, unknown> = { model: MODEL, messages };
  if (reasoning) {
    payload.max_completion_tokens = MAX_TOKENS;
  } else {
    payload.temperature = 0.4;
    payload.max_tokens = MAX_TOKENS;
  }
  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(90000),
    });
    if (!res.ok) {
      // 留下可診斷的錯誤（金鑰錯、模型名錯、額度滿…），顯示在系統狀態與伺服器日誌
      const body = await res.text().catch(() => "");
      lastError = `HTTP ${res.status}：${body.slice(0, 200)}`;
      console.warn("[llm] chat failed:", lastError);
      return null;
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content ?? null;
    if (text) lastError = null;
    return text;
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    console.warn("[llm] chat error:", lastError);
    return null;
  }
}
