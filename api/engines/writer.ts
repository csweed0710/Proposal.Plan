// 寫作引擎：把客戶記憶＋問卷答案＋章節指引＋參考資料組成上下文，產出章節草稿。
import type { CaseChapter, IntakeQuestion, RubricItem } from "../../contracts/types";
import type { Client, GrantProgram } from "../../db/schema";
import { chat } from "../llm";
import { refsPrompt, type RefDocInput } from "./reference";

function chapterContext(
  ch: CaseChapter,
  qa: IntakeQuestion[],
): string {
  const answers = qa
    .filter((q) => (q.chapterKey === ch.key || q.chapterKey === "__profile__" || q.chapterKey === "__rubric__") && q.answer.trim())
    .map((q) => `Q：${q.question}\nA：${q.answer.trim()}`)
    .join("\n");
  return answers || "（問卷尚無本章相關素材）";
}

/** 產出單章草稿。AI 模式出全文；規則模式出帶素材的骨架。 */
export async function draftChapter(
  ch: CaseChapter,
  qa: IntakeQuestion[],
  client: Client,
  grant: GrantProgram,
  rubric: RubricItem[],
  refs: RefDocInput[] = [],
): Promise<{ content: string; usedAI: boolean; usedRefs: number }> {
  const context = chapterContext(ch, qa);
  const rubricText = rubric.map((r) => `${r.item}（${r.points} 分）：${r.description}`).join("；");
  const { text: refText, used } = refsPrompt(refs);

  const ai = await chat([
    {
      role: "system",
      content:
        "你是台灣政府補助計畫書資深寫手。規則：正式、具體、主動語態；每個主張要有素材依據；資料不足處標【待補】，不得虛構數據；量化指標寫出基期值與目標值；避免「賦能、生態圈、浪潮」等空泛用語。只輸出章節本文。" +
        "問卷答案是申請人用自己的話寫的日常碎片——可能口語、條列、不完整，甚至寫「不知道」。你的工作是理解其意、提煉成正式的計畫書論述，絕對不要照抄口語，也不要抱怨素材形式；答案說「不知道」或明顯缺漏的論點標【待補】。" +
        (refText ? "若提供得標範本，學習其結構與語氣但嚴禁抄襲內容；若提供委員意見，必須在內容中正面回應。" : ""),
    },
    {
      role: "user",
      content:
        `補助案：${grant.name}（${grant.agency}）\n申請單位：${client.name}（${client.orgType}）\n評分標準：${rubricText}\n\n` +
        (refText ? `${refText}\n\n` : "") +
        `請撰寫章節「${ch.title}」（約 600–900 字）。\n寫作重點：${ch.guidance || "依官方格式"}\n\n可用素材：\n${context}`,
    },
  ]);
  if (ai) return { content: ai.trim(), usedAI: true, usedRefs: used };

  // 規則模式：骨架＋問卷素材如實編排，不編造
  const related = qa.filter((q) => q.chapterKey === ch.key && q.answer.trim());
  const lines: string[] = [];
  lines.push(`（規則引擎草稿——未啟用 AI，以下為素材編排，請人工潤稿或啟用 AI 重寫）`);
  if (ch.guidance) lines.push(`寫作重點：${ch.guidance}`);
  lines.push("");
  if (related.length > 0) {
    for (const q of related) {
      lines.push(`【${q.question}】`);
      lines.push(q.answer.trim());
      lines.push("");
    }
  } else {
    lines.push("【待補】本章尚無問卷素材，請先到「問卷」分頁補齊資料。");
  }
  lines.push("【待補】數據：請補上基期值與目標值。");
  return { content: lines.join("\n"), usedAI: false, usedRefs: 0 };
}
