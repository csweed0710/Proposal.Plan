import { useNavigate, useParams } from "react-router";
import { Pencil, Trash2, ExternalLink } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { PageHeader, fmtMoney, deadlineText } from "@/components/bits";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function GrantDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const g = trpc.grants.get.useQuery({ id: Number(id) });
  const remove = trpc.grants.remove.useMutation({
    onSuccess: () => { utils.grants.list.invalidate(); navigate("/grants"); },
  });

  if (!g.data) return <div className="text-muted-foreground">載入中…</div>;
  const d = g.data;

  return (
    <div>
      <PageHeader
        title={d.name}
        desc={d.agency}
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate(`/grants/${d.id}/edit`)}>
              <Pencil className="w-4 h-4 mr-1" /> 編輯
            </Button>
            <Button variant="outline" className="text-destructive" onClick={() => { if (confirm("確定刪除此補助案？")) remove.mutate({ id: d.id }); }}>
              <Trash2 className="w-4 h-4 mr-1" /> 刪除
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2 mb-6">
        <Badge variant="secondary">{d.category}</Badge>
        {d.rolling && <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">常年受理</Badge>}
        {d.needsVerification && <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">時程待查證</Badge>}
        {d.hasTemplate && <Badge className="bg-sky-100 text-sky-700 hover:bg-sky-100">已上傳官方範本</Badge>}
        <Badge variant="outline">{deadlineText(d.rolling, d.applyEnd, d.deadlineNote)}</Badge>
        <Badge variant="outline">上限 {fmtMoney(d.amountMax)}</Badge>
        {d.sourceUrl && (
          <a href={d.sourceUrl} target="_blank" rel="noreferrer">
            <Badge variant="outline" className="gap-1 cursor-pointer">官方來源 <ExternalLink className="w-3 h-3" /></Badge>
          </a>
        )}
      </div>

      {d.description && <p className="text-sm text-muted-foreground mb-6 leading-relaxed">{d.description}</p>}

      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">申請資格與規定</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-3">
            <div><span className="text-muted-foreground">適用組織：</span>{(d.orgTypes ?? []).join("、") || "—"}</div>
            <div><span className="text-muted-foreground">資格條件：</span>{d.eligibilityNote || "—"}</div>
            <div><span className="text-muted-foreground">自籌款：</span>{d.selfFundNote || "—"}</div>
            <div><span className="text-muted-foreground">應備文件：</span>{d.attachmentsNote || "—"}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">官方評分標準</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow><TableHead>項目</TableHead><TableHead className="w-16">配分</TableHead><TableHead>說明</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {(d.rubric ?? []).map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{r.item}</TableCell>
                    <TableCell className="text-accent font-bold">{r.points}</TableCell>
                    <TableCell className="text-muted-foreground">{r.description}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader><CardTitle className="text-base">官方章節格式（{(d.chapterSchema ?? []).length} 章）</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(d.chapterSchema ?? []).map((c, i) => (
            <div key={c.key} className="flex items-start gap-3 p-3 rounded-lg bg-secondary/50">
              <span className="text-xs text-muted-foreground pt-0.5 w-5 shrink-0">{i + 1}.</span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{c.title}</span>
                  {c.required && <Badge variant="outline" className="text-xs">必要</Badge>}
                  {c.weight != null && <span className="text-xs text-muted-foreground">權重 {c.weight}</span>}
                </div>
                {c.guidance && <div className="text-xs text-muted-foreground mt-0.5">{c.guidance}</div>}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
