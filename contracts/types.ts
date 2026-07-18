export * from "./errors";

// ============================================================================
// 共用型別 — 前端後端都從這裡拿，任何補助案的格式都是資料，不是程式碼
// ============================================================================

/** 補助案官方章節格式中的一章（由公告決定，逐案不同） */
export interface ChapterSpec {
  key: string;          // 機器鍵，例如 "background"（自訂章節可用任意唯一字串）
  title: string;        // 官方章節名稱，例如「計畫緣起與背景」
  required: boolean;    // 是否為必要章節
  guidance: string;     // 寫作指引／評審重點（來自申請須知）
  weight?: number;      // 相對重要性 1–5（配分高低 → 篇幅分配）
}

/** 官方評分標準中的一项 */
export interface RubricItem {
  item: string;         // 評分項目，例如「創新性」
  points: number;       // 配分
  description: string;  // 評分說明
}

/** 動態問卷中的一題（由章節格式＋評分標準即時生成） */
export interface IntakeQuestion {
  id: string;
  chapterKey: string;   // 對應哪一章（"__profile__" 表示組織基本資料）
  question: string;
  hint: string;
  answer: string;
  prefilled: boolean;   // 是否由客戶記憶自動帶入
}

/** 案件中的一章（從補助案快照而來，之後可獨立編輯） */
export interface CaseChapter {
  key: string;
  title: string;
  required: boolean;
  guidance: string;
  weight?: number;
  content: string;
  status: "empty" | "draft" | "done";
}

/** 審核的一個面向 */
export interface ReviewDimension {
  key: string;
  label: string;
  score: number;        // 0–100
  weight: number;       // 佔總分比重（0–1）
  summary: string;
}

/** 審核發現的問題＋改進方向 */
export interface ReviewIssue {
  id: string;
  severity: "high" | "mid" | "low";
  dimension: string;    // 對應 ReviewDimension.key
  chapterKey: string;   // "ALL" 表示跨章節
  location: string;     // 位置描述（章節／段落）
  problem: string;      // 問題是什麼
  suggestion: string;   // 改進方向（怎麼改）
  status: "open" | "fixed";
}

/** 適配分析結果 */
export interface MatchResult {
  grantId: number;
  grantName: string;
  agency: string;
  category: string;
  applyEnd: string | null;
  rolling: boolean;
  amountMax: number | null;
  score: number;        // 0–100
  level: "強力推薦" | "適合" | "可考慮" | "不建議";
  reasons: string[];
  warnings: string[];
}

export const CASE_STATUSES = ["intake", "writing", "review", "done"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  intake: "問卷收料",
  writing: "撰寫中",
  review: "審核中",
  done: "已完成",
};

export const GRANT_CATEGORIES = [
  "創新研發",
  "地方創生",
  "文化藝術",
  "社會公益",
  "數位轉型",
  "環保永續",
  "青年創業",
  "其他",
] as const;

export const ORG_TYPES = [
  "公司",
  "社團法人",
  "財團法人",
  "工作室",
  "獨資合夥",
  "個人",
] as const;

/** LLM 設定狀態（不回傳金鑰本身） */
export interface LlmStatus {
  configured: boolean;
  model: string;
  mode: "ai" | "rule";
}

// ============================================================================
// 官方範本填寫
// ============================================================================

/**
 * 範本標記語法（放在官方 .docx 範本裡，匯出時被替換）：
 *   【章節:章節key】 → 該章完整內容（可多行）
 *   【欄位:欄位key】 → 客戶／案件基本資料
 * 沒有放標記的範本：系統改以「章節標題比對」，把內容插到同名標題後面。
 */

export interface TemplateFieldDef {
  key: string;
  label: string;
}

/** 可用於【欄位:key】的欄位清單（前端小抄與後端填值共用） */
export const TEMPLATE_FIELDS: TemplateFieldDef[] = [
  { key: "case_title", label: "案件名稱" },
  { key: "grant_name", label: "補助案名稱" },
  { key: "agency", label: "主辦機關" },
  { key: "org_name", label: "組織全名" },
  { key: "org_type", label: "組織型態" },
  { key: "tax_id", label: "統一編號／立案字號" },
  { key: "founded_year", label: "成立年份" },
  { key: "city", label: "所在地" },
  { key: "employees", label: "專職／兼職人數" },
  { key: "capital", label: "資本額／基金" },
  { key: "revenue", label: "年均營業額" },
  { key: "contact_name", label: "聯絡人姓名" },
  { key: "contact_title", label: "聯絡人職稱" },
  { key: "contact_phone", label: "聯絡電話" },
  { key: "contact_email", label: "聯絡 Email" },
  { key: "date", label: "今天日期（西元）" },
  { key: "date_roc", label: "今天日期（民國）" },
  { key: "year_roc", label: "今年（民國年）" },
];

/** 匯出結果 */
export interface ExportResult {
  filename: string;
  mode: "template" | "auto-map" | "generic";
  mapped: string[];    // 成功對應的章節標題
  unmapped: string[];  // 範本裡找不到位置、附在文末的章節標題
  data: Uint8Array;
}
