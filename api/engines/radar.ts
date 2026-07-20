// 補助雷達引擎：
// ① 收件匣——貼上的公告／列表文字，AI（或規則備援）解析成結構化候選
// ② 自動掃描轉接器——文化部獎補助資訊網（best-effort：政府網站可能封鎖境外 IP，失敗時明確回報）
import { chat } from "../llm";

export interface ParsedCandidate {
  title: string;
  agency: string;
  applyStart: string;   // YYYY-MM-DD 或 ""
  applyEnd: string;
  amountNote: string;
  url: string;
}

// 民國年 → 西元年（115 年 → 2026）；支援 115.3.31、115/3/31、115年3月31日
export function normalizeTwDate(y: string, m: string, d: string): string {
  let year = parseInt(y, 10);
  if (year < 1900) year += 1911;
  const mm = String(parseInt(m, 10)).padStart(2, "0");
  const dd = String(parseInt(d, 10)).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

// 從任意文字抽出日期區間（受理、截止、至、起訖）；回傳 [start, end]，抽不到給空
export function extractDateRange(text: string): { start: string; end: string } {
  const re = /(\d{2,4})\s*[年\/\-.]\s*(\d{1,2})\s*[月\/\-.]\s*(\d{1,2})\s*日?/g;
  const hits: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null && hits.length < 4) {
    hits.push(normalizeTwDate(m[1], m[2], m[3]));
  }
  return { start: hits[0] ?? "", end: hits[1] ?? hits[0] ?? "" };
}

/** AI 解析：從公告／列表文字抽出補助案件陣列；AI 不可用時走規則備援 */
export async function parseAnnouncements(raw: string): Promise<{ items: ParsedCandidate[]; usedAI: boolean }> {
  const text = raw.trim().slice(0, 12000);
  const ai = await chat([
    {
      role: "system",
      content:
        "你是台灣政府補助案公告解析器。從使用者貼上的文字中抽出所有「補助／徵件／獎勵／計畫徵求」案件，只輸出 JSON 陣列，每項欄位：title（案件全名）、agency（主辦機關）、applyStart、applyEnd、amountNote（補助金額相關原文，無則空）、url（無則空）。日期一律 YYYY-MM-DD；民國年轉西元（115 年＝2026 年）；只有月日沒有年時，以公告語境推斷最近合理的年份；找不到的欄位給空字串。不要輸出 JSON 以外的任何文字。",
    },
    { role: "user", content: text },
  ]);
  if (ai) {
    try {
      const match = ai.match(/\[[\s\S]*\]/);
      const arr = match ? JSON.parse(match[0]) : [];
      const items = (arr as Array<Record<string, string>>)
        .map((x) => ({
          title: String(x.title ?? "").trim(),
          agency: String(x.agency ?? "").trim(),
          applyStart: String(x.applyStart ?? "").trim(),
          applyEnd: String(x.applyEnd ?? "").trim(),
          amountNote: String(x.amountNote ?? "").trim().slice(0, 180),
          url: String(x.url ?? "").trim(),
        }))
        .filter((x) => x.title.length >= 4);
      if (items.length) return { items, usedAI: true };
    } catch {
      // JSON 解析失敗 → 落規則備援
    }
  }

  // 規則備援：按行掃描，取含補助關鍵字的行當標題，就近抓日期
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const items: ParsedCandidate[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/補助|徵件|獎勵|徵求|申請|補貼/.test(line) || line.length < 6 || line.length > 120) continue;
    // 金額行、受理期間行、資格行不是案件標題
    if (/^(最高|受理|期間|每案|補助金額|補助上限|申請資格|聯絡|附件|備註)/.test(line)) continue;
    const title = line.replace(/^[○●・\d\s.、）)]+/, "").trim();
    if (title.length < 6 || seen.has(title)) continue;
    seen.add(title);
    const window = [lines[i + 1], lines[i + 2]].filter(Boolean).join(" ");
    const { start, end } = extractDateRange(window || line);
    items.push({
      title,
      agency: "",
      applyStart: start,
      applyEnd: end,
      amountNote: end ? "" : "時程待查證",
      url: "",
    });
    if (items.length >= 10) break;
  }
  return { items, usedAI: false };
}

/** 自動掃描：文化部獎補助資訊網首頁「最新消息」。政府網站常封鎖境外 IP——失敗時擲出可讀錯誤 */
export async function scanMocSite(): Promise<ParsedCandidate[]> {
  let html: string;
  try {
    const res = await fetch("https://grants.moc.gov.tw/Web/", {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ProposalPlan-Radar/1.0" },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (e) {
    throw new Error(
      `連不上文化部獎補助資訊網（${e instanceof Error ? e.message : String(e)}）——政府網站常封鎖境外主機，這不是系統故障。請改用收件匣貼上公告。`,
    );
  }

  const items: ParsedCandidate[] = [];
  const seen = new Set<string>();
  const anchorRe = /<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const text = m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (text.length < 8 || text.length > 120) continue;
    if (!/補助|徵件|獎勵|徵選|申請|補貼/.test(text)) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    // 在連結前後 300 字內找日期
    const window = html.slice(Math.max(0, m.index - 150), m.index + m[0].length + 150);
    const { start, end } = extractDateRange(window);
    const href = m[1];
    items.push({
      title: text,
      agency: "文化部",
      applyStart: start,
      applyEnd: end,
      amountNote: "",
      url: href.startsWith("http") ? href : `https://grants.moc.gov.tw${href.startsWith("/") ? "" : "/"}${href}`,
    });
    if (items.length >= 15) break;
  }
  return items;
}
