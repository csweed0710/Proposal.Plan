// ============================================================================
// 寫作台結構化表格編輯器：預算表 / 進度甘特表 / KPI 指標表
// 資料存在 CaseChapter.table，存章節時一起進資料庫
// ============================================================================
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  budgetRowTotal, budgetExpected, budgetTotals,
  emptyBudgetRow, emptyScheduleRow, emptyKpiRow,
  type BudgetTable, type BudgetRow, type ScheduleTable, type ScheduleRow,
  type KpiTable, type KpiRow,
} from "@contracts/types";

const uid = () => (crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : String(Date.now()));
const num = (v: string) => {
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const money = (n: number) => (n || 0).toLocaleString();

const th = "px-1.5 py-1 text-left text-xs font-medium text-muted-foreground whitespace-nowrap";
const cellInput = "h-8 text-xs px-1.5";

// ============================== 經費預算表 ==============================
export function BudgetEditor({ value, onChange }: { value: BudgetTable; onChange: (t: BudgetTable) => void }) {
  const upd = (id: string, patch: Partial<BudgetRow>) =>
    onChange({ rows: value.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  const totals = budgetTotals(value);
  const selfRatio = totals.total > 0 ? Math.round((totals.self / totals.total) * 100) : 0;

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-secondary/60 border-b">
              <th className={th}>科目</th><th className={th}>內容說明</th><th className={th}>單位</th>
              <th className={th}>數量</th><th className={th}>單價</th>
              <th className={th}>補助款</th><th className={th}>自籌款</th><th className={th}>小計</th>
              <th className={th}>備註（單價依據）</th><th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {value.rows.map((r) => {
              const mismatch = budgetExpected(r) > 0 && Math.abs(budgetExpected(r) - budgetRowTotal(r)) > 1;
              return (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="p-1 min-w-20"><Input className={cellInput} value={r.item} placeholder="人事費" onChange={(e) => upd(r.id, { item: e.target.value })} /></td>
                  <td className="p-1 min-w-36"><Input className={cellInput} value={r.detail} placeholder="主持人 1 名 × 12 月" onChange={(e) => upd(r.id, { detail: e.target.value })} /></td>
                  <td className="p-1 w-16"><Input className={cellInput} value={r.unit} onChange={(e) => upd(r.id, { unit: e.target.value })} /></td>
                  <td className="p-1 w-16"><Input className={cellInput} type="number" value={r.qty || ""} onChange={(e) => upd(r.id, { qty: num(e.target.value) })} /></td>
                  <td className="p-1 w-24"><Input className={cellInput} type="number" value={r.unitPrice || ""} onChange={(e) => upd(r.id, { unitPrice: num(e.target.value) })} /></td>
                  <td className="p-1 w-24"><Input className={cellInput} type="number" value={r.grantShare || ""} onChange={(e) => upd(r.id, { grantShare: num(e.target.value) })} /></td>
                  <td className="p-1 w-24"><Input className={cellInput} type="number" value={r.selfShare || ""} onChange={(e) => upd(r.id, { selfShare: num(e.target.value) })} /></td>
                  <td className={`p-1 text-xs whitespace-nowrap ${mismatch ? "text-destructive font-medium" : ""}`}>
                    {money(budgetRowTotal(r))}
                    {mismatch && <div className="text-[10px]">≠{money(budgetExpected(r))}</div>}
                  </td>
                  <td className="p-1 min-w-24"><Input className={cellInput} value={r.note} onChange={(e) => upd(r.id, { note: e.target.value })} /></td>
                  <td className="p-1 w-8">
                    <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => onChange({ rows: value.rows.filter((x) => x.id !== r.id) })}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
        <Button type="button" variant="outline" size="sm" onClick={() => onChange({ rows: [...value.rows, emptyBudgetRow(uid())] })}>
          <Plus className="w-3.5 h-3.5 mr-1" /> 新增科目
        </Button>
        <span className="ml-auto" />
        <span>補助款 <b>{money(totals.grant)}</b></span>
        <span>自籌款 <b>{money(totals.self)}</b></span>
        <span>總經費 <b className="text-primary">{money(totals.total)}</b></span>
        <span className={selfRatio < 50 ? "text-amber-600 font-medium" : "text-emerald-600"}>自籌 {selfRatio}%{selfRatio < 50 && "（多數案件要求 ≥50%，請確認規定）"}</span>
      </div>
    </div>
  );
}

// ============================== 預定進度表（甘特） ==============================
export function ScheduleEditor({ value, onChange }: { value: ScheduleTable; onChange: (t: ScheduleTable) => void }) {
  const upd = (id: string, patch: Partial<ScheduleRow>) =>
    onChange({ ...value, rows: value.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  const months = Math.min(36, Math.max(1, value.months || 12));

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs">
        計畫總月數
        <Input className="h-8 w-20 text-xs" type="number" min={1} max={36} value={months}
          onChange={(e) => onChange({ ...value, months: Math.min(36, Math.max(1, num(e.target.value))) })} />
        個月
      </div>
      <div className="space-y-1.5">
        {value.rows.map((r) => (
          <div key={r.id} className="rounded-md border p-2 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Input className="h-8 text-xs flex-1" value={r.task} placeholder="工作項目（如：社區需求調查）"
                onChange={(e) => upd(r.id, { task: e.target.value })} />
              <span className="text-xs text-muted-foreground whitespace-nowrap">第</span>
              <Input className="h-8 w-14 text-xs" type="number" min={1} max={months} value={r.startMonth}
                onChange={(e) => upd(r.id, { startMonth: num(e.target.value) })} />
              <span className="text-xs text-muted-foreground whitespace-nowrap">月到第</span>
              <Input className="h-8 w-14 text-xs" type="number" min={1} max={months} value={r.endMonth}
                onChange={(e) => upd(r.id, { endMonth: num(e.target.value) })} />
              <span className="text-xs text-muted-foreground whitespace-nowrap">月</span>
              <button type="button" className="text-muted-foreground hover:text-destructive shrink-0"
                onClick={() => onChange({ ...value, rows: value.rows.filter((x) => x.id !== r.id) })}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <Input className="h-8 text-xs" value={r.checkpoint} placeholder="查核點（如：完成 100 份問卷、提出期中報告）"
              onChange={(e) => upd(r.id, { checkpoint: e.target.value })} />
            <div className="grid gap-px bg-border rounded overflow-hidden" style={{ gridTemplateColumns: `repeat(${months}, 1fr)` }}>
              {Array.from({ length: months }, (_, i) => (
                <div key={i} className={`h-3.5 ${i + 1 >= r.startMonth && i + 1 <= r.endMonth ? "bg-primary/70" : "bg-secondary"}`} title={`第 ${i + 1} 月`} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={() => onChange({ ...value, rows: [...value.rows, emptyScheduleRow(uid())] })}>
        <Plus className="w-3.5 h-3.5 mr-1" /> 新增工作項目
      </Button>
    </div>
  );
}

// ============================== 量化效益指標表 ==============================
export function KpiEditor({ value, onChange }: { value: KpiTable; onChange: (t: KpiTable) => void }) {
  const upd = (id: string, patch: Partial<KpiRow>) =>
    onChange({ rows: value.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) });

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-secondary/60 border-b">
              <th className={th}>效益指標</th><th className={th}>目標值（必填數字）</th><th className={th}>計算基準</th><th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {value.rows.map((r) => (
              <tr key={r.id} className="border-b last:border-0">
                <td className="p-1 min-w-36"><Input className={cellInput} value={r.indicator} placeholder="服務長者人次" onChange={(e) => upd(r.id, { indicator: e.target.value })} /></td>
                <td className="p-1 min-w-32">
                  <Input className={`${cellInput} ${r.indicator && !/\d/.test(r.target) ? "border-destructive" : ""}`}
                    value={r.target} placeholder="1,200 人次/年" onChange={(e) => upd(r.id, { target: e.target.value })} />
                </td>
                <td className="p-1 min-w-44"><Input className={cellInput} value={r.basis} placeholder="每週 2 場 × 15 人 × 40 週" onChange={(e) => upd(r.id, { basis: e.target.value })} /></td>
                <td className="p-1 w-8">
                  <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => onChange({ rows: value.rows.filter((x) => x.id !== r.id) })}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={() => onChange({ rows: [...value.rows, emptyKpiRow(uid())] })}>
        <Plus className="w-3.5 h-3.5 mr-1" /> 新增指標
      </Button>
    </div>
  );
}
