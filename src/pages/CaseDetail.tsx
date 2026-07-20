import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import {
  Sparkles, Save, Play, Wrench, Repeat2, CheckCircle2,
  AlertTriangle, Info, CircleCheck, CircleDashed, FileDown, Send, History,
  Share2, Copy, Check,
} from "lucide-react";
import { trpc } from "@/providers/trpc";
import { downloadDocx, downloadPdf, PageHeader, ScoreBadge } from "@/components/bits";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import type { CaseChapter, ChapterTable, IntakeQuestion, ReviewDimension, ReviewIssue } from "@contracts/types";
import { emptyChapterTable, TABLE_TYPE_LABELS, CASE_STATUSES } from "@contracts/types";
import { BudgetEditor, ScheduleEditor, KpiEditor } from "@/components/TableEditors";

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

// 章節版本歷史對話框：列出快照、預覽內容、一鍵還原
function VersionDialog({ caseId, chapterKey, chapterTitle, open, onOpenChange }: {
  caseId: number;
  chapterKey: string;
  chapterTitle: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const versions = trpc.cases.versions.useQuery(
    { id: caseId, chapterKey },
    { enabled: open },
  );
  const restore = trpc.cases.restoreVersion.useMutation({
    onSuccess: () => {
      utils.cases.get.invalidate();
      utils.cases.versions.invalidate();
      onOpenChange(false);
    },
  });
  const SOURCE_CLS: Record<string, string> = {
    "手動編輯": "bg-gray-100 text-gray-600",
    "AI 起草": "bg-violet-100 text-violet-700",
    "修改迴圈": "bg-blue-100 text-blue-700",
    "還原前快照": "bg-amber-100 text-amber-700",
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>「{chapterTitle}」版本歷史</DialogTitle>
          <DialogDescription>
            每次儲存、AI 起草、修改迴圈之前，系統都會自動留下快照。看走眼了隨時可以還原。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {(versions.data ?? []).length === 0 && (
            <div className="text-sm text-muted-foreground py-6 text-center">
              這個章節還沒有歷史版本——第一次更動內容後就會開始記錄。
            </div>
          )}
          {(versions.data ?? []).map((v) => (
            <div key={v.id} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs">
                  <Badge className={`${SOURCE_CLS[v.source] ?? "bg-gray-100 text-gray-600"} hover:bg-current/10`}>{v.source}</Badge>
                  <span className="text-muted-foreground">
                    {new Date(v.createdAt).toLocaleString("zh-TW", { hour12: false })}
                  </span>
                  {v.tableJson && <Badge variant="outline" className="text-xs">含表格</Badge>}
                </div>
                <Button
                  size="sm" variant="outline"
                  disabled={restore.isPending}
                  onClick={() => restore.mutate({ id: caseId, versionId: v.id })}
                >
                  還原成這版
                </Button>
              </div>
              <div className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-4 bg-secondary/50 rounded p-2">
                {v.content?.trim() ? v.content : "（無文字內容）"}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
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
  const [exportingPdf, setExportingPdf] = useState(false);
  const [pdfError, setPdfError] = useState("");
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

  // 所有動作的錯誤統一收到這條橫幅——不再「點了沒反應」
  const [actionError, setActionError] = useState("");
  const onErr = (e: { message: string }) => setActionError(e.message);

  const saveIntake = trpc.cases.saveIntake.useMutation({
    onSuccess: () => { setActionError(""); utils.cases.get.invalidate(); },
    onError: onErr,
  });
  const saveChapters = trpc.cases.saveChapters.useMutation({
    onSuccess: () => { setActionError(""); utils.cases.get.invalidate(); },
    onError: onErr,
  });
  const draft = trpc.cases.draftChapter.useMutation({
    onSuccess: (d) => {
      setActionError("");
      utils.cases.get.invalidate();
      setDraftInfo(
        d.usedAI
          ? `AI 已生成草稿${d.usedRefs ? `，引用 ${d.usedRefs} 份參考資料` : ""}`
          : "已生成規則模式骨架（啟用 AI 可得全文）",
      );
    },
    onError: onErr,
  });
  const runReview = trpc.review.run.useMutation({
    onSuccess: () => { setActionError(""); utils.cases.get.invalidate(); utils.review.list.invalidate(); utils.cases.list.invalidate(); },
    onError: onErr,
  });
  const revise = trpc.review.reviseAndReview.useMutation({ onError: onErr });
  const setTargetScore = trpc.cases.setTargetScore.useMutation({
    onSuccess: () => { setActionError(""); utils.cases.get.invalidate(); },
    onError: onErr,
  });
  const setStatus = trpc.cases.setStatus.useMutation({
    onSuccess: () => { setActionError(""); utils.cases.get.invalidate(); utils.cases.list.invalidate(); },
    onError: onErr,
  });
  const setResult = trpc.cases.setResult.useMutation({
    onSuccess: () => {
      setActionError("");
      setResultOpen(false);
      utils.cases.get.invalidate();
      utils.cases.list.invalidate();
    },
    onError: onErr,
  });
  const shareLink = trpc.cases.shareLink.useMutation({
    onSuccess: (d) => { setActionError(""); setShareUrl(`${window.location.origin}/intake/${d.token}`); },
    onError: onErr,
  });

  // 送件／結果登錄對話框狀態
  const [resultOpen, setResultOpen] = useState(false);
  const [resultStatus, setResultStatus] = useState<"submitted" | "won" | "lost">("submitted");
  const [submittedAt, setSubmittedAt] = useState("");
  const [resultAmount, setResultAmount] = useState("");
  const [feedback, setFeedback] = useState("");
  // 版本歷史對話框
  const [versionsOpen, setVersionsOpen] = useState(false);
  // 草稿生成結果提示
  const [draftInfo, setDraftInfo] = useState<string | null>(null);
  // 客戶自填連結
  const [shareUrl, setShareUrl] = useState("");
  const [copied, setCopied] = useState(false);

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

  const doExportPdf = async () => {
    setExportingPdf(true);
    setPdfError("");
    try {
      const r = await utils.cases.exportPdf.fetch({ id: caseId });
      downloadPdf(r.data, r.filename);
    } catch (e) {
      setPdfError(e instanceof Error ? e.message : "PDF 轉檔失敗");
    } finally {
      setExportingPdf(false);
    }
  };

  const MODE_LABEL = {
    template: "官方範本填寫（精準對位）",
    "auto-map": "章節標題自動對應",
    generic: "通用排版（此補助案尚未上傳範本）",
  } as const;

  // 舊資料狀態相容：早期版本的 writing/review 對應到新 pipeline
  const STATUS_ALIAS: Record<string, string> = { writing: "draft", review: "reviewing" };
  const statusKey = CASE_STATUSES.some((s) => s.key === k.data.status)
    ? k.data.status
    : (STATUS_ALIAS[k.data.status] ?? "intake");

  // 切換狀態：送件／得標／未通過需要額外資訊，開對話框；其餘直接改
  const onStatusChange = (v: string) => {
    if (v === "submitted" || v === "won" || v === "lost") {
      setResultStatus(v);
      setSubmittedAt(
        k.data.submittedAt
          ? new Date(k.data.submittedAt).toISOString().slice(0, 10)
          : new Date().toISOString().slice(0, 10),
      );
      setResultAmount(k.data.resultAmount != null ? String(k.data.resultAmount) : "");
      setFeedback(k.data.reviewFeedback ?? "");
      setResultOpen(true);
    } else {
      setStatus.mutate({ id: caseId, status: v as never });
    }
  };

  const RESULT_STATUS_LABEL = { submitted: "已送件", won: "得標", lost: "未通過" } as const;

  return (
    <div>
      <PageHeader
        title={k.data.title}
        desc={`${client?.name ?? ""} → ${grant?.name ?? ""}`}
        action={
          <div className="flex items-center gap-3">
            <ScoreBadge score={k.data.currentScore} target={k.data.targetScore} />
            <Button onClick={doExport} disabled={exporting || exportingPdf}>
              <FileDown className="w-4 h-4 mr-1" />
              {exporting ? "產生中…" : "匯出 Word"}
            </Button>
            <Button variant="outline" onClick={doExportPdf} disabled={exporting || exportingPdf}>
              <FileDown className="w-4 h-4 mr-1" />
              {exportingPdf ? "轉檔中…" : "匯出 PDF"}
            </Button>
          </div>
        }
      />

      {actionError && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-sm px-3 py-2 flex items-center justify-between gap-3">
          <span>{actionError}</span>
          <button type="button" className="text-xs underline shrink-0" onClick={() => setActionError("")}>關閉</button>
        </div>
      )}

      {/* 案件進度列：pipeline 狀態＋送件結果 */}
      <Card className="mb-5">
        <CardContent className="py-3 space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Send className="w-3.5 h-3.5" /> 案件狀態
            </span>
            <Select value={statusKey} onValueChange={onStatusChange}>
              <SelectTrigger className="w-32 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CASE_STATUSES.map((s) => (
                  <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {k.data.submittedAt && (
              <span className="text-xs text-muted-foreground">
                送件日 {new Date(k.data.submittedAt).toLocaleDateString("zh-TW")}
              </span>
            )}
            {k.data.resultAmount != null && (
              <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                核定 NT$ {k.data.resultAmount.toLocaleString()}
              </Badge>
            )}
            {(statusKey === "submitted" || statusKey === "won" || statusKey === "lost") && (
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onStatusChange(statusKey)}>
                更新送件資料
              </Button>
            )}
          </div>
          {k.data.reviewFeedback && (
            <div className="rounded-md bg-amber-50 border border-amber-200 p-2.5">
              <div className="text-xs font-medium text-amber-700 mb-1">委員審查意見（下次投同案的秘密武器）</div>
              <div className="text-xs text-amber-800/90 whitespace-pre-wrap">{k.data.reviewFeedback}</div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 送件／結果登錄對話框 */}
      <Dialog open={resultOpen} onOpenChange={setResultOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>登錄「{RESULT_STATUS_LABEL[resultStatus]}」</DialogTitle>
            <DialogDescription>
              這些紀錄會出現在儀表板，幫你追蹤每個案件的成果與投遞歷史。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="submittedAt">送件日期</Label>
              <Input id="submittedAt" type="date" value={submittedAt} onChange={(e) => setSubmittedAt(e.target.value)} />
            </div>
            {resultStatus === "won" && (
              <div className="space-y-1.5">
                <Label htmlFor="resultAmount">核定金額（元）</Label>
                <Input
                  id="resultAmount" type="number" min={0} placeholder="例如 1000000"
                  value={resultAmount} onChange={(e) => setResultAmount(e.target.value)}
                />
              </div>
            )}
            {resultStatus !== "submitted" && (
              <div className="space-y-1.5">
                <Label htmlFor="feedback">委員審查意見</Label>
                <Textarea
                  id="feedback" rows={4}
                  placeholder="把收到的審查意見貼在這裡——下次投同一個補助案時，這就是最珍貴的情報。"
                  value={feedback} onChange={(e) => setFeedback(e.target.value)}
                />
              </div>
            )}
            <Button
              className="w-full"
              disabled={setResult.isPending}
              onClick={() =>
                setResult.mutate({
                  id: caseId,
                  status: resultStatus,
                  submittedAt: submittedAt || null,
                  resultAmount: resultStatus === "won" && resultAmount ? Number(resultAmount) : null,
                  reviewFeedback: feedback,
                })
              }
            >
              {setResult.isPending ? "儲存中…" : "確認登錄"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 章節版本歷史 */}
      {current && (
        <VersionDialog
          caseId={caseId}
          chapterKey={current.key}
          chapterTitle={current.title}
          open={versionsOpen}
          onOpenChange={setVersionsOpen}
        />
      )}

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
              {pdfError && (
                <div className="rounded-md bg-destructive/10 border border-destructive/30 p-2.5 text-xs text-destructive">
                  {pdfError}
                </div>
              )}
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

          {/* 客戶自填連結 */}
          <Card className="mb-4">
            <CardContent className="py-3 flex flex-wrap items-center gap-3">
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Share2 className="w-3.5 h-3.5" /> 給客戶自己填：
              </span>
              {shareUrl ? (
                <>
                  <code className="text-xs bg-secondary rounded px-2 py-1 truncate max-w-md">{shareUrl}</code>
                  <Button
                    variant="outline" size="sm" className="h-7 text-xs"
                    onClick={() => {
                      navigator.clipboard.writeText(shareUrl).catch(() => {});
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                  >
                    {copied ? <Check className="w-3.5 h-3.5 mr-1 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 mr-1" />}
                    {copied ? "已複製" : "複製連結"}
                  </Button>
                </>
              ) : (
                <Button
                  variant="outline" size="sm" className="h-7 text-xs"
                  disabled={shareLink.isPending}
                  onClick={() => shareLink.mutate({ id: caseId })}
                >
                  {shareLink.isPending ? "產生中…" : "產生客戶填寫連結"}
                </Button>
              )}
              <span className="text-xs ml-auto">
                {k.data.intakeSubmittedAt ? (
                  <span className="text-emerald-600 font-medium">
                    客戶已於 {new Date(k.data.intakeSubmittedAt).toLocaleString("zh-TW", { hour12: false })} 送出
                  </span>
                ) : (
                  <span className="text-muted-foreground">客戶尚未送出</span>
                )}
              </span>
            </CardContent>
            {shareUrl && (
              <CardContent className="pt-0 pb-3">
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5">
                  這條連結等同填寫權限，請只傳給客戶本人（LINE、Email 皆可）。客戶送出後，答案會直接出現在下方問卷裡，你檢查完按「儲存問卷，進入寫作」即可。
                </p>
              </CardContent>
            )}
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
                  onClick={() => { setActiveChapter(c.key); setDraftInfo(null); }}
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
                    {c.tableType && <span className="text-primary font-medium">{TABLE_TYPE_LABELS[c.tableType]}</span>}
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
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setVersionsOpen(true)}>
                        <History className="w-4 h-4 mr-1" /> 歷史
                      </Button>
                      <Button
                        variant="outline" size="sm"
                        disabled={draft.isPending}
                        onClick={() => draft.mutate({ id: caseId, chapterKey: current.key })}
                      >
                        <Sparkles className="w-4 h-4 mr-1" />
                        {draft.isPending ? "生成中…" : current.content.trim() ? "重新生成草稿" : "生成草稿"}
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {/* 結構化表格（預算/進度/KPI 章節） */}
                    {current.tableType && (
                      <div className="rounded-lg border bg-card p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-medium">{TABLE_TYPE_LABELS[current.tableType]}</div>
                          {!current.table && (
                            <Button size="sm" variant="outline"
                              onClick={() =>
                                setChapters((cs) => cs.map((x) =>
                                  x.key === current.key ? { ...x, table: emptyChapterTable(current.tableType!), status: "draft" } : x))
                              }>
                              建立表格
                            </Button>
                          )}
                        </div>
                        {current.table?.type === "budget" && (
                          <BudgetEditor value={current.table.budget}
                            onChange={(b) => setChapters((cs) => cs.map((x) => (x.key === current.key ? { ...x, table: { type: "budget", budget: b } as ChapterTable, status: "draft" } : x)))} />
                        )}
                        {current.table?.type === "schedule" && (
                          <ScheduleEditor value={current.table.schedule}
                            onChange={(s) => setChapters((cs) => cs.map((x) => (x.key === current.key ? { ...x, table: { type: "schedule", schedule: s } as ChapterTable, status: "draft" } : x)))} />
                        )}
                        {current.table?.type === "kpi" && (
                          <KpiEditor value={current.table.kpi}
                            onChange={(k) => setChapters((cs) => cs.map((x) => (x.key === current.key ? { ...x, table: { type: "kpi", kpi: k } as ChapterTable, status: "draft" } : x)))} />
                        )}
                      </div>
                    )}

                    <Textarea
                      rows={current.tableType ? 9 : 16}
                      value={current.content}
                      onChange={(e) =>
                        setChapters((cs) => cs.map((x) => (x.key === current.key ? { ...x, content: e.target.value, status: "draft" } : x)))
                      }
                      placeholder={current.tableType ? "表格之外的補充說明文字（如經費編列原則、指標設定理念）…" : "從右上的「生成草稿」開始，或直接撰寫／貼上內容。"}
                    />
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">{current.content.trim().length} 字</span>
                      {draftInfo && (
                        <span className="text-xs text-emerald-600 flex items-center gap-1 truncate">
                          <Sparkles className="w-3 h-3 shrink-0" /> {draftInfo}
                        </span>
                      )}
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

                {(latest as { aiSummary?: string | null }).aiSummary && (
                  <Card className="border-violet-200 bg-violet-50/60">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-violet-600" /> 評審總評（AI 審稿模型）
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm leading-relaxed whitespace-pre-wrap text-violet-900/90">
                        {(latest as { aiSummary?: string | null }).aiSummary}
                      </p>
                    </CardContent>
                  </Card>
                )}

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
