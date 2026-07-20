import { Link, useNavigate } from "react-router";
import { Target, Trash2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { PageHeader, EmptyBox, ScoreBadge } from "@/components/bits";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CASE_STATUS_LABELS, type CaseStatus } from "@contracts/types";

export default function Cases() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const list = trpc.cases.list.useQuery();
  const remove = trpc.cases.remove.useMutation({
    onSuccess: () => utils.cases.list.invalidate(),
  });

  const onDelete = (id: number, title: string) => {
    if (!window.confirm(`確定刪除「${title}」？\n問卷、章節內容、審稿紀錄會一起刪除，無法復原。`)) return;
    remove.mutate({ id });
  };

  return (
    <div>
      <PageHeader
        title="案件工作台"
        desc="每一案：動態問卷收料 → 依官方章節寫作 → 審核給改進方向 → 修改再審，直到達標"
        action={<Button onClick={() => navigate("/match")}><Target className="w-4 h-4 mr-1" /> 從適配分析開新案</Button>}
      />

      {remove.isError && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-sm px-3 py-2">
          {remove.error.message}
        </div>
      )}

      {(list.data ?? []).length === 0 && !list.isLoading && (
        <EmptyBox text="還沒有案件" action={<Button variant="outline" onClick={() => navigate("/match")}>去適配分析</Button>} />
      )}

      <div className="space-y-3">
        {(list.data ?? []).map((k) => (
          <div key={k.id} className="relative group">
            <Link to={`/cases/${k.id}`}>
              <Card className="hover:shadow-md transition-shadow">
                <CardContent className="py-4 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{k.title}</div>
                    <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                      <span>{k.clientName}</span>
                      <span>→</span>
                      <span className="truncate">{k.grantName}</span>
                      <Badge variant="secondary">{CASE_STATUS_LABELS[k.status as CaseStatus] ?? k.status}</Badge>
                      <span className="text-muted-foreground">目標 {k.targetScore} 分・第 {k.reviewRound} 輪審核</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <ScoreBadge score={k.currentScore} target={k.targetScore} />
                    <Button
                      variant="ghost" size="icon"
                      className="text-muted-foreground hover:text-destructive"
                      title="刪除案件"
                      disabled={remove.isPending}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(k.id, k.title); }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
