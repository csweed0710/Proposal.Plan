import { NavLink, Outlet } from "react-router";
import {
  LayoutDashboard,
  Landmark,
  Users,
  Target,
  FolderKanban,
  Sparkles,
} from "lucide-react";
import { trpc } from "@/providers/trpc";

const NAV = [
  { to: "/", label: "總覽", icon: LayoutDashboard, end: true },
  { to: "/grants", label: "補助情報", icon: Landmark },
  { to: "/clients", label: "客戶資料庫", icon: Users },
  { to: "/match", label: "適配分析", icon: Target },
  { to: "/cases", label: "案件工作台", icon: FolderKanban },
];

export default function Layout() {
  const status = trpc.meta.status.useQuery(undefined, { staleTime: 30000 });
  const llm = status.data?.llm;

  return (
    <div className="min-h-screen flex">
      {/* 側邊欄 */}
      <aside className="w-60 shrink-0 bg-[hsl(var(--sidebar-background))] border-r border-[hsl(var(--sidebar-border))] flex flex-col fixed inset-y-0">
        <div className="px-5 py-6 border-b border-[hsl(var(--sidebar-border))]">
          <div className="text-lg font-bold text-primary leading-tight">計畫書接案系統</div>
          <div className="text-xs text-muted-foreground mt-1">補助案 × 客戶 × 審核迴圈</div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end as boolean | undefined}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  isActive
                    ? "bg-[hsl(var(--sidebar-accent))] text-primary font-semibold"
                    : "text-[hsl(var(--sidebar-foreground))] hover:bg-[hsl(var(--sidebar-accent))]/60"
                }`
              }
            >
              <n.icon className="w-4 h-4" />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-4 border-t border-[hsl(var(--sidebar-border))]">
          <div
            className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${
              llm?.configured ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
            }`}
            title={
              llm?.configured
                ? `AI 模式：${llm.model}`
                : "未設定 LLM_API_KEY，目前以規則引擎運作；設定後自動升級 AI 寫作與重寫"
            }
          >
            <Sparkles className="w-3.5 h-3.5" />
            {llm?.configured ? `AI 模式（${llm.model}）` : "規則引擎模式"}
          </div>
        </div>
      </aside>

      {/* 主內容 */}
      <main className="flex-1 ml-60 min-w-0">
        <div className="max-w-6xl mx-auto px-8 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
