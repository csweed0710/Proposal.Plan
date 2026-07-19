import { Link, useNavigate, useParams } from "react-router";
import { Pencil, Target, Trash2, ArrowRight } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { PageHeader, fmtMoney, ScoreBadge, EmptyBox } from "@/components/bits";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CASE_STATUS_LABELS, type CaseStatus } from "@contracts/types";

export default function ClientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const c = trpc.clients.get.useQuery({ id: Number(id) });
  const allCases = trpc.cases.list.useQuery();
  const remove = trpc.clients.remove.useMutation({
    onSuccess: () => { utils.clients.list.invalidate(); navigate("/clients"); },
  });

  if (!c.data) return <div className="text-muted-foreground">載入中…</div>;
  const d = c.data;
  const myCases = (allCases.data ?? []).filter((k) => k.clientId === d.id);

  const info: [string, string][] = [
    ["組織型態", d.orgType],
    ["統編／立案", d.taxId || "—"],
    ["成立", d.foundedYear ? `${d.foundedYear} 年` : "—"],
    ["所在地", d.city || "—"],
    ["人力", d.employeesFull != null ? `專職 ${d.employeesFull}／兼職 ${d.employeesPart ?? 0}` : "—"],
    ["資本額／基金", fmtMoney(d.capital)],
    ["年均營業額", fmtMoney(d.revenueAvg)],
    ["窗口", [d.contactName, d.contactTitle].filter(Boolean).join(" ") || "—"],
    ["聯絡", [d.contactPhone, d.contactEmail].filter(Boolean).join("・") || "—"],
  ];

  return (
    <div>
      <PageHeader
        title={d.name}
        desc={d.notes ? `內部備忘：${d.notes}` : undefined}
        action={
          <div className="flex gap-2">
            <Button onClick={() => navigate(`/match?clientId=${d.id}`)}>
              <Target className="w-4 h-4 mr-1" /> 適配補助案
            </Button>
            <Button variant="outline" onClick={() => navigate(`/clients/${d.id}/edit`)}>
              <Pencil className="w-4 h-4 mr-1" /> 編輯
            </Button>
            <Button variant="outline" className="text-destructive" onClick={() => { if (confirm("確定刪除此客戶？")) remove.mutate({ id: d.id }); }}>
              <Trash2 className="w-4 h-4 mr-1" /> 刪除
            </Button>
          </div>
        }
      />

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-base">組織記憶</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-y-3 text-sm">
                {info.map(([k, v]) => (
                  <div key={k}><div className="text-xs text-muted-foreground">{k}</div><div className="mt-0.5">{v}</div></div>
                ))}
              </div>
              {d.strengths && (
                <div className="mt-4 pt-4 border-t border-border">
                  <div className="text-xs text-muted-foreground mb-1">優勢與特色</div>
                  <p className="text-sm leading-relaxed">{d.strengths}</p>
                </div>
              )}
              <div className="flex flex-wrap gap-1.5 mt-4">
                {(d.tags ?? []).map((t) => (
                  <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground">{t}</span>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">過往實績</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {(d.pastProjects ?? []).length === 0 && <div className="text-sm text-muted-foreground">尚未登錄實績。</div>}
              {(d.pastProjects ?? []).map((p, i) => (
                <div key={i} className="p-3 rounded-lg bg-secondary/50 text-sm">
                  <div className="font-medium">{p.name} <span className="text-xs text-muted-foreground font-normal">{p.year}・{p.budget}</span></div>
                  <div className="text-xs text-muted-foreground mt-0.5">{p.outcome}</div>
                </div>
              ))}
              {d.adminCapability && (
                <div className="text-xs text-muted-foreground pt-2">行政能量：{d.adminCapability}</div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader><CardTitle className="text-base">案件歷史（{myCases.length}）</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {myCases.length === 0 && <EmptyBox text="尚無案件" />}
            {myCases.map((k) => (
              <Link key={k.id} to={`/cases/${k.id}`} className="block p-3 rounded-lg hover:bg-secondary transition-colors">
                <div className="text-sm font-medium truncate">{k.title}</div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xs text-muted-foreground">{CASE_STATUS_LABELS[k.status as CaseStatus] ?? k.status}</span>
                  <ScoreBadge score={k.currentScore} target={k.targetScore} />
                </div>
              </Link>
            ))}
            <Button variant="outline" className="w-full" onClick={() => navigate(`/match?clientId=${d.id}`)}>
              為這位客戶找新案 <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
