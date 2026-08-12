import { Link } from "react-router";
import { ArrowRight, Landmark, Users, FolderKanban, Target, Clock, Trophy, AlertTriangle, CheckCircle2, Circle } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { PageHeader, StatCard, ScoreBadge, deadlineText } from "@/components/bits";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CASE_STATUSES, CASE_STATUS_LABELS, type CaseStatus } from "@contracts/types";

const DAY = 86400000;
// 進行中的狀態（含舊版相容）
const ACTIVE_KEYS = ["intake", "draft", "reviewing", "writing", "review"];

function daysLeft(applyEnd: string | Date) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(applyEnd);
  end.setHours(0, 0, 0, 0);
  return Math.round((end.getTime() - today.getTime()) / DAY);
}

export default function Dashboard() {
  const status = trpc.meta.status.useQuery();
  const caseList = trpc.cases.list.useQuery();
  // windowDays 拉長到 10 年，確保案件的補助案不會被 90 天窗口濾掉
  const grants = trpc.grants.list.useQuery({ windowDays: 3650, q: "", category: "" });

  const s = status.data;
  const all = caseList.data ?? [];
  const grantById = new Map((grants.data ?? []).map((g) => [g.id, g]));

  const countOf = (...keys: string[]) => all.filter((k) => keys.includes(k.status)).length;
  const active = all.filter((k) => ACTIVE_KEYS.includes(k.status));
  const readyToSubmit = all.filter((k) => k.status === "done");
  const won = all.filter((k) => k.status === "won");
  const wonTotal = won.reduce((sum, k) => sum + (k.resultAmount ?? 0), 0);

  // 案件截止倒數：進行中＋已完成待送件，對照補助案截止日
  const caseDeadlines = [...active, ...readyToSubmit]
    .map((k) => {
      const g = grantById.get(k.grantId);
      if (!g || g.rolling || !g.applyEnd) return null;
      return { k, g, days: daysLeft(g.applyEnd) };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.days - b.days);
  const closing30 = caseDeadlines.filter((x) => x.days >= 0 && x.days <= 30).length;

  const recent = all.slice(0, 5);
  const now = Date.now();
  const upcoming = (grants.data ?? [])
    .filter((g) => !g.rolling && g.applyEnd && new Date(g.applyEnd).getTime() >= now)
    .sort((a, b) => new Date(a.applyEnd!).getTime() - new Date(b.applyEnd!).getTime())
    .slice(0, 5);

  const PIPE_CLS: Record<string, string> = {
    won: "text-emerald-600",
    lost: "text-red-500",
    submitted: "text-blue-600",
    done: "text-emerald-600",
  };

  const setupSteps = [
    { label: "建立第一位客戶", to: "/clients/new", done: (s?.clientCount ?? 0) > 0 },
    { label: "新增或匯入補助案", to: "/grants", done: (s?.grantCount ?? 0) > 0 },
    { label: "執行適配分析", to: "/match", done: all.length > 0 },
    { label: "建立第一個案件", to: "/cases", done: all.length > 0 },
  ];
  const showSetup = Boolean(s && caseList.data && setupSteps.some((step) => !step.done));

  return (
    <div>
      <PageHeader title="總覽" desc="今天該做什麼、哪案快截止、賺了多少——一眼看清" />

      {showSetup && (
        <Card className="mb-6 border-accent/30 bg-accent/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">開始使用</CardTitle>
            <p className="text-sm text-muted-foreground">依序完成這四步，就能從客戶資料一路走到正式提案案件。</p>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {setupSteps.map((step, index) => (
              <Button key={step.label} variant="outline" asChild className="h-auto min-h-11 justify-start py-3 whitespace-normal bg-background">
                <Link to={step.to} aria-label={`${step.done ? "已完成" : "尚未完成"}：${step.label}`}>
                  {step.done
                    ? <CheckCircle2 className="size-4 text-emerald-600" aria-hidden="true" />
                    : <Circle className="size-4 text-muted-foreground" aria-hidden="true" />}
                  <span>{index + 1}. {step.label}</span>
                </Link>
              </Button>
            ))}
          </CardContent>
        </Card>
      )}

      {/* 四張關鍵數字卡 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Link to="/cases" aria-label="查看進行中案件" className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <StatCard label="進行中案件" value={caseList.data ? active.length : "載入中"} sub={`撰稿中 ${countOf("draft", "writing")}・審核中 ${countOf("reviewing", "review")}`} />
        </Link>
        <Link to="/cases" aria-label="查看達標待送件案件" className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <StatCard label="達標待送件" value={caseList.data ? readyToSubmit.length : "載入中"} sub="完成了就趕快送！" />
        </Link>
        <Link to="/cases" aria-label="查看得標案件" className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <StatCard label="得標案件" value={caseList.data ? won.length : "載入中"} sub={wonTotal > 0 ? `累計核定 NT$ ${wonTotal.toLocaleString()}` : "第一件得標就在眼前"} />
        </Link>
        <Link to="/cases" aria-label="查看三十天內截止案件" className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <StatCard label="30 天內案件截止" value={caseList.data && grants.data ? closing30 : "載入中"} sub="需要立刻動的案件" />
        </Link>
      </div>

      {/* 案件 pipeline 條 */}
      <Card className="mb-6">
        <CardContent className="py-4 overflow-x-auto">
          <div className="flex min-w-max items-center gap-y-2">
            {CASE_STATUSES.map((st, i) => (
              <div key={st.key} className="flex items-center">
                {i > 0 && <span className="mx-2 text-muted-foreground/40 text-xs">→</span>}
                <Link to="/cases" className="flex items-baseline gap-1.5 px-2 py-1 rounded-md hover:bg-secondary transition-colors">
                  <span className={`text-lg font-bold tabular-nums ${PIPE_CLS[st.key] ?? ""}`}>
                    {countOf(st.key)}
                  </span>
                  <span className="text-xs text-muted-foreground">{st.label}</span>
                </Link>
              </div>
            ))}
            <div className="ml-auto text-xs text-muted-foreground hidden md:block">
              補助案庫 {s?.grantCount ?? "…"} 件・客戶 {s?.clientCount ?? "…"} 家
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        {/* 案件截止倒數 */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4 text-accent" /> 案件截止倒數
            </CardTitle>
            <Link to="/cases" className="text-xs text-accent flex items-center gap-1 hover:underline">
              查看全部案件 <ArrowRight className="w-3 h-3" />
            </Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {caseDeadlines.length === 0 && (
              <div className="text-sm text-muted-foreground">
                目前沒有有截止日的進行中案件。常年受理的補助案不列入倒數。
              </div>
            )}
            {caseDeadlines.slice(0, 6).map(({ k, g, days }) => (
              <Link
                key={k.id}
                to={`/cases/${k.id}`}
                className="flex items-center justify-between gap-3 p-3 rounded-lg hover:bg-secondary transition-colors"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{k.title}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {k.clientName}・{CASE_STATUS_LABELS[k.status as CaseStatus] ?? k.status}・截止 {new Date(g.applyEnd!).toLocaleDateString("zh-TW")}
                  </div>
                </div>
                {days < 0 ? (
                  <span className="shrink-0 text-xs font-medium px-2 py-1 rounded-md bg-gray-100 text-gray-500 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> 已截止
                  </span>
                ) : (
                  <span
                    className={`shrink-0 text-xs font-medium px-2 py-1 rounded-md tabular-nums ${
                      days <= 7
                        ? "bg-red-100 text-red-700"
                        : days <= 30
                          ? "bg-amber-100 text-amber-700"
                          : "bg-secondary text-muted-foreground"
                    }`}
                  >
                    剩 {days} 天
                  </span>
                )}
              </Link>
            ))}
          </CardContent>
        </Card>

        {/* 近期案件 */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">近期案件</CardTitle>
            <Link to="/cases" className="text-xs text-accent flex items-center gap-1 hover:underline">
              查看全部案件 <ArrowRight className="w-3 h-3" />
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {recent.length === 0 && (
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>尚無案件，先為客戶找出最適合的補助案。</p>
                <Button size="sm" variant="outline" asChild><Link to="/match">立即執行適配分析</Link></Button>
              </div>
            )}
            {recent.map((k) => (
              <Link key={k.id} to={`/cases/${k.id}`} className="flex items-center justify-between gap-3 p-3 rounded-lg hover:bg-secondary transition-colors">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{k.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {k.clientName}・{CASE_STATUS_LABELS[k.status as CaseStatus] ?? k.status}
                    {k.status === "won" && k.resultAmount != null && (
                      <span className="text-emerald-600 font-medium">・核定 NT$ {k.resultAmount.toLocaleString()}</span>
                    )}
                  </div>
                </div>
                {k.status === "won" ? (
                  <Trophy className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : (
                  <ScoreBadge score={k.currentScore} target={k.targetScore} />
                )}
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* 即將截止的補助案 */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">即將截止的補助案</CardTitle>
            <Link to="/grants" className="text-xs text-accent flex items-center gap-1 hover:underline">
              查看全部補助案 <ArrowRight className="w-3 h-3" />
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {upcoming.length === 0 && <div className="text-sm text-muted-foreground">未來沒有梯次制補助案截止；常年受理案件隨時可送。</div>}
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

        {/* 快速入口 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            { to: "/grants", icon: Landmark, title: "補助情報", desc: "維護章節格式與評分標準" },
            { to: "/clients", icon: Users, title: "客戶資料庫", desc: "下一案自動帶入" },
            { to: "/match", icon: Target, title: "適配分析", desc: "列出最適合的補助案" },
            { to: "/cases", icon: FolderKanban, title: "案件工作台", desc: "問卷→寫作→審核迴圈" },
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
    </div>
  );
}
