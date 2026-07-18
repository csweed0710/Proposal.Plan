// 匯出引擎：把完成的案件變成真正的 .docx 檔案。
// 三種模式：
//   template  — 範本裡有【章節:key】【欄位:key】標記 → 逐點替換（最精準）
//   auto-map  — 範本沒有標記 → 用章節標題比對，把內容插到同名標題後面
//   generic   — 沒有範本 → 直接產出排版完整的計畫書
import PizZip from "pizzip";
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
} from "docx";
import type { CaseChapter } from "../../contracts/types";
import type { Case, Client, GrantProgram } from "../../db/schema";

// ---------- XML 工具 ----------
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unesc = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

function paragraphText(pXml: string): string {
  const parts: string[] = [];
  for (const m of pXml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)) parts.push(unesc(m[1]));
  return parts.join("");
}

function grab(pXml: string, re: RegExp): string {
  const m = pXml.match(re);
  return m ? m[0] : "";
}

/** 保留段落屬性與第一個 run 格式，用新文字重建整段（多行以 <w:br/> 連接） */
function rebuildParagraph(pXml: string, text: string): string {
  const pPr = grab(pXml, /<w:pPr>[\s\S]*?<\/w:pPr>/);
  const rPr = grab(pXml, /<w:rPr>[\s\S]*?<\/w:rPr>/);
  const lines = text.split(/\r?\n/).map(esc).join('<w:br/>');
  return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${lines}</w:t></w:r></w:p>`;
}

const CHAPTER_RE = /【\s*章節\s*[:：]\s*([A-Za-z0-9_\-]+)\s*】/;
const FIELD_RE = /【\s*欄位\s*[:：]\s*([A-Za-z0-9_]+)\s*】/g;
const FIELD_ANY_RE = /【\s*欄位\s*[:：]\s*[A-Za-z0-9_]+\s*】/; // 偵測用（無 /g，避免 lastIndex 跨段殘留）
const HAS_MARKER_RE = /【\s*(章節|欄位)\s*[:：]/;

// ---------- 欄位值 ----------
export function buildFieldMap(kase: Case, client: Client, grant: GrantProgram): Record<string, string> {
  const now = new Date();
  const roc = now.getFullYear() - 1911;
  const money = (n: number | null) => (n == null ? "" : `新台幣 ${n.toLocaleString("zh-TW")} 元`);
  return {
    case_title: kase.title,
    grant_name: grant.name,
    agency: grant.agency,
    org_name: client.name,
    org_type: client.orgType,
    tax_id: client.taxId ?? "",
    founded_year: client.foundedYear ? `民國 ${client.foundedYear - 1911} 年（${client.foundedYear}）` : "",
    city: client.city ?? "",
    employees: client.employeesFull != null ? `專職 ${client.employeesFull} 人、兼職 ${client.employeesPart ?? 0} 人` : "",
    capital: money(client.capital),
    revenue: money(client.revenueAvg),
    contact_name: client.contactName ?? "",
    contact_title: client.contactTitle ?? "",
    contact_phone: client.contactPhone ?? "",
    contact_email: client.contactEmail ?? "",
    date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
    date_roc: `民國 ${roc} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日`,
    year_roc: String(roc),
  };
}

// ---------- 範本填寫 ----------
export interface FillResult {
  data: Uint8Array;
  mode: "template" | "auto-map";
  mapped: string[];
  unmapped: string[];
}

export function fillTemplate(
  templateBytes: Uint8Array,
  chapters: CaseChapter[],
  fields: Record<string, string>,
): FillResult {
  const zip = new PizZip(templateBytes);
  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new Error("範本不是有效的 .docx（找不到 word/document.xml）");
  const xml = docFile.asText();

  const paragraphs = xml.match(/<w:p\b[^>]*?(?:\/>|>[\s\S]*?<\/w:p>)/g) ?? [];
  const hasMarkers = HAS_MARKER_RE.test(xml);
  const mapped: string[] = [];
  const unmapped: string[] = [];

  // 依序決定每段的替換結果，再統一用佔位符二次替換（避免內容與 XML 碰撞／$ 誤植）
  const segments = paragraphs.map((p) => ({ original: p, replacement: p }));

  if (hasMarkers) {
    // ---- 標記模式：逐段替換 ----
    for (const seg of segments) {
      const text = paragraphText(seg.original);
      const chMatch = text.match(CHAPTER_RE);
      if (chMatch) {
        const ch = chapters.find((c) => c.key === chMatch[1]);
        if (ch) {
          mapped.push(ch.title);
          seg.replacement = rebuildParagraph(seg.original, ch.content.trim() || `【待補】${ch.title}`);
          continue;
        }
      }
      if (FIELD_ANY_RE.test(text)) {
        const resolved = text.replace(FIELD_RE, (_, key) => fields[key] ?? "");
        seg.replacement = rebuildParagraph(seg.original, resolved);
      }
    }
    const mappedSet = new Set(mapped);
    for (const ch of chapters) if (!mappedSet.has(ch.title)) unmapped.push(ch.title);
  } else {
    // ---- 標題自動對應模式 ----
    const norm = (s: string) =>
      s.replace(/^\s*(?:第[一二三四五六七八九十百]+[章節部分篇]?|[一二三四五六七八九十]+[、.．]|\d+[、.．)]|[（(][一二三四五六七八九十\d]+[)）])\s*/, "")
        .replace(/[\s：:]/g, "");
    const used = new Set<string>();
    const bodyPara = (line: string) =>
      `<w:p><w:r><w:rPr><w:rFonts w:eastAsia="Microsoft JhengHei"/><w:sz w:val="24"/></w:rPr><w:t xml:space="preserve">${esc(line)}</w:t></w:r></w:p>`;
    for (const seg of segments) {
      const text = paragraphText(seg.original).trim();
      if (!text || text.length > 40) continue;
      const ch = chapters.find((c) => !used.has(c.key) && (norm(text) === norm(c.title) || norm(text).startsWith(norm(c.title))));
      if (ch) {
        used.add(ch.key);
        mapped.push(ch.title);
        const body = (ch.content.trim() || `【待補】${ch.title}`).split(/\r?\n/).map(bodyPara).join("");
        seg.replacement = seg.original + body;
      }
    }
    const leftover = chapters.filter((c) => !used.has(c.key));
    if (leftover.length > 0) {
      let tail = "";
      for (const ch of leftover) {
        unmapped.push(ch.title);
        tail +=
          `<w:p><w:r><w:rPr><w:b/><w:rFonts w:eastAsia="Microsoft JhengHei"/><w:sz w:val="28"/></w:rPr><w:t xml:space="preserve">${esc(ch.title)}</w:t></w:r></w:p>` +
          (ch.content.trim() || `【待補】${ch.title}`).split(/\r?\n/).map(bodyPara).join("");
      }
      segments[segments.length - 1].replacement += tail;
    }
  }

  let out = xml;
  segments.forEach((seg, i) => { out = out.replace(seg.original, `@@P${i}@@`); });
  segments.forEach((seg, i) => { out = out.replace(`@@P${i}@@`, () => seg.replacement); });
  zip.file("word/document.xml", out);
  return { data: zip.generate({ type: "uint8array" }), mode: hasMarkers ? "template" : "auto-map", mapped, unmapped };
}

// ---------- 通用匯出（無範本） ----------
const EA = { ascii: "Calibri", hAnsi: "Calibri", eastAsia: "Microsoft JhengHei" };

function bodyLines(text: string): Paragraph[] {
  return text.split(/\r?\n/).filter((l) => l.trim().length > 0).map(
    (line) =>
      new Paragraph({
        children: [new TextRun({ text: line, font: EA, size: 22 })],
        spacing: { after: 100, line: 340 },
      }),
  );
}

export async function buildGenericDocx(
  kase: Case,
  client: Client,
  grant: GrantProgram,
): Promise<Uint8Array> {
  const children: Paragraph[] = [];
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 160 },
      children: [new TextRun({ text: kase.title, bold: true, font: EA, size: 40, color: "7B341E" })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [new TextRun({ text: `${grant.name}（${grant.agency}）`, font: EA, size: 24 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 480 },
      children: [new TextRun({ text: `申請單位：${client.name}`, font: EA, size: 24 })],
    }),
  );

  for (const ch of kase.chapters ?? []) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 360, after: 160 },
        children: [new TextRun({ text: ch.title, bold: true, font: EA, size: 28, color: "7B341E" })],
      }),
      ...bodyLines(ch.content.trim() || `【待補】${ch.title}`),
    );
  }

  const doc = new Document({
    sections: [{ properties: {}, children }],
  });
  const buf = await Packer.toBuffer(doc);
  return new Uint8Array(buf);
}

// ---------- 主入口 ----------
export async function exportCase(
  kase: Case,
  client: Client,
  grant: GrantProgram,
): Promise<{ data: Uint8Array; mode: "template" | "auto-map" | "generic"; mapped: string[]; unmapped: string[] }> {
  const fields = buildFieldMap(kase, client, grant);
  if (grant.templateData) {
    const bytes = Buffer.from(grant.templateData, "base64");
    const res = fillTemplate(new Uint8Array(bytes), kase.chapters ?? [], fields);
    return { data: res.data, mode: res.mode, mapped: res.mapped, unmapped: res.unmapped };
  }
  const data = await buildGenericDocx(kase, client, grant);
  return { data, mode: "generic", mapped: (kase.chapters ?? []).map((c) => c.title), unmapped: [] };
}
