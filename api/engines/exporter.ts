// 匯出引擎：把完成的案件變成真正的 .docx 檔案。
// 三種模式：
//   template  — 範本裡有【章節:key】【欄位:key】標記 → 逐點替換（最精準）
//   auto-map  — 範本沒有標記 → 用章節標題比對，把內容插到同名標題後面
//   generic   — 沒有範本 → 直接產出排版完整的計畫書
import PizZip from "pizzip";
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType,
} from "docx";
import type { CaseChapter } from "../../contracts/types";
import { budgetRowTotal, budgetTotals } from "../../contracts/tables";
import type { Case, Client, GrantProgram } from "../../db/schema";

// ============================================================================
// 結構化表格（預算/進度/KPI）→ 真正的 Word 表格
// 先產生共用的「矩陣」，再依模式轉成 docx Table 或 raw w:tbl XML
// ============================================================================
const fmtNum = (n: number) => (n || 0).toLocaleString("en-US");

interface Matrix {
  header: string[];
  rows: string[][];
}

function chapterMatrix(ch: CaseChapter): Matrix | null {
  if (!ch.table) return null;
  if (ch.table.type === "budget") {
    const t = ch.table.budget;
    if (t.rows.length === 0) return null;
    const rows = t.rows.map((r) => [
      r.item, r.detail, r.unit, String(r.qty ?? ""), fmtNum(r.unitPrice),
      fmtNum(r.grantShare), fmtNum(r.selfShare), fmtNum(budgetRowTotal(r)), r.note,
    ]);
    const totals = budgetTotals(t);
    rows.push(["合計", "", "", "", "", fmtNum(totals.grant), fmtNum(totals.self), fmtNum(totals.total), ""]);
    return { header: ["科目", "內容說明", "單位", "數量", "單價", "補助款", "自籌款", "小計", "備註"], rows };
  }
  if (ch.table.type === "schedule") {
    const t = ch.table.schedule;
    if (t.rows.length === 0) return null;
    const mcols = Array.from({ length: t.months }, (_, i) => String(i + 1));
    const rows = t.rows.map((r) => [
      r.task,
      ...Array.from({ length: t.months }, (_, i) => (i + 1 >= r.startMonth && i + 1 <= r.endMonth ? "■" : "")),
      r.checkpoint,
    ]);
    return { header: ["工作項目/月份", ...mcols, "查核點"], rows };
  }
  if (ch.table.type === "kpi") {
    const t = ch.table.kpi;
    if (t.rows.length === 0) return null;
    return { header: ["效益指標", "目標值", "計算基準"], rows: t.rows.map((r) => [r.indicator, r.target, r.basis]) };
  }
  return null;
}

/** generic 模式用：docx 函式庫的真表格 */
function docxTable(m: Matrix): Table {
  const cellPara = (text: string, bold: boolean) =>
    new Paragraph({ children: [new TextRun({ text, bold, font: EA, size: 18 })] });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: m.header.map((h) => new TableCell({ shading: { fill: "EFE6DE" }, children: [cellPara(h, true)] })),
      }),
      ...m.rows.map(
        (r) => new TableRow({ children: r.map((c) => new TableCell({ children: [cellPara(c, false)] })) }),
      ),
    ],
  });
}

/** template / auto-map 模式用：raw WordprocessingML 表格 */
function tableXml(m: Matrix): string {
  const cols = m.header.length;
  const w = Math.round(9000 / cols);
  const cell = (text: string, header: boolean) =>
    `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${header ? '<w:shd w:val="clear" w:fill="EFE6DE"/>' : ""}</w:tcPr>` +
    `<w:p><w:r><w:rPr>${header ? "<w:b/>" : ""}<w:rFonts w:eastAsia="Microsoft JhengHei"/><w:sz w:val="18"/></w:rPr>` +
    `<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p></w:tc>`;
  const row = (cells: string[], header: boolean) => `<w:tr>${cells.map((c) => cell(c, header)).join("")}</w:tr>`;
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>` +
    `<w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"]
      .map((b) => `<w:${b} w:val="single" w:sz="4" w:color="A6A6A6"/>`)
      .join("")}</w:tblBorders></w:tblPr>` +
    `<w:tblGrid>${Array.from({ length: cols }, () => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>` +
    row(m.header, true) +
    m.rows.map((r) => row(r, false)).join("") +
    `</w:tbl>`
  );
}

/** 章節的表格 XML（無表格回空字串） */
function chapterTableXml(ch: CaseChapter): string {
  const m = chapterMatrix(ch);
  return m ? tableXml(m) : "";
}

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
          // 敘述文字填入標記段，結構化表格以真表格接在後面
          seg.replacement = rebuildParagraph(seg.original, ch.content.trim() || `【待補】${ch.title}`) + chapterTableXml(ch);
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
        seg.replacement = seg.original + body + chapterTableXml(ch);
      }
    }
    const leftover = chapters.filter((c) => !used.has(c.key));
    if (leftover.length > 0) {
      let tail = "";
      for (const ch of leftover) {
        unmapped.push(ch.title);
        tail +=
          `<w:p><w:r><w:rPr><w:b/><w:rFonts w:eastAsia="Microsoft JhengHei"/><w:sz w:val="28"/></w:rPr><w:t xml:space="preserve">${esc(ch.title)}</w:t></w:r></w:p>` +
          (ch.content.trim() || `【待補】${ch.title}`).split(/\r?\n/).map(bodyPara).join("") +
          chapterTableXml(ch);
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
  const children: Array<Paragraph | Table> = [];
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
    // 結構化表格 → 真表格（委員要看的是表格，不是段落）
    const m = chapterMatrix(ch);
    if (m) {
      children.push(docxTable(m));
      children.push(new Paragraph({ spacing: { after: 200 }, children: [] }));
    }
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
