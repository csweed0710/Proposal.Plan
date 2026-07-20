// ============================================================================
// 公告解析引擎：貼文字或上傳檔案（PDF/docx/txt）→ 結構化補助案草稿
// 三層設計：擷取文字 → AI 解析（有 key 時）→ 規則解析兜底＋欄位級消毒合併
// ============================================================================
import { createRequire as makeRequire } from "node:module";
import { chat } from "../llm";
import { docxToText } from "./reference";
import { GRANT_CATEGORIES, ORG_TYPES } from "../../contracts/types";
import type { AnnouncementAnalysis, ChapterSpec, RubricItem } from "../../contracts/types";

// pdf-parse 是 CJS；走 lib 路徑避開它 index.js 的 debug 區塊（打包後會誤觸發）
// 注意：不能命名成 createRequire/require——esbuild 的 banner 已注入同名變數，會撞名
const localRequire = makeRequire(import.meta.url);
const pdfParse = localRequire("pdf-parse/lib/pdf-parse.js") as (
  b: Buffer
) => Promise<{ text: string; numpages: number }>;

// ---------- 檔案 → 純文字 ----------
export async function extractAnnouncementText(fileName: string, data: Uint8Array): Promise<string> {
  const lower = fileName.toLowerCase();
  let text = "";
  if (lower.endsWith(".docx")) {
    text = docxToText(data);
  } else if (lower.endsWith(".pdf")) {
    try {
      const r = await pdfParse(Buffer.from(data));
      text = r.text;
    } catch {
      throw new Error("PDF 讀取失敗——檔案可能損毀或加密，請改用複製貼上文字");
    }
  } else if (lower.endsWith(".txt") || lower.endsWith(".md")) {
    text = Buffer.from(data).toString("utf8");
  } else {
    throw new Error("只支援 PDF、Word(.docx)、純文字(.txt)——其他格式請另存或複製文字貼上");
  }
  if (text.trim().length < 20) {
    throw new Error("從檔案讀不到足夠文字——掃描圖檔型的 PDF 無法解析，請改用複製貼上文字");
  }
  return text;
}

// ---------- 共用小工具 ----------
const ROC_DATE = /(?<![\d])(1[0-1]\d|\d{2,3})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g;
const AD_DATE = /(20\d{2})\s*[年\/\-.]\s*(\d{1,2})\s*[月\/\-.]\s*(\d{1,2})\s*日?/g;

interface DatedHit { iso: string; index: number; raw: string }

function allDates(text: string): DatedHit[] {
  const hits: DatedHit[] = [];
  for (const m of text.matchAll(ROC_DATE)) {
    const y = Number(m[1]);
    const year = y > 1911 ? y : y + 1911;
    hits.push({
      iso: `${year}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`,
      index: m.index ?? 0,
      raw: m[0],
    });
  }
  for (const m of text.matchAll(AD_DATE)) {
    hits.push({
      iso: `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`,
      index: m.index ?? 0,
      raw: m[0],
    });
  }
  return hits.sort((a, b) => a.index - b.index);
}

/** 任何寬鬆日期字串（民國或西元）→ YYYY-MM-DD；認不出來給 null */
export function toIsoDate(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const hits = allDates(s);
  return hits[0]?.iso ?? null;
}

/** 寬鬆金額（150萬、1,500,000、"150萬元"）→ 元為單位的整數 */
export function toAmount(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return normalizeAmount(Math.round(v));
  const s = String(v).replace(/[,\s]/g, "");
  const m = s.match(/([\d.]+)\s*(億元|億|萬元|萬|元)?/);
  if (!m) return null;
  let n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  if (m[2]?.startsWith("億")) n *= 100000000;
  else if (m[2]?.startsWith("萬")) n *= 10000;
  return normalizeAmount(Math.round(n));
}

// AI 有時回「150」（其實是 150 萬）。台灣補助案上限鮮少低於一萬元，低於此值視為「萬」
function normalizeAmount(n: number): number {
  if (n > 0 && n < 10000) return n * 10000;
  return n;
}

const AGENCIES = [
  "文化部", "教育部", "經濟部", "數位發展部", "農業部", "衛生福利部", "環境部",
  "交通部", "內政部", "勞動部", "法務部", "財政部", "國家發展委員會", "國發會",
  "國家科學及技術委員會", "國科會", "原住民族委員會", "原民會", "客家委員會", "客委會",
  "海洋委員會", "僑務委員會", "金融監督管理委員會", "故宮博物院",
];

