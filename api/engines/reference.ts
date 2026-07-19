// 參考資料引擎：挑選與案件相關的參考資料，組成 AI 提示區塊。
// 得標範本＝風格標竿；數據文獻＝可引用素材；委員意見＝必須正面回應的歷史教訓。
import PizZip from "pizzip";
import type { RefKind } from "../../contracts/types";

export interface RefDocInput {
  title: string;
  kind: string;
  grantId: number | null;
  textContent: string | null;
  note: string | null;
}

// 各類型的注入上限：範本重質不重量，數據可多，委員意見最珍貴但通常不長
const KIND_BUDGET: Record<string, { maxDocs: number; perDocChars: number }> = {
  example: { maxDocs: 2, perDocChars: 1800 },
  data: { maxDocs: 3, perDocChars: 1200 },
  feedback: { maxDocs: 3, perDocChars: 1000 },
  rubric_doc: { maxDocs: 1, perDocChars: 1200 },
};

/** 從資料庫文件中挑出與本補助案相關的（同案優先，通用其次），依用途裁切 */
export function pickRefs(all: RefDocInput[], grantId: number, kinds: RefKind[]): RefDocInput[] {
  return all.filter((d) => kinds.includes(d.kind as RefKind) && (d.grantId === grantId || d.grantId == null));
}

/** 把參考資料組成提示文字（已依類型限量裁切） */
export function refsPrompt(refs: RefDocInput[]): { text: string; used: number } {
  const blocks: string[] = [];
  let used = 0;

  const byKind = new Map<string, RefDocInput[]>();
  for (const r of refs) {
    if (!r.textContent?.trim()) continue;
    const list = byKind.get(r.kind) ?? [];
    list.push(r);
    byKind.set(r.kind, list);
  }

  const label: Record<string, string> = {
    example: "得標範本風格參考（學習其結構、深度與語氣，嚴禁照抄內容）",
    data: "可引用的數據與文獻素材（引用時註明來源年份）",
    feedback: "過去委員審查意見（本次內容必須正面回應、逐點化解）",
    rubric_doc: "官方評分文件（內容須對齊評分重點）",
  };

  for (const [kind, docs] of byKind) {
    const budget = KIND_BUDGET[kind] ?? { maxDocs: 1, perDocChars: 1000 };
    const picked = docs.slice(0, budget.maxDocs);
    if (picked.length === 0) continue;
    blocks.push(`【${label[kind] ?? kind}】`);
    for (const d of picked) {
      const body = d.textContent!.trim().slice(0, budget.perDocChars);
      blocks.push(`〈${d.title}〉${d.note?.trim() ? `（備註：${d.note.trim()}）` : ""}\n${body}`);
      used++;
    }
  }

  return { text: blocks.join("\n\n"), used };
}

/** 從 .docx 抽出純文字（參考資料只需文字供 AI 使用，不保留原始檔） */
export function docxToText(data: Uint8Array): string {
  const zip = new PizZip(data);
  const xml = zip.file("word/document.xml")?.asText() ?? "";
  if (!xml) throw new Error("不是有效的 .docx 檔案");
  return xml
    .replace(/<w:tab[^>]*\/?>/g, "\t")
    .replace(/<w:br[^>]*\/?>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
