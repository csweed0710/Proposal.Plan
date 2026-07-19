import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import {
  Sparkles, Save, Play, Wrench, Repeat2, CheckCircle2,
  AlertTriangle, Info, CircleCheck, CircleDashed, FileDown,
} from "lucide-react";
import { trpc } from "@/providers/trpc";
import { downloadDocx, PageHeader, ScoreBadge } from "@/components/bits";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import type { CaseChapter, IntakeQuestion, ReviewDimension, ReviewIssue } from "@contracts/types";

const SEV = {
  high: { label: "高", cls: "bg-red-100 text-red-700" },
  mid: { label: "中", cls: "bg-amber-100 text-amber-700" },
  low: { label: "低", cls: "bg-gray-100 text-gray-600" },
} as const;

function DimBar({ d }: { d: ReviewDimension }) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="font-medium">{d.label}</span>
        <span className="text-muted-foreground">{d.score} 分・佔 {Math.round(d.weight * 100)}%</span>
      </div>
      <div className="h-2 rounded-full bg-secondary overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${d.score >= 80 ? "bg-emerald-500" : d.score >= 60 ? "bg-amber-500" : "bg-red-400"}`}
          style={{ width: `${d.score}%` }}
        />
      </div>
      <div className="text-xs text-muted-foreground mt-1">{d.summary}</div>
    </div>
  );
}