const CATEGORY_HINTS: [RegExp, string][] = [
  [/文化|藝術|文創|村落|社造/, "文化藝術"],
  [/創生|地方|社區營造/, "地方創生"],
  [/研發|創新|SBIR|技術開發/, "創新研發"],
  [/社會|公益|福利|長照|弱勢/, "社會公益"],
  [/數位|轉型|雲端|AI|資訊/, "數位轉型"],
  [/環保|永續|節能|減碳|綠/, "環保永續"],
  [/青年|創業|青創|新創/, "青年創業"],
];

/** 找「起～訖」日期對：自114年3月1日起至114年4月15日止、114/3/1～4/15 等 */
function extractRanges(text: string): { start: string; end: string; index: number }[] {
  const D = String.raw`(?:(1[0-1]\d|\d{2,3})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日|(20\d{2})\s*[年\/\-.]\s*(\d{1,2})\s*[月\/\-.]\s*(\d{1,2})\s*日?)`;
  const re = new RegExp(`${D}\\s*(?:起\\s*)?[至～~—–]\\s*${D}`, "g");
  const norm = (y?: string, mo?: string, da?: string, gy?: string, gm?: string, gd?: string) => {
    if (gy) return `${gy}-${gm!.padStart(2, "0")}-${gd!.padStart(2, "0")}`;
    const yr = Number(y) > 1911 ? Number(y) : Number(y) + 1911;
    return `${yr}-${mo!.padStart(2, "0")}-${da!.padStart(2, "0")}`;
  };
  const out: { start: string; end: string; index: number }[] = [];
  for (const m of text.matchAll(re)) {
    out.push({
      start: norm(m[1], m[2], m[3], m[4], m[5], m[6]),
      end: norm(m[7], m[8], m[9], m[10], m[11], m[12]),
      index: m.index ?? 0,
    });
  }
  return out;
}

