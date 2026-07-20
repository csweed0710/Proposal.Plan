import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";

export function PageHeader({ title, desc, action }: { title: string; desc?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl font-bold text-primary">{title}</h1>
        {desc && <p className="text-sm text-muted-foreground mt-1">{desc}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatCard({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-3xl font-bold text-primary mt-1">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}

export function EmptyBox({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div className="border border-dashed border-border rounded-xl py-14 text-center text-muted-foreground text-sm">
      <div>{text}</div>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ScoreBadge({ score, target }: { score: number | null; target?: number }) {
  if (score == null) return <span className="text-xs text-muted-foreground">未審核</span>;
  const passed = target != null && score >= target;
  return (
    <span
      className={`inline-flex items-center gap-1 text-sm font-bold px-2.5 py-0.5 rounded-full ${
        passed ? "bg-emerald-100 text-emerald-700" : score >= 60 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
      }`}
    >
      {score} 分{passed && "・已達標"}
    </span>
  );
}

export function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 100000000) return `${(n / 100000000).toFixed(1).replace(/\.0$/, "")} 億`;
  if (n >= 10000) return `${(n / 10000).toFixed(0)} 萬`;
  return n.toLocaleString();
}

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return `${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, "0")}/${String(dt.getDate()).padStart(2, "0")}`;
}

export function deadlineText(rolling: boolean, applyEnd: string | Date | null, note?: string | null): string {
  if (rolling) return "常年受理";
  if (!applyEnd) return note || "時程待確認";
  const left = Math.ceil((new Date(applyEnd).getTime() - Date.now()) / 86400000);
  if (left < 0) return "已截止";
  return `${fmtDate(applyEnd)} 截止（剩 ${left} 天）`;
}

/** 把 Uint8Array 變成真正的 .docx 下載（不需複製貼上） */
export function downloadDocx(data: Uint8Array, filename: string) {
  const blob = new Blob([data as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".docx") ? filename : `${filename}.docx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadPdf(data: Uint8Array, filename: string) {
  const blob = new Blob([data as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
