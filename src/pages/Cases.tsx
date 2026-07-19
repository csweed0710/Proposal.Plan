import { Link, useNavigate } from "react-router";
import { Target } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { PageHeader, EmptyBox, ScoreBadge } from "@/components/bits";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CASE_STATUS_LABELS, type CaseStatus } from "@contracts/types";

export default function Cases() {
  const navigate = useNavigate();
  const list = trpc.cases.list.useQuery();

  return (
    <div>
      <PageHeader
        title="案件工作台"
        desc="每一案：動態問卷收料 → 依官方章節寫作 → 審核給改進方向 → 修改再審，直到達標"
        action={<Button onClick={() => navigate("/match")}><Target className="w-4 h-4 mr-1" /> 從適配分析開新案</Button>}
      />

      {(list.data ?? []).length === 0 && !list.isLoading && (
        <EmptyBox text="還沒有案件" action={<Button variant="outline" onClick={() => navigate("/match")}>去適配分析</Button>} />
      )}

      <div className="space-y-3">
        {(list.data ?? []).map((k) => (
          <Link key={k.id} to={`/cases/${k.id}`}>
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
                <ScoreBadge score={k.currentScore} target={k.targetScore} />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
