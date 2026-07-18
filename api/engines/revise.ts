// 修改引擎：接住審核發現的問題，逐章修掉；修完再審，直到達標。
import type { CaseChapter, ReviewIssue } from "../../contracts/types";
import { chat } from "../llm";

const VAGUE_FIX: Record<string, string> = {
  浪潮: "趨勢",
  賦能: "支持",
  打造生態: "建立合作網絡",
  生態圈: "合作網絡",
  積極推動: "推動",
  落實執行: "執行",
  深獲好評: "",
  效益顯著: "",
  廣受好評: "",
  各界肯定: "",
  多元發展: "多面向發展",
  創新思維: "創新做法",
  共同努力: "",
  有目共睹: "",
  指日可待: "",
  更上一層樓: "",
};

/** 空章節 → 依章節指引產出結構化骨架（規則模式的誠實起點） */
function skeleton(ch: CaseChapter, answers: string[]): string {
  const lines: string[] = [];
  lines.push(`（本章依「${ch.title}」指引建立之草稿骨架）`);
  if (ch.guidance) lines.push(`寫作重點：${ch.guidance}`);
  lines.push("");
  if (answers.length > 0) {
    lines.push("依據進場問卷素材：");
    for (const a of answers) lines.push(`・${a}`);
    lines.push("");
  }
  lines.push("【待補】第一段：現況與問題（需數據）");
  lines.push("【待補】第二段：具體做法與流程");
  lines.push("【待補】第三段：預期成果（需基期值與目標值）");
  return lines.join("\n");
}

export interface ReviseResult {
  chapters: CaseChapter[];
  changeLog: string[];
  usedAI: boolean;
}

/** 對有問題的章節執行修改。AI 模式逐章重寫；規則模式做可解釋的機械修正。 */
export async function applyRevision(
  chapters: CaseChapter[],
  issues: ReviewIssue[],
  chapterAnswers: Record<string, string[]>,
): Promise<ReviseResult> {
  const open = issues.filter((i) => i.status === "open");
  const changeLog: string[] = [];
  let usedAI = false;

  // 每章收集屬於它的問題
  const byChapter = new Map<string, ReviewIssue[]>();
  for (const it of open) {
    const list = byChapter.get(it.chapterKey) ?? [];
    list.push(it);
    byChapter.set(it.chapterKey, list);
  }

  const next: CaseChapter[] = [];
  for (const ch of chapters) {
    const mine = byChapter.get(ch.key) ?? [];
    const global = byChapter.get("ALL") ?? [];
    const relevant = [...mine, ...global];
    let content = ch.content;

    // 1) 空章節／過短章節 → 骨架
    const needsSkeleton = relevant.some(
      (i) => i.dimension === "structure" && i.severity !== "low",
    );
    if (needsSkeleton && content.trim().length < 120) {
      content = skeleton(ch, chapterAnswers[ch.key] ?? []);
      changeLog.push(`「${ch.title}」建立章節骨架`);
    }

    // 2) 空泛用語 → 同義替換／刪除
    const vagueIssues = relevant.filter((i) => i.dimension === "specificity");
    if (vagueIssues.length > 0) {
      let fixed = 0;
      for (const [from, to] of Object.entries(VAGUE_FIX)) {
        if (content.includes(from)) {
          content = content.split(from).join(to);
          fixed++;
        }
      }
      if (fixed > 0) changeLog.push(`「${ch.title}」修正 ${fixed} 處空泛用語`);
    }

    // 3) 金額不一致 → 以最高權重章節（通常是預算章）的數字為準
    const moneyIssues = relevant.filter((i) => i.dimension === "consistency");
    for (const mi of moneyIssues) {
      const m = mi.problem.match(/「(.+?)」金額不一致：(.+?) ≠ (.+)$/);
      if (m) {
        const [, , from, to] = m;
        if (content.includes(from)) {
          content = content.split(from).join(to);
          changeLog.push(`「${ch.title}」統一金額 ${from} → ${to}`);
        }
      }
    }

    // 4) 其餘問題（數據不足、評分缺口）→ AI 模式逐章重寫；規則模式留給人工
    const hard = relevant.filter(
      (i) => i.dimension === "rubric" || i.dimension === "evidence",
    );
    if (hard.length > 0 && content.trim().length >= 80) {
      const issueText = hard.map((i) => `・${i.problem}→改進方向：${i.suggestion}`).join("\n");
      const revised = await chat([
        {
          role: "system",
          content:
            "你是台灣政府補助計畫書主編。依指出的問題修改章節，只輸出修改後的章節全文，不要解釋。不得虛構數據；資料不足處保留【待補】標記。",
        },
        {
          role: "user",
          content: `章節：${ch.title}\n寫作重點：${ch.guidance}\n\n目前內容：\n${content}\n\n需要修正的問題：\n${issueText}`,
        },
      ]);
      if (revised) {
        content = revised.trim();
        usedAI = true;
        changeLog.push(`「${ch.title}」AI 依 ${hard.length} 項問題重寫`);
      }
    }

    next.push({
      ...ch,
      content,
      status: content.trim().length === 0 ? "empty" : ch.status === "empty" ? "draft" : ch.status,
    });
  }

  if (changeLog.length === 0) changeLog.push("規則引擎無可自動修正之項目，剩餘問題需人工補資料或啟用 AI");
  return { chapters: next, changeLog, usedAI };
}