// ---------- 規則解析（無 AI 時的兜底；寧缺勿濫，存疑標 needsVerification） ----------
export function ruleParseAnnouncement(text: string): AnnouncementAnalysis {
  const dates = allDates(text);
  const near = (hit: DatedHit, re: RegExp, span = 30) =>
    re.test(text.slice(Math.max(0, hit.index - span), hit.index + hit.raw.length + span));

  // 起訖：先找「受理/申請」附近的日期對；沒有才退單日期的關鍵字啟發式
  const ranges = extractRanges(text);
  const applyRange =
    ranges.find((r) => /受理|申請|收件|報名/.test(text.slice(Math.max(0, r.index - 30), r.index))) ?? ranges[0];
  const startHit = dates.find((d) => near(d, /受理|申請|收件|報名/) && near(d, /自|起|開始/));
  const endHit = [...dates].reverse().find((d) =>
    /截止|為止|止，|止。|止$/.test(text.slice(d.index + d.raw.length, d.index + d.raw.length + 12))
  );
  const applyStart = applyRange?.start ?? startHit?.iso ?? dates[0]?.iso ?? null;
  const applyEnd = applyRange?.end ?? endHit?.iso ?? (dates.length > 1 ? dates[dates.length - 1].iso : null);

  // 金額：只在「補助/上限/每案」附近的金額才算
  const amountLines = text.split("\n").filter((l) => /補助|獎助|上限|最高|每案|至多|額度/.test(l));
  let amountMax: number | null = null;
  for (const line of amountLines) {
    for (const m of line.matchAll(/([\d,]+(?:\.\d+)?)\s*(億元|億|萬元|萬|元)/g)) {
      const v = toAmount(m[0]);
      if (v && v >= 1000 && (amountMax == null || v > amountMax)) amountMax = v;
    }
  }
  const selfLine = text.split("\n").find((l) => /自籌|配合款|自付|補助比例|不得超過/.test(l));

  // 名稱：找「○○補助計畫/要點/須知/簡章」；機關：已知部會或縣市局處
  const nameM =
    text.slice(0, 800).match(/([一-龥A-Za-z0-9（）()年度]{4,45}(?:補助|獎助)(?:計畫|要點|辦法|須知|簡章|專案))/) ??
    text.slice(0, 800).match(/([一-龥A-Za-z0-9（）()年度]{4,45}補助[一-龥]{0,12})/);
  const name =
    nameM?.[1]?.replace(/^[年度\d]+/, (s) => s).trim() ??
    text.split("\n").map((l) => l.trim()).find((l) => l.length >= 6 && l.length <= 50 && !/函|發文|字號|附件/.test(l)) ??
    "未命名補助案";

  let agency = AGENCIES.find((a) => text.includes(a)) ?? "";
  if (!agency) {
    const localM = text.match(/[一-龥]{2,6}縣市政府(?:[一-龥]{2,8}(?:局|處))?/) ?? text.match(/[一-龥]{2,10}(?:文化局|教育局|產業發展局|經濟發展局)/);
    agency = localM?.[0] ?? "";
  }

  const orgTypes = ORG_TYPES.filter((t) => text.includes(t));
  if (/依法.*立案|登記.*法人|立案.*團體/.test(text) && orgTypes.length === 0) orgTypes.push("社團法人", "財團法人");

  const category = CATEGORY_HINTS.find(([re]) => re.test(text))?.[1] ?? "其他";

  // 章節：鎖定「計畫書/申請書應包含」段落抽編號項目；找不到再用關鍵字掃全文
  const chapSectionM = text.match(/(計畫書|申請書)[^。\n]{0,30}(應|內容|包含|包括|載明)[^。\n]{0,10}/);
  const chapWindow = chapSectionM
    ? text.slice(chapSectionM.index ?? 0, (chapSectionM.index ?? 0) + 2500)
    : text;
  const chapMatches = [
    ...chapWindow.matchAll(
      /(?:^|\n)\s*(?:[（(]?第?[一二三四五六七八九十]+[）)、.．]?|[（(]\d+[）)]|\d+[.、．])\s*([一-龥A-Za-z（）()]{2,20}?)\s*(?=[：:。；\n]|$)/g
    ),
  ];
  const seen = new Set<string>();
  const chapters: ChapterSpec[] = [];
  for (const m of chapMatches) {
    const title = m[1].trim().replace(/[（(].*$/, "");
    if (title.length < 2 || title.length > 18 || seen.has(title)) continue;
    if (/申請|資格|方式|期間|審查|評分|撥款|附件|應備|文件|聯絡|備註|目的|依據|補助對象|經費來源/.test(title)) continue;
    seen.add(title);
    chapters.push({ key: `ch_${chapters.length}`, title, required: true, guidance: "" });
    if (chapters.length >= 14) break;
  }
  // 同一行連排寫法：（一）創業構想（二）市場分析（三）財務規劃
  if (chapters.length === 0) {
    for (const m of chapWindow.matchAll(/[（(][一二三四五六七八九十]+[）)]\s*([一-龥A-Za-z]{2,18}?)\s*(?=[（(：:。；、，\n]|$)/g)) {
      const title = m[1].trim();
      if (title.length < 2 || seen.has(title)) continue;
      if (/申請|資格|方式|期間|審查|評分|撥款|附件|應備|文件|聯絡|備註|目的|依據|補助對象|經費來源/.test(title)) continue;
      seen.add(title);
      chapters.push({ key: `ch_${chapters.length}`, title, required: true, guidance: "" });
      if (chapters.length >= 14) break;
    }
  }
  if (chapters.length === 0) {
    const kw = [...text.matchAll(/(計畫摘要|計畫緣起|背景|現況分析|計畫目標|執行內容|執行方法|實施策略|預定進度|組織架構|團隊|人力配置|執行實績|經費預算|預算明細|預期效益|永續經營|風險評估)/g)];
    for (const m of kw) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      chapters.push({ key: `ch_${chapters.length}`, title: m[1], required: true, guidance: "" });
      if (chapters.length >= 14) break;
    }
  }

  // 評分：鎖定「評分/審查」段落找「項目 N 分」
  const rubSectionM = text.match(/評分|審查(標準|重點|項目)|配分/);
  const rubWindow = rubSectionM ? text.slice(rubSectionM.index ?? 0, (rubSectionM.index ?? 0) + 1200) : "";
  const rubric: RubricItem[] = [];
  if (rubWindow) {
    for (const m of rubWindow.matchAll(/([一-龥A-Za-z（）()、]{2,16})[（(]\s*(\d{1,2})\s*分\s*[）)]/g)) {
      const item = m[1].replace(/^[、，.\s]+|[、，.\s]+$/g, "");
      if (item.length < 2 || /占分|配分|總分|滿分/.test(item)) continue;
      rubric.push({ item, points: Number(m[2]), description: "" });
      if (rubric.length >= 10) break;
    }
  }

  const slice = (re: RegExp, len: number) => {
    const m = text.match(re);
    return m ? text.slice(m.index ?? 0, (m.index ?? 0) + len).replace(/\s+/g, " ").trim() : "";
  };

  return {
    name: name.slice(0, 60),
    agency,
    category,
    description: text.replace(/\s+/g, " ").slice(0, 200),
    applyStart,
    applyEnd,
    rolling: /隨到隨|常年受理|随到随|滾動式受理/.test(text),
    deadlineNote: "",
    amountMin: null,
    amountMax,
    selfFundNote: selfLine?.replace(/\s+/g, " ").slice(0, 120) ?? "",
    orgTypes,
    eligibilityNote: slice(/申請資格|補助對象|申請條件/, 150),
    attachmentsNote: slice(/應備文件|應檢附|應附文件|檢附文件/, 150),
    sourceUrl: "",
    status: "open",
    needsVerification: true,
    chapterSchema: chapters,
    rubric,
    usedAI: false,
    warnings: [
      "目前為規則解析（未啟用 AI）——日期、金額、章節請逐一核對",
      ...(applyEnd ? [] : ["找不到申請截止日，請手動填寫"]),
      ...(agency ? [] : ["認不出主辦機關，請手動填寫"]),
    ],
    extractedChars: text.length,
  };
}

// ---------- AI 解析 ----------
const AI_SYSTEM = `你是台灣政府補助案公告的解析專家。從公告全文抽出結構化資料，「只輸出一個 JSON 物件」，不要任何說明文字。
欄位規則（認不出來就給 null 或空陣列，寧缺勿濫，絕對不要猜）：
- name：計畫正式全名（含年度，不含文號、不含「函」「公告」等公文用語）
- agency：主辦機關全銜（例如「文化部」「台北市政府文化局」）
- category：只能是 ${GRANT_CATEGORIES.join("、")} 其中之一
- description：補助目的摘要，120 字內
- applyStart / applyEnd：受理申請的起訖日，YYYY-MM-DD 格式；民國年請 +1911 換算；只取「受理申請期間」，其他日期（審查、撥款、公告日）不要
- rolling：只有公告明寫「隨到隨審／常年受理／滾動受理」才 true
- amountMin / amountMax：每案補助金額上下限，以「元」為單位的純數字（150萬元→1500000）
- selfFundNote：自籌款／補助比例規定，80 字內
- orgTypes：申請資格中的組織型態，只能從 ${ORG_TYPES.join("、")} 挑選
- eligibilityNote：申請資格重點，120 字內
- attachmentsNote：應備文件重點，150 字內
- chapterSchema：從「計畫書內容／申請書應載明事項」抽取章節架構，每章 {"title":"章名（18字內）","required":true,"guidance":"抄錄公告對該章的具體要求（80字內）","tableType":"budget|schedule|kpi（預算章給budget、進度章給schedule、量化效益章給kpi，其他省略此欄）","wordLimit":數字（公告有字數限制才給）}；公告沒寫章節就給空陣列
- rubric：從「評分項目／審查標準」抽取，每項 {"item":"項目名","points":配分數字,"description":"評分說明（60字內）"}；公告沒寫就給空陣列
輸出格式：{"name","agency","category","description","applyStart","applyEnd","rolling","amountMin","amountMax","selfFundNote","orgTypes":[],"eligibilityNote","attachmentsNote","chapterSchema":[],"rubric":[]}`;

interface AiRaw {
  name?: unknown; agency?: unknown; category?: unknown; description?: unknown;
  applyStart?: unknown; applyEnd?: unknown; rolling?: unknown;
  amountMin?: unknown; amountMax?: unknown; selfFundNote?: unknown;
  orgTypes?: unknown; eligibilityNote?: unknown; attachmentsNote?: unknown;
  chapterSchema?: unknown; rubric?: unknown;
}

const str = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strArr = (v: unknown, allowed: readonly string[]) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && allowed.includes(x)) : [];

