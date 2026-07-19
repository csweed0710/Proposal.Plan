import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { CheckCircle2, AlertTriangle, Plus } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { PageHeader, EmptyBox, fmtMoney, deadlineText } from "@/components/bits";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { MatchResult } from "@contracts/types";

const LEVEL_COLOR: Record<MatchResult["level"], string> = {
  強力推薦: "bg-emerald-100 text-emerald-700",
  適合: "bg-blue-100 text-blue-700",
  可考慮: "bg-amber-100 text-amber-700",
  不建議: "bg-gray-100 text-gray-500",
};

export default function Match() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const clients = trpc.clients.list.useQuery();
  const [clientId, setClientId] = useState(params.get("clientId") ?? "");
  const [windowDays, setWindowDays] = useState("90");
  const [creating, setCreating] = useState<MatchResult | null>(null);
  const [title, setTitle] = useState("");
  const [targetScore, setTargetScore] = useState("85");

  const match = trpc.clients.match.useQuery(
    { clientId: Number(clientId), windowDays: Number(windowDays) },
    { enabled: Boolean(clientId) },
  );
  const createCase = trpc.cases.create.useMutation({
    onSuccess: (d) => navigate(`/cases/${d.id}`),
  });

  return (
    <div>
      <PageHeader title="適配分析" desc="選一位客戶，系統用資格、時程、領域、規模四個維度，告訴你最該接哪一案" />

      <div className="flex flex-wrap gap-3 mb-6">
        <Select value={clientId} onValueChange={setClientId}>
          <SelectTrigger className="w-72"><SelectValue placeholder="選擇客戶…" /></SelectTrigger>
          <SelectContent>
            {(clients.data ?? []).map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={windowDays} onValueChange={setWindowDays}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="30">未來 30 天</SelectItem>
            <SelectItem value="90">未來 3 個月</SelectItem>
            <SelectItem value="180">未來 6 個月</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {!clientId && <EmptyBox text="先選一位客戶" />}
      {clientId && match.isLoading && <div className="text-muted-foreground text-sm">分析中…</div>}

      <div className="space-y-3">
        {(match.data ?? []).map((m) => (
          <Card key={m.grantId} className="hover:shadow-md transition-shadow">
            <CardContent className="py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{m.grantName}</span>
                    <Badge className={LEVEL_COLOR[m.level]}>{m.level}</Badge>
                    <Badge variant="secondary">{m.category}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {m.agency}・上限 {fmtMoney(m.amountMax)}・{deadlineText(m.rolling, m.applyEnd, null)}
                  </div>
                  <div className="mt-3 space-y-1">
                    {m.reasons.map((r, i) => (
                      <div key={i} className="flex items-start gap-1.5 text-xs text-emerald-700">
                        <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {r}
                      </div>
                    ))}
                    {m.warnings.map((w, i) => (
                      <div key={i} className="flex items-start gap-1.5 text-xs text-amber-700">
                        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {w}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="text-center shrink-0">
                  <div className="text-3xl font-bold text-primary">{m.score}</div>
                  <div className="text-xs text-muted-foreground mb-2">適配分</div>
                  <Button size="sm" onClick={() => { setCreating(m); setTitle(`${m.grantName}申請案`); }}>
                    <Plus className="w-4 h-4 mr-1" /> 建立案件
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={creating != null} onOpenChange={(o) => !o && setCreating(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>建立案件</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label>案件名稱</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <Label>目標分數（審核迴圈會改到達標為止）</Label>
              <Input type="number" min={50} max={100} value={targetScore} onChange={(e) => setTargetScore(e.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              建立後系統會：① 帶入「{creating?.grantName}」的官方章節格式與評分標準 ② 依章節自動生成專屬進場問卷 ③ 把客戶記憶預填進問卷。
            </p>
            <Button
              className="w-full"
              disabled={!title.trim() || createCase.isPending}
              onClick={() =>
                creating &&
                createCase.mutate({
                  clientId: Number(clientId),
                  grantId: creating.grantId,
                  title: title.trim(),
                  targetScore: Number(targetScore) || 85,
                })
              }
            >
              {createCase.isPending ? "建立中…" : "建立，進入案件工作台"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
