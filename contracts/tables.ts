// ============================================================================
// 結構化表格：預算表 / 進度甘特表 / KPI 指標表
// 這些是計畫書裡委員最在意、且最容易因算錯而退件的部分——不用純文字處理。
// 表格資料存在 CaseChapter.table（JSON），跟著章節走，不寫死在任何補助案上。
// ============================================================================

/** 章節的表格類型：由補助案的 chapterSchema 宣告（不預設、不寫死） */
export type ChapterTableType = "budget" | "schedule" | "kpi";

export const TABLE_TYPE_LABELS: Record<ChapterTableType, string> = {
  budget: "經費預算表",
  schedule: "預定進度表",
  kpi: "量化效益指標表",
};

// ---------- 經費預算表 ----------
export interface BudgetRow {
  id: string;
  item: string;      // 科目／項目名稱，例如「人事費」「材料費」
  detail: string;    // 內容說明，例如「計畫主持人 1 名 × 12 月」
  unit: string;      // 單位，例如「人月」「式」「批」
  qty: number;       // 數量
  unitPrice: number; // 單價
  grantShare: number; // 補助款分攤
  selfShare: number;  // 自籌款分攤
  note: string;      // 備註（行情依據等）
}

export interface BudgetTable {
  rows: BudgetRow[];
}

export function budgetRowTotal(r: BudgetRow): number {
  return (r.grantShare || 0) + (r.selfShare || 0);
}
export function budgetExpected(r: BudgetRow): number {
  return (r.qty || 0) * (r.unitPrice || 0);
}
export function budgetTotals(t: BudgetTable) {
  const grant = t.rows.reduce((s, r) => s + (r.grantShare || 0), 0);
  const self = t.rows.reduce((s, r) => s + (r.selfShare || 0), 0);
  return { grant, self, total: grant + self };
}
export function emptyBudgetRow(id: string): BudgetRow {
  return { id, item: "", detail: "", unit: "式", qty: 1, unitPrice: 0, grantShare: 0, selfShare: 0, note: "" };
}

// ---------- 預定進度表（甘特表，以月為單位） ----------
export interface ScheduleRow {
  id: string;
  task: string;       // 工作項目
  startMonth: number; // 開始月（1 起）
  endMonth: number;   // 結束月（含）
  checkpoint: string; // 查核點／交付物，例如「完成期中報告」
}

export interface ScheduleTable {
  months: number;     // 計畫總月數（常見 6/12）
  rows: ScheduleRow[];
}

export function emptyScheduleRow(id: string): ScheduleRow {
  return { id, task: "", startMonth: 1, endMonth: 1, checkpoint: "" };
}

// ---------- 量化效益指標表 ----------
export interface KpiRow {
  id: string;
  indicator: string; // 指標，例如「服務長者人次」
  target: string;    // 目標值，例如「1,200 人次／年」
  basis: string;     // 計算基準，例如「每週 2 場 × 15 人 × 40 週」
}

export interface KpiTable {
  rows: KpiRow[];
}

export function emptyKpiRow(id: string): KpiRow {
  return { id, indicator: "", target: "", basis: "" };
}

// ---------- 整合型別 ----------
export type ChapterTable =
  | { type: "budget"; budget: BudgetTable }
  | { type: "schedule"; schedule: ScheduleTable }
  | { type: "kpi"; kpi: KpiTable };

export function emptyChapterTable(type: ChapterTableType): ChapterTable {
  if (type === "budget") return { type, budget: { rows: [emptyBudgetRow("r1")] } };
  if (type === "schedule") return { type, schedule: { months: 12, rows: [emptyScheduleRow("r1")] } };
  return { type, kpi: { rows: [emptyKpiRow("r1")] } };
}

/** 常見禁列／敏感科目（審核時警示用，非硬性拒絕） */
export const BANNED_BUDGET_KEYWORDS = ["交際費", "禮品", "贈品", "餐敘", "旅遊", "獎金", "紅包"];