function sanitizeChapters(v: unknown): ChapterSpec[] {
  if (!Array.isArray(v)) return [];
  const out: ChapterSpec[] = [];
  for (const raw of v.slice(0, 20)) {
    if (typeof raw !== "object" || raw == null) continue;
    const o = raw as Record<string, unknown>;
    const title = str(o.title, 30);
    if (!title) continue;
    const ch: ChapterSpec = {
      key: `ch_${out.length}`,
      title,
      required: o.required !== false,
      guidance: str(o.guidance, 200),
    };
    if (o.tableType === "budget" || o.tableType === "schedule" || o.tableType === "kpi") ch.tableType = o.tableType;
    if (typeof o.wordLimit === "number" && o.wordLimit >= 50) ch.wordLimit = Math.round(o.wordLimit);
    out.push(ch);
  }
  return out;
}

function sanitizeRubric(v: unknown): RubricItem[] {
  if (!Array.isArray(v)) return [];
  const out: RubricItem[] = [];
  for (const raw of v.slice(0, 12)) {
    if (typeof raw !== "object" || raw == null) continue;
    const o = raw as Record<string, unknown>;
    const item = str(o.item, 30);
    const points = typeof o.points === "number" ? Math.round(o.points) : NaN;
    if (!item || !Number.isFinite(points) || points <= 0 || points > 100) continue;
    out.push({ item, points, description: str(o.description, 150) });
  }
  return out;
}