export default function CaseDetail() {
  const { id } = useParams();
  const caseId = Number(id);
  const utils = trpc.useUtils();
  const k = trpc.cases.get.useQuery({ id: caseId });
  const reviewList = trpc.review.list.useQuery({ caseId });

  const [tab, setTab] = useState("intake");
  const [qa, setQa] = useState<IntakeQuestion[]>([]);
  const [chapters, setChapters] = useState<CaseChapter[]>([]);
  const [activeChapter, setActiveChapter] = useState("");
  const [target, setTarget] = useState("85");
  const [looping, setLooping] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportInfo, setExportInfo] = useState<{
    mode: "template" | "auto-map" | "generic";
    mapped: string[];
    unmapped: string[];
  } | null>(null);

  useEffect(() => {
    if (k.data) {
      setQa(k.data.intakeQA ?? []);
      setChapters(k.data.chapters ?? []);
      setTarget(String(k.data.targetScore));
      if (!activeChapter && (k.data.chapters ?? []).length > 0) {
        setActiveChapter(k.data.chapters[0].key);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k.data]);

  const saveIntake = trpc.cases.saveIntake.useMutation({
    onSuccess: () => utils.cases.get.invalidate(),
  });
  const saveChapters = trpc.cases.saveChapters.useMutation({
    onSuccess: () => utils.cases.get.invalidate(),
  });
  const draft = trpc.cases.draftChapter.useMutation({
    onSuccess: () => { utils.cases.get.invalidate(); },
  });
  const runReview = trpc.review.run.useMutation({
    onSuccess: () => { utils.cases.get.invalidate(); utils.review.list.invalidate(); utils.cases.list.invalidate(); },
  });
  const revise = trpc.review.reviseAndReview.useMutation();
  const setTargetScore = trpc.cases.setTargetScore.useMutation({
    onSuccess: () => utils.cases.get.invalidate(),
  });

  const latest = (reviewList.data ?? [])[0];
  const history = useMemo(() => [...(reviewList.data ?? [])].sort((a, b) => a.round - b.round), [reviewList.data]);

  const qaGroups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, IntakeQuestion[]>();
    for (const q of qa) {
      if (!map.has(q.chapterKey)) { map.set(q.chapterKey, []); order.push(q.chapterKey); }
      map.get(q.chapterKey)!.push(q);
    }
    return order.map((key) => ({ key, items: map.get(key)! }));
  }, [qa]);

  if (!k.data) return <div className="text-muted-foreground">載入中…</div>;

  const grant = k.data.grant;
  const client = k.data.client;
  const chapterTitle = (key: string) =>
    key === "__profile__" ? "組織基本資料（自動記住）" :
    key === "__rubric__" ? "評分重點追問" :
    (chapters.find((c) => c.key === key)?.title ?? key);

  const current = chapters.find((c) => c.key === activeChapter);
  const answeredCount = qa.filter((q) => q.answer.trim()).length;

  const loopUntilPass = async () => {
    setLooping(true);
    try {
      for (let i = 0; i < 4; i++) {
        const r = await revise.mutateAsync({ caseId });
        utils.cases.get.invalidate(); utils.review.list.invalidate(); utils.cases.list.invalidate();
        if (r.passed) break;
      }
    } finally {
      setLooping(false);
    }
  };

  // 匯出成真正的 .docx 檔案，直接下載——不需要複製貼上
  const doExport = async () => {
    setExporting(true);
    try {
      const r = await utils.cases.exportDocx.fetch({ id: caseId });
      downloadDocx(r.data, r.filename);
      setExportInfo({ mode: r.mode, mapped: r.mapped, unmapped: r.unmapped });
    } finally {
      setExporting(false);
    }
  };

  const MODE_LABEL = {
    template: "官方範本填寫（精準對位）",
    "auto-map": "章節標題自動對應",
    generic: "通用排版（此補助案尚未上傳範本）",
  } as const;

  return (
    <div>
      <PageHeader
        title={k.data.title}
        desc={`${client?.name ?? ""} → ${grant?.name ?? ""}`}
        action={
          <div className="flex items-center gap-3">
            <ScoreBadge score={k.data.currentScore} target={k.data.targetScore} />
            <Button onClick={doExport} disabled={exporting}>
              <FileDown className="w-4 h-4 mr-1" />
              {exporting ? "產生中…" : "匯出 Word"}
            </Button>
          </div>
        }
      />

      {/* 匯出結果說明 */}
      <Dialog open={!!exportInfo} onOpenChange={(o) => !o && setExportInfo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>已下載 Word 檔</DialogTitle>
            <DialogDescription>
              檔案已直接存到你的下載資料夾，不需要複製貼上。
            </DialogDescription>
          </DialogHeader>
          {exportInfo && (
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">匯出模式：</span>
                <Badge variant="secondary">{MODE_LABEL[exportInfo.mode]}</Badge>
              </div>
              {exportInfo.mapped.length > 0 && (
                <div>
                  <div className="text-xs font-medium mb-1 text-emerald-700">已填入 {exportInfo.mapped.length} 個章節</div>
                  <div className="text-xs text-muted-foreground">{exportInfo.mapped.join("、")}</div>
                </div>
              )}
              {exportInfo.unmapped.length > 0 && (
                <div className="rounded-md bg-amber-50 border border-amber-200 p-2.5">
                  <div className="text-xs font-medium mb-1 text-amber-700 flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> {exportInfo.unmapped.length} 個章節在範本中找不到對應位置
                  </div>
                  <div className="text-xs text-amber-700/80">
                    {exportInfo.unmapped.join("、")}——已附加在文件最後。若要精準對位，請在範本中貼上【章節:key】標記。
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-5">
          <TabsTrigger value="intake">① 進場問卷（{answeredCount}/{qa.length}）</TabsTrigger>
          <TabsTrigger value="writing">② 寫作台（{chapters.filter((c) => c.content.trim()).length}/{chapters.length} 章）</TabsTrigger>
          <TabsTrigger value="review">③ 審核室{latest ? `（第 ${latest.round} 輪）` : ""}</TabsTrigger>
        </TabsList>

        {/* ============ 問卷 ============ */}
        <TabsContent value="intake">
          <Card className="mb-4 border-accent/30 bg-accent/5">
            <CardContent className="py-3 text-xs text-muted-foreground flex gap-2">
              <Info className="w-4 h-4 shrink-0 text-accent" />
              這份問卷由「{grant?.name}」的官方章節格式與評分標準即時生成——換一個補助案，問題就不一樣。
              標示「已帶入」的題目是系統從客戶記憶自動填好的。
            </CardContent>
          </Card>

          {qaGroups.map((g) => (
            <Card key={g.key} className="mb-4">
              <CardHeader><CardTitle className="text-base">{chapterTitle(g.key)}</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {g.items.map((q) => (
                  <div key={q.id}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium">{q.question}</span>
                      {q.prefilled && <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 text-xs">已帶入</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground mb-1.5">{q.hint}</div>
                    <Textarea
                      rows={2}
                      value={q.answer}
                      onChange={(e) =>
                        setQa((arr) => arr.map((x) => (x.id === q.id ? { ...x, answer: e.target.value } : x)))
                      }
                    />
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}

          <div className="pb-8">
            <Button size="lg" disabled={saveIntake.isPending} onClick={() => saveIntake.mutate({ id: caseId, intakeQA: qa })}>
              <Save className="w-4 h-4 mr-1" /> 儲存問卷，進入寫作
            </Button>
          </div>
        </TabsContent>

        {/* ============ 寫作台 ============ */}
        <TabsContent value="writing">
          <div className="grid grid-cols-12 gap-5 pb-8">
            <div className="col-span-4 space-y-1.5">
              {chapters.map((c, i) => (
                <button
                  key={c.key}
                  onClick={() => setActiveChapter(c.key)}
                  className={`w-full text-left p-2.5 rounded-lg border text-sm transition-colors ${
                    activeChapter === c.key ? "border-accent bg-accent/5" : "border-border hover:bg-secondary"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {c.content.trim() ? (
                      <CircleCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    ) : (
                      <CircleDashed className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    )}
                    <span className="font-medium truncate">{i + 1}. {c.title}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 pl-5.5 flex gap-2">
                    {c.required && <span>必要</span>}
                    <span>{c.content.trim() ? `${c.content.trim().length} 字` : "未開始"}</span>
                  </div>
                </button>
              ))}
            </div>

            <div className="col-span-8">
              {current ? (
                <Card>
                  <CardHeader className="flex-row items-center justify-between space-y-0">
                    <div>
                      <CardTitle className="text-base">{current.title}</CardTitle>
                      {current.guidance && <div className="text-xs text-muted-foreground mt-1">寫作重點：{current.guidance}</div>}
                    </div>
                    <Button
                      variant="outline" size="sm"
                      disabled={draft.isPending}
                      onClick={() => draft.mutate({ id: caseId, chapterKey: current.key })}
                    >
                      <Sparkles className="w-4 h-4 mr-1" />
                      {draft.isPending ? "生成中…" : current.content.trim() ? "重新生成草稿" : "生成草稿"}
                    </Button>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Textarea
                      rows={16}
                      value={current.content}
                      onChange={(e) =>
                        setChapters((cs) => cs.map((x) => (x.key === current.key ? { ...x, content: e.target.value, status: "draft" } : x)))
                      }
                      placeholder="從右上的「生成草稿」開始，或直接撰寫／貼上內容。"
                    />
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{current.content.trim().length} 字</span>
                      <Button
                        size="sm" disabled={saveChapters.isPending}
                        onClick={() => saveChapters.mutate({ id: caseId, chapters })}
                      >
                        <Save className="w-4 h-4 mr-1" /> 儲存本章
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <div className="text-sm text-muted-foreground">此補助案未定義章節——先到補助情報頁補上官方章節格式。</div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ============ 審核室 ============ */}
        <TabsContent value="review">
          <Card className="mb-5">
            <CardContent className="py-4 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">目標分數</span>
                <Input className="w-20" type="number" min={50} max={100} value={target} onChange={(e) => setTarget(e.target.value)} />
                <Button variant="outline" size="sm" onClick={() => setTargetScore.mutate({ id: caseId, targetScore: Number(target) || 85 })}>設定</Button>
              </div>
              <div className="flex-1" />
              <Button
                variant="outline"
                disabled={runReview.isPending || looping}
                onClick={() => runReview.mutate({ caseId })}
              >
                <Play className="w-4 h-4 mr-1" /> 執行審核
              </Button>
              <Button
                variant="outline"
                disabled={!latest || revise.isPending || looping || latest.totalScore >= k.data.targetScore}
                onClick={async () => { await revise.mutateAsync({ caseId }); utils.cases.get.invalidate(); utils.review.list.invalidate(); utils.cases.list.invalidate(); }}
              >
                <Wrench className="w-4 h-4 mr-1" /> 接續修改一次
              </Button>
              <Button
                disabled={!latest || looping || latest.totalScore >= k.data.targetScore}
                onClick={loopUntilPass}
              >
                <Repeat2 className="w-4 h-4 mr-1" />
                {looping ? "修改迴圈進行中…" : "修改直到達標"}
              </Button>
            </CardContent>
          </Card>

          {!latest && (
            <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
              還沒有審核紀錄。寫完章節後按「執行審核」，系統會從五個面向評分、逐條指出改進方向。
            </CardContent></Card>
          )}

          {latest && (
            <div className="grid lg:grid-cols-5 gap-5 pb-8">
              <div className="lg:col-span-2 space-y-5">
                <Card>
                  <CardContent className="pt-6 text-center">
                    <div className={`text-6xl font-bold ${latest.totalScore >= k.data.targetScore ? "text-emerald-600" : "text-primary"}`}>
                      {latest.totalScore}
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">
                      第 {latest.round} 輪審核・目標 {k.data.targetScore} 分
                    </div>
                    {latest.totalScore >= k.data.targetScore ? (
                      <Badge className="mt-3 bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> 已達標，可以交件
                      </Badge>
                    ) : (
                      <Badge className="mt-3 bg-amber-100 text-amber-700 hover:bg-amber-100">
                        未達標，還差 {k.data.targetScore - latest.totalScore} 分
                      </Badge>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader><CardTitle className="text-base">五面向評分</CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                    {(latest.dimensions ?? []).map((d) => <DimBar key={d.key} d={d} />)}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader><CardTitle className="text-base">迭代歷史</CardTitle></CardHeader>
                  <CardContent>
                    <div className="flex items-end gap-2 h-28">
                      {history.map((r) => (
                        <div key={r.id} className="flex-1 flex flex-col items-center gap-1">
                          <span className="text-xs font-bold">{r.totalScore}</span>
                          <div
                            className={`w-full rounded-t ${r.totalScore >= k.data.targetScore ? "bg-emerald-500" : "bg-accent/70"}`}
                            style={{ height: `${Math.max(6, r.totalScore)}%` }}
                          />
                          <span className="text-xs text-muted-foreground">R{r.round}</span>
                        </div>
                      ))}
                    </div>
                    {latest.note && (
                      <div className="mt-4 pt-3 border-t border-border">
                        <div className="text-xs font-medium mb-1">上一輪修改內容</div>
                        <pre className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">{latest.note}</pre>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card className="lg:col-span-3">
                <CardHeader>
                  <CardTitle className="text-base">
                    問題與改進方向（{(latest.issues ?? []).filter((i: ReviewIssue) => i.status === "open").length} 項待處理）
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(latest.issues ?? []).length === 0 && (
                    <div className="text-sm text-emerald-700 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4" /> 沒有發現問題。
                    </div>
                  )}
                  {(latest.issues ?? []).map((it: ReviewIssue) => (
                    <div key={it.id} className="border border-border rounded-lg p-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={SEV[it.severity].cls}>{SEV[it.severity].label}</Badge>
                        <span className="text-xs text-muted-foreground">{it.location}</span>
                      </div>
                      <div className="text-sm mt-1.5 flex items-start gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 mt-1 text-amber-600 shrink-0" />
                        <span>{it.problem}</span>
                      </div>
                      <div className="text-sm mt-1.5 flex items-start gap-1.5 text-emerald-800 bg-emerald-50 rounded-md p-2">
                        <CheckCircle2 className="w-3.5 h-3.5 mt-1 shrink-0" />
                        <span><span className="font-medium">改進方向：</span>{it.suggestion}</span>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
