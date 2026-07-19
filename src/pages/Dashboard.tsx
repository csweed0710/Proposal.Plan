import { Link } from "react-router";
import { ArrowRight, Landmark, Users, FolderKanban, Target } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { PageHeader, StatCard, ScoreBadge, deadlineText } from "@/components/bits";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CASE_STATUS_LABELS, type CaseStatus } from "@contracts/types";

export default function Dashboard() {
  const status = trpc.meta.status.useQuery();
  const caseList = trpc.cases.list.useQuery();
  const grants = trpc.grants.list.useQuery({ windowDays: 90, q: "", category: "" });

  const s = status.data;
  const recent = (caseList.data ?? []).slice(0, 5);
  const upcoming = (grants.data ?? [])
    .filter((g) => !g.rolling && g.applyEnd)
    .sort((a, b) => new Date(a.applyEnd!).getTime() - new Date(b.applyEnd!).getTime())
    .slice(0, 5);

  return (
    <div>
      <PageHeader title="總覽" desc="補助情報、客戶、案件與審核進度一目了然" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="補助案庫" value={s?.grantCount ?? "…"} sub={`${s?.rollingCount ?? 0} 件常年受理`} />
        <StatCard label="30 天內截止" value={s?.closingIn30 ?? "…"} sub="需要立刻動的案件" />
        <StatCard label="客戶" value={s?.clientCount ?? "…"} sub="資料永久記住" />
        <StatCard label="進行中案件" value={s?.activeCases ?? "…"} sub={`${s?.doneCases ?? 0} 件已達標完成`} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">近期案件</CardTitle>
            <Link to="/cases" className="text-xs text-accent flex items-center gap-1 hover:underline">
              全部 <ArrowRight className="w-3 h-3" />
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {recent.length === 0 && <div className="text-sm text-muted-foreground">尚無案件，到「適配分析」建立第一案。</div>}
            {recent.map((k) => (
              <Link key={k.id} to={`/cases/${k.id}`} className="flex items-center justify-between gap-3 p-3 rounded-lg hover:bg-secondary transition-colors">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{k.title}</div>
                  <div className="text-xs text-muted-foreground">{k.clientName}・{CASE_STATUS_LABELS[k.status as CaseStatus] ?? k.status}</div>
                </div>
                <ScoreBadge score={k.currentScore} target={k.targetScore} />
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">即將截止的補助案</CardTitle>
            <Link to="/grants" className="text-xs text-accent flex items-center gap-1 hover:underline">
              全部 <ArrowRight className="w-3 h-3" />
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {upcoming.length === 0 && <div className="text-sm text-muted-foreground">90 天內沒有梯次制補助案截止；常年受理案件隨時可送。</div>}
            {upcoming.map((g) => (
              <Link key={g.id} to={`/grants/${g.id}`} className="flex items-center justify-between gap-3 p-3 rounded-lg hover:bg-secondary transition-colors">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{g.name}</div>
                  <div className="text-xs text-muted-foreground">{g.agency}</div>
                </div>
                <span className="text-xs text-accent whitespace-nowrap">{deadlineText(g.rolling, g.applyEnd, g.deadlineNote)}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-8">
        {[
          { to: "/grants", icon: Landmark, title: "補助情報", desc: "搜尋未來 3 個月可申請的計畫、維護章節格式與評分標準" },
          { to: "/clients", icon: Users, title: "客戶資料庫", desc: "客戶所有資訊永久記住，下一案自動帶入" },
          { to: "/match", icon: Target, title: "適配分析", desc: "選一個客戶，列出最適合申請的補助案" },
          { to: "/cases", icon: FolderKanban, title: "案件工作台", desc: "動態問卷 → 寫作 → 審核修改迴圈" },
        ].map((c) => (
          <Link key={c.to} to={c.to} className="group">
            <Card className="h-full transition-shadow hover:shadow-md">
              <CardContent className="pt-5">
                <c.icon className="w-5 h-5 text-accent mb-2" />
                <div className="font-semibold text-sm group-hover:text-primary">{c.title}</div>
                <div className="text-xs text-muted-foreground mt-1 leading-relaxed">{c.desc}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
