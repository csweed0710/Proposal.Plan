import type { CaseChapter } from "../../contracts/types";
import { budgetRowTotal, budgetTotals } from "../../contracts/tables";

/** 將結構化表格轉成 AI 可讀、也可供數字來源查核的文字事實。 */
export function chapterTableContext(chapter: CaseChapter): string {
  if (!chapter.table) return "";

  if (chapter.table.type === "budget") {
    const table = chapter.table.budget;
    const rows = table.rows.map((row, index) =>
      `${index + 1}. ${row.item || "未命名科目"}：${row.detail || "無說明"}；` +
      `數量 ${row.qty} ${row.unit || "單位未填"}；單價 ${row.unitPrice} 元；` +
      `補助款 ${row.grantShare} 元；自籌款 ${row.selfShare} 元；` +
      `列合計 ${budgetRowTotal(row)} 元${row.note ? `；依據：${row.note}` : ""}`,
    );
    const totals = budgetTotals(table);
    return [
      `【${chapter.title}｜經費預算表】`,
      ...rows,
      `補助款合計 ${totals.grant} 元；自籌款合計 ${totals.self} 元；總經費 ${totals.total} 元。`,
    ].join("\n");
  }

  if (chapter.table.type === "schedule") {
    const table = chapter.table.schedule;
    return [
      `【${chapter.title}｜預定進度表】`,
      `計畫總期程 ${table.months} 月。`,
      ...table.rows.map((row, index) =>
        `${index + 1}. ${row.task || "未命名工作"}：第 ${row.startMonth} 月至第 ${row.endMonth} 月；` +
        `查核點：${row.checkpoint || "未填"}`,
      ),
    ].join("\n");
  }

  return [
    `【${chapter.title}｜量化效益指標表】`,
    ...chapter.table.kpi.rows.map((row, index) =>
      `${index + 1}. ${row.indicator || "未命名指標"}：目標 ${row.target || "未填"}；` +
      `計算基準：${row.basis || "未填"}`,
    ),
  ].join("\n");
}