/** AI 為主、規則補洞：AI 缺的欄位才用規則猜測值，並標記待查證 */
export async function analyzeAnnouncement(text: string): Promise<AnnouncementAnalysis> {
  const rule = ruleParseAnnouncement(text);
  const ai = await chat([
    { role: "system", content: AI_SYSTEM },
    { role: "user", content: text.slice(0, 15000) },
  ]);
  if (!ai) return rule;

  let raw: AiRaw;
  try {
    const block = ai.match(/\{[\s\S]*\}/);
    if (!block) throw new Error("no json");
    raw = JSON.parse(block[0]) as AiRaw;
  } catch {
    return { ...rule, warnings: ["AI 回應格式異常，已改用規則解析——請核對欄位", ...rule.warnings] };
  }

  const warnings: string[] = [];
  const pickDate = (aiV: unknown, ruleV: string | null, label: string) => {
    const aiD = toIsoDate(aiV);
    if (aiD) return aiD;
    if (ruleV) { warnings.push(`${label}由規則推測，請核對`); return ruleV; }
    warnings.push(`找不到${label}，請手動填寫`);
    return null;
  };

  const applyStart = pickDate(raw.applyStart, rule.applyStart, "申請開始日");
  const applyEnd = pickDate(raw.applyEnd, rule.applyEnd, "申請截止日");
  let amountMin = toAmount(raw.amountMin);
  let amountMax = toAmount(raw.amountMax);
  if (amountMax == null && rule.amountMax != null) {
    amountMax = rule.amountMax;
    warnings.push("補助上限由規則推測，請核對");
  }
  if (amountMin != null && amountMax != null && amountMin > amountMax) [amountMin, amountMax] = [amountMax, amountMin];

  const chapters = sanitizeChapters(raw.chapterSchema);
  const rubric = sanitizeRubric(raw.rubric);
  const category = GRANT_CATEGORIES.includes(str(raw.category) as (typeof GRANT_CATEGORIES)[number])
    ? str(raw.category)
    : rule.category;
  const rolling = raw.rolling === true || rule.rolling;

  return {
    name: str(raw.name, 60) || rule.name,
    agency: str(raw.agency, 40) || rule.agency,
    category,
    description: str(raw.description, 300) || rule.description,
    applyStart,
    applyEnd,
    rolling,
    deadlineNote: "",
    amountMin,
    amountMax,
    selfFundNote: str(raw.selfFundNote, 120) || rule.selfFundNote,
    orgTypes: strArr(raw.orgTypes, ORG_TYPES).length ? strArr(raw.orgTypes, ORG_TYPES) : rule.orgTypes,
    eligibilityNote: str(raw.eligibilityNote, 200) || rule.eligibilityNote,
    attachmentsNote: str(raw.attachmentsNote, 200) || rule.attachmentsNote,
    sourceUrl: "",
    status: "open",
    needsVerification: !applyStart || !applyEnd,
    chapterSchema: chapters.length ? chapters : rule.chapterSchema,
    rubric: rubric.length ? rubric : rule.rubric,
    usedAI: true,
    warnings,
    extractedChars: text.length,
  };
}
