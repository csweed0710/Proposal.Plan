import { useState } from "react";
import { NavLink, Outlet } from "react-router";
import {
  LayoutDashboard,
  Landmark,
  Radar,
  Users,
  Target,
  FolderKanban,
  BookOpen,
  Sparkles,
} from "lucide-react";
import { trpc } from "@/providers/trpc";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

const NAV = [
  { to: "/", label: "總覽", icon: LayoutDashboard, end: true },
  { to: "/grants", label: "補助情報", icon: Landmark },
  { to: "/radar", label: "補助雷達", icon: Radar },
  { to: "/clients", label: "客戶資料庫", icon: Users },
  { to: "/match", label: "適配分析", icon: Target },
  { to: "/cases", label: "案件工作台", icon: FolderKanban },
  { to: "/references", label: "參考資料庫", icon: BookOpen },
];

export default function Layout() {
  const status = trpc.meta.status.useQuery(undefined, { staleTime: 30000 });
  const llm = status.data?.llm;
  const [aiOpen, setAiOpen] = useState(false);

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
          <button
            onClick={() => setAiOpen(true)}
            className={`w-full flex items-center gap-2 text-xs px-3 py-2 rounded-lg transition-opacity hover:opacity-80 ${
              llm?.configured
                ? llm.lastError
                  ? "bg-red-50 text-red-700"
                  : "bg-emerald-50 text-emerald-700"
                : "bg-amber-50 text-amber-700"
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            {llm?.configured
              ? llm.lastError
                ? "AI 異常・點我檢查"
                : `AI 模式（${llm.model}）`
              : "規則引擎模式・點我啟用 AI"}
          </button>
        </div>
      </aside>

      {/* 主內容 */}
      <main className="flex-1 ml-60 min-w-0">
        <div className="max-w-6xl mx-auto px-8 py-8">
          <Outlet />
        </div>
      </main>

      {/* AI 狀態與啟用教學 */}
      <Dialog open={aiOpen} onOpenChange={setAiOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {llm?.configured
                ? llm.lastError
                  ? "AI 設定有問題"
                  : `AI 已啟用（${llm.model}）`
                : "啟用 AI 寫作大腦"}
            </DialogTitle>
            <DialogDescription>
              {llm?.configured
                ? llm.lastError
                  ? "已填金鑰但呼叫失敗——請對照下方錯誤訊息修正。"
                  : "起草、修改、評審總評、公告解析都在用 AI 運作。"
                : "目前是規則引擎模式：功能都能用，但草稿是素材骨架、公告解析較粗略。接上 AI 後全面升級。"}
            </DialogDescription>
          </DialogHeader>

          {llm?.configured && llm.lastError && (
            <div className="rounded-md bg-destructive/10 border border-destructive/30 p-3 text-xs text-destructive font-mono break-all">
              {llm.lastError}
              <div className="mt-2 font-sans text-muted-foreground">
                常見原因：金鑰打錯或過期、模型名稱打錯、帳戶額度用完、BASE_URL 與金鑰不是同一家。
              </div>
            </div>
          )}

          {!llm?.configured && (
            <div className="space-y-4 text-sm leading-relaxed">
              <p>ChatGPT 或 Claude 都能接——系統用 OpenAI 相容介面，只換三個變數，不用改系統。兩家擇一：</p>

              <div className="rounded-lg border p-3 space-y-2">
                <div className="font-semibold">方案 A：ChatGPT（OpenAI）——最便宜好上手</div>
                <ol className="list-decimal list-inside space-y-1 text-xs text-muted-foreground">
                  <li>到 platform.openai.com 辦帳號、建 API Key（需先儲值，約 5 美元起）</li>
                  <li>Railway → 你的服務 → Variables 新增：</li>
                </ol>
                <div className="space-y-1 font-mono text-xs bg-secondary rounded-md p-2.5">
                  <div>LLM_API_KEY = sk-proj-…（你的金鑰）</div>
                  <div>LLM_BASE_URL = https://api.openai.com/v1</div>
                  <div>LLM_MODEL = gpt-4o-mini</div>
                </div>
              </div>

              <div className="rounded-lg border p-3 space-y-2">
                <div className="font-semibold">方案 B：Claude（Anthropic）——繁中公文筆更穩</div>
                <ol className="list-decimal list-inside space-y-1 text-xs text-muted-foreground">
                  <li>到 console.anthropic.com 辦帳號、建 API Key（需先儲值）</li>
                  <li>Railway → Variables 新增：</li>
                </ol>
                <div className="space-y-1 font-mono text-xs bg-secondary rounded-md p-2.5">
                  <div>LLM_API_KEY = sk-ant-…（你的金鑰）</div>
                  <div>LLM_BASE_URL = https://api.anthropic.com/v1</div>
                  <div>LLM_MODEL = claude-sonnet-4-5</div>
                </div>
                <p className="text-xs text-muted-foreground">型號以 Anthropic 後台公布的最新 Sonnet 為準；想省錢可換 Haiku。</p>
              </div>

              <ol className="list-decimal list-inside space-y-1.5">
                <li>變數存好後，按紫色 <b>Deploy</b> 套用，等重新部署完成。</li>
                <li>左下這個燈號變綠、顯示「AI 模式」就是啟用了；有問題會直接顯示錯誤原因。</li>
              </ol>
              <p className="text-xs text-muted-foreground">
                費用概念：寫一章約新台幣幾毛到一兩元，一個月寫幾十案通常不到一杯咖啡的價格。
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
