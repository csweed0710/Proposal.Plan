import { useState } from "react";
import { Link } from "react-router";
import { Radar as RadarIcon, Inbox, RefreshCw, Check, X, ExternalLink, ScanSearch, Info } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { PageHeader } from "@/components/bits";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const DAY = 86400000;
const SOURCE_LABEL: Record<string, string> = { paste: "收件匣", moc: "文化部網站" };

function daysLeft(applyEnd: string | null) {
  if (!applyEnd) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const end = new Date(applyEnd); end.setHours(0, 0, 0, 0);
  return Math.round((end.getTime() - today.getTime()) / DAY);
}

export default function Radar() {
  const utils = trpc.useUtils();
  const list = trpc.radar.list.useQuery();
  const [text, setText] = useState("");
  const [pasteMsg, setPasteMsg] = useState("");
  const [scanResults, setScanResults] = useState<Array<{ source: string; label: string; found: number; added: number; error?: string }> | null>(null);
  const [filter, setFilter] = useState<"new" | "accepted" | "all">("new");

  const paste = trpc.radar.paste.useMutation({
    onSuccess: (r) => {
      setText("");
      setPasteMsg(
        `解析出 ${r.parsed} 件，新增 ${r.added} 件` +
        (r.skippedDup ? `，重複略過 ${r.skippedDup}` : "") +
        (r.skippedExpired ? `，已截止略過 ${r.skippedExpired}` : "") +
        (r.usedAI ? "" : "（規則模式——啟用 AI 後解析更準）"),
      );
      utils.radar.list.invalidate();
    },
    onError: (e) => setPasteMsg(`失敗：${e.message}`),
  });
  const scan = trpc.radar.scan.useMutation({
    onSuccess: (r) => { setScanResults(r.results); utils.radar.list.invalidate(); },
  });
  const accept = trpc.radar.accept.useMutation({
    onSuccess: () => { utils.radar.list.invalidate(); utils.grants.list.invalidate(); },
  });
  const dismiss = trpc.radar.dismiss.useMutation({
    onSuccess: () => utils.radar.list.invalidate(),
  });

  const all = (list.data ?? []).filter((c) => c.status !== "dismissed");
  const items = all.filter((c) =>
    filter === "all" ? true : filter === "accepted" ? c.status === "accepted" : c.status === "new",
  );
  const newCount = all.filter((c) => c.status === "new").length;

  return (
    <div>
      <PageHeader title="補助雷達" desc="公告進來、AI 判讀、只留能投的——收錄後一鍵轉正式補助案" />

      <div className="grid lg:grid-cols-2 gap-5 mb-6">
        {/* 收件匣 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Inbox className="w-4 h-4 text-accent" /> 收件匣（貼上公告，AI 判讀）
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              rows={6}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="把補助公告的全文或列表貼在這裡——一次貼一整頁也行，AI 會把每件的名稱、機關、受理期限、金額拆出來。"
            />
            <div className="flex items-center gap-3">
              <Button disabled={text.trim().length < 10 || paste.isPending} onClick={() => paste.mutate({ text })}>
                {paste.isPending ? "解析中…" : "解析入庫"}
              </Button>
              {pasteMsg && <span className="text-xs text-muted-foreground">{pasteMsg}</span>}
            </div>
          </CardContent>
        </Card>

        {/* 自動掃描 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <ScanSearch className="w-4 h-4 text-accent" /> 自動掃描
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-xs text-muted-foreground flex gap-2 leading-relaxed">
              <Info className="w-4 h-4 shrink-0 text-accent" />
              系統每 6 小時自動掃描一次。注意：台灣政府網站常封鎖境外主機——若掃描失敗，不是你的網路問題，
              用左邊收件匣貼上公告，效果一樣。
            </div>
            <div className="flex items-center gap-3">
              <Button variant="outline" disabled={scan.isPending} onClick={() => scan.mutate()}>
                <RefreshCw className={`w-4 h-4 mr-1 ${scan.isPending ? "animate-spin" : ""}`} />
                {scan.isPending ? "掃描中…" : "立即掃描"}
              </Button>
            </div>
            {scanResults && (
              <div className="space-y-1.5">
                {scanResults.map((r) => (
                  <div key={r.source} className="text-xs rounded-md border p-2">
                    <span className="font-medium">{r.label}</span>：
                    {r.error ? (
                      <span className="text-amber-700">{r.error}</span>
                    ) : (
                      <span>找到 {r.found} 則公告，新增 {r.added} 件候選</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 候選區 */}
      <div className="flex items-center gap-2 mb-4">
        <RadarIcon className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-medium">候選案件</span>
        {[
          { k: "new" as const, label: `未處理 ${newCount}` },
          { k: "accepted" as const, label: "已收錄" },
          { k: "all" as const, label: "全部" },
        ].map((f) => (
          <button
            key={f.k}
            onClick={() => setFilter(f.k)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${filter === f.k ? "bg-primary text-primary-foreground border-primary" : "hover:bg-secondary"}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="space-y-3 pb-8">
        {items.length === 0 && (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              候選區是空的。貼一段公告進收件匣，或按「立即掃描」試試。
            </CardContent>
          </Card>
        )}
        {items.map((c) => {
          const days = daysLeft(c.applyEnd);
          const expired = days != null && days < 0;
          return (
            <Card key={c.id} className={c.status === "accepted" ? "opacity-70" : ""}>
              <CardContent className="py-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{c.title}</span>
                    <Badge variant="outline" className="text-xs">{SOURCE_LABEL[c.source] ?? c.source}</Badge>
                    {c.status === "accepted" && <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 text-xs">已收錄</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3">
                    <span>{c.agency || "機關待查證"}</span>
                    {c.applyStart && <span>開始 {c.applyStart}</span>}
                    {c.applyEnd ? <span>截止 {c.applyEnd}</span> : <span>時程待查證</span>}
                    {c.amountNote && <span>{c.amountNote}</span>}
                    {c.url && (
                      <a href={c.url} target="_blank" rel="noreferrer" className="text-accent flex items-center gap-0.5 hover:underline">
                        原文 <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {expired ? (
                    <span className="text-xs px-2 py-1 rounded-md bg-gray-100 text-gray-500">已截止</span>
                  ) : days != null ? (
                    <span className={`text-xs px-2 py-1 rounded-md tabular-nums ${days <= 14 ? "bg-red-100 text-red-700" : days <= 45 ? "bg-amber-100 text-amber-700" : "bg-secondary text-muted-foreground"}`}>
                      剩 {days} 天
                    </span>
                  ) : (
                    <span className="text-xs px-2 py-1 rounded-md bg-secondary text-muted-foreground">常年/待查</span>
                  )}
                  {c.status === "new" && (
                    <>
                      <Button size="sm" variant="outline" disabled={accept.isPending} onClick={() => accept.mutate({ id: c.id })}>
                            <Check className="w-3.5 h-3.5 mr-1" /> 收錄
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => dismiss.mutate({ id: c.id })}>
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </>
                  )}
                  {c.status === "accepted" && (
                    <Link to="/grants" className="text-xs text-accent hover:underline">到補助情報補齊 →</Link>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
