import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ArrowDown, ArrowUp, Check, ClipboardPaste, Copy, Download, FileText, FileUp, Plus, Save, Trash2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { downloadDocx, PageHeader } from "@/components/bits";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GRANT_CATEGORIES, ORG_TYPES, TEMPLATE_FIELDS, type ChapterSpec, type RubricItem } from "@contracts/types";

const emptyForm = {
  name: "", agency: "", category: "其他", description: "",
  applyStart: "", applyEnd: "", rolling: false, deadlineNote: "",
  amountMin: "", amountMax: "", selfFundNote: "",
  orgTypes: [] as string[], eligibilityNote: "",
  attachmentsNote: "", sourceUrl: "", status: "open", needsVerification: false,
};

export default function GrantEdit() {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const [form, setForm] = useState(emptyForm);
  const [chapters, setChapters] = useState<ChapterSpec[]>([]);
  const [rubric, setRubric] = useState<RubricItem[]>([]);
  const [pasteText, setPasteText] = useState("");
  const [showPaste, setShowPaste] = useState(isNew);

  const existing = trpc.grants.get.useQuery({ id: Number(id) }, { enabled: !isNew });
  useEffect(() => {
    if (existing.data) {
      const g = existing.data;
      setForm({
        name: g.name, agency: g.agency, category: g.category, description: g.description ?? "",
        applyStart: g.applyStart ? String(g.applyStart).slice(0, 10) : "",
        applyEnd: g.applyEnd ? String(g.applyEnd).slice(0, 10) : "",
        rolling: g.rolling, deadlineNote: g.deadlineNote ?? "",
        amountMin: g.amountMin != null ? String(g.amountMin) : "",
        amountMax: g.amountMax != null ? String(g.amountMax) : "",
        selfFundNote: g.selfFundNote ?? "", orgTypes: g.orgTypes ?? [],
        eligibilityNote: g.eligibilityNote ?? "", attachmentsNote: g.attachmentsNote ?? "",
        sourceUrl: g.sourceUrl ?? "", status: g.status, needsVerification: g.needsVerification,
      });
      setChapters(g.chapterSchema ?? []);
      setRubric(g.rubric ?? []);
    }
  }, [existing.data]);

  const parse = trpc.grants.parseAnnouncement.useMutation({
    onSuccess: (d) => {
      setForm((f) => ({
        ...f,
        name: d.name || f.name, agency: (d as { agency?: string }).agency || f.agency,
        category: (d as { category?: string }).category || f.category,
        description: (d as { description?: string }).description || f.description,
        applyStart: (d.applyStart as string | null) ?? f.applyStart,
        applyEnd: (d.applyEnd as string | null) ?? f.applyEnd,
        rolling: Boolean(d.rolling),
        deadlineNote: (d as { deadlineNote?: string }).deadlineNote ?? f.deadlineNote,
        orgTypes: (d.orgTypes as string[] | undefined)?.length ? (d.orgTypes as string[]) : f.orgTypes,
        needsVerification: Boolean(d.needsVerification),
      }));
      if ((d.chapterSchema as ChapterSpec[] | undefined)?.length) setChapters(d.chapterSchema as ChapterSpec[]);
      if ((d.rubric as RubricItem[] | undefined)?.length) setRubric(d.rubric as RubricItem[]);
    },
  });

  const save = trpc.grants.create.useMutation({
    onSuccess: (d) => { utils.grants.list.invalidate(); navigate(`/grants/${d.id}`); },
  });
  const update = trpc.grants.update.useMutation({
    onSuccess: () => { utils.grants.list.invalidate(); utils.grants.get.invalidate(); navigate(-1); },
  });

  const set = (k: keyof typeof emptyForm, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const setChapter = (i: number, patch: Partial<ChapterSpec>) =>
    setChapters((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const moveChapter = (i: number, dir: -1 | 1) =>
    setChapters((cs) => {
      const next = [...cs];
      const j = i + dir;
      if (j < 0 || j >= next.length) return cs;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const submit = () => {
    const payload = {
      ...form,
      applyStart: form.applyStart || null,
      applyEnd: form.applyEnd || null,
      amountMin: form.amountMin ? Number(form.amountMin) : null,
      amountMax: form.amountMax ? Number(form.amountMax) : null,
      chapterSchema: chapters,
      rubric,
    };
    if (isNew) save.mutate(payload);
    else update.mutate({ ...payload, id: Number(id) });
  };

  return (
    <div>
      <PageHeader
        title={isNew ? "新增補助案" : "編輯補助案"}
        desc="章節格式與評分標準完全跟著官方公告走——每個補助案都可以不一樣"
      />

      {/* 貼上公告解析 */}
      <Card className="mb-6">
        <CardHeader className="cursor-pointer select-none" onClick={() => setShowPaste((s) => !s)}>
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardPaste className="w-4 h-4 text-accent" />
            貼上公告文字，自動解析出章節格式與評分標準
            <span className="text-xs text-muted-foreground font-normal">（{showPaste ? "收合" : "展開"}）</span>
          </CardTitle>
        </CardHeader>
        {showPaste && (
          <CardContent className="space-y-3">
            <Textarea
              rows={6}
              placeholder="把補助案的申請須知、公告全文貼在這裡——系統會抽出申請期限、金額、資格、章節架構與評分配分，你再核對修正。"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
            />
            <Button variant="outline" disabled={pasteText.trim().length < 20 || parse.isPending} onClick={() => parse.mutate({ text: pasteText })}>
              {parse.isPending ? "解析中…" : "解析公告"}
            </Button>
          </CardContent>
        )}
      </Card>

      {/* 基本資料 */}
      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base">基本資料</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <Label>計畫全名</Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div>
            <Label>主辦機關</Label>
            <Input value={form.agency} onChange={(e) => set("agency", e.target.value)} />
          </div>
          <div>
            <Label>類別</Label>
            <Select value={form.category} onValueChange={(v) => set("category", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{GRANT_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>申請開始日</Label>
            <Input type="date" value={form.applyStart} onChange={(e) => set("applyStart", e.target.value)} disabled={form.rolling} />
          </div>
          <div>
            <Label>申請截止日</Label>
            <Input type="date" value={form.applyEnd} onChange={(e) => set("applyEnd", e.target.value)} disabled={form.rolling} />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="rolling" checked={form.rolling} onCheckedChange={(v) => set("rolling", Boolean(v))} />
            <Label htmlFor="rolling" className="cursor-pointer">常年受理（隨到隨審）</Label>
          </div>
          <div>
            <Label>時程備註</Label>
            <Input value={form.deadlineNote} onChange={(e) => set("deadlineNote", e.target.value)} placeholder="例如：每年 2／6／10 月梯次" />
          </div>
          <div>
            <Label>補助下限（元）</Label>
            <Input type="number" value={form.amountMin} onChange={(e) => set("amountMin", e.target.value)} />
          </div>
          <div>
            <Label>補助上限（元）</Label>
            <Input type="number" value={form.amountMax} onChange={(e) => set("amountMax", e.target.value)} />
          </div>
          <div>
            <Label>自籌款規定</Label>
            <Input value={form.selfFundNote} onChange={(e) => set("selfFundNote", e.target.value)} placeholder="例如：補助款不得超過總經費 50%" />
          </div>
          <div>
            <Label>公告來源網址</Label>
            <Input value={form.sourceUrl} onChange={(e) => set("sourceUrl", e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <Label>適用組織型態</Label>
            <div className="flex flex-wrap gap-4 mt-2">
              {ORG_TYPES.map((t) => (
                <label key={t} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={form.orgTypes.includes(t)}
                    onCheckedChange={(v) =>
                      set("orgTypes", v ? [...form.orgTypes, t] : form.orgTypes.filter((x) => x !== t))
                    }
                  />
                  {t}
                </label>
              ))}
            </div>
          </div>
          <div className="md:col-span-2">
            <Label>資格條件</Label>
            <Textarea rows={2} value={form.eligibilityNote} onChange={(e) => set("eligibilityNote", e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <Label>計畫簡介</Label>
            <Textarea rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <Label>應備文件</Label>
            <Textarea rows={2} value={form.attachmentsNote} onChange={(e) => set("attachmentsNote", e.target.value)} />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="nv" checked={form.needsVerification} onCheckedChange={(v) => set("needsVerification", Boolean(v))} />
            <Label htmlFor="nv" className="cursor-pointer">時程待查證（提醒送件前核對公告）</Label>
          </div>
        </CardContent>
      </Card>

      {/* 章節格式編輯器 */}
      <Card className="mb-6">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">官方章節格式（{chapters.length} 章）</CardTitle>
          <Button
            variant="outline" size="sm"
            onClick={() => setChapters((cs) => [...cs, { key: `ch_${Date.now()}`, title: "新章節", required: true, guidance: "" }])}
          >
            <Plus className="w-4 h-4 mr-1" /> 加一章
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {chapters.length === 0 && (
            <div className="text-sm text-muted-foreground">還沒有章節——貼上公告解析，或手動逐章新增。案件的章節結構完全由此決定。</div>
          )}
          {chapters.map((c, i) => (
            <div key={c.key + i} className="border border-border rounded-lg p-3 space-y-2 bg-secondary/40">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-6">{i + 1}.</span>
                <Input className="font-medium" value={c.title} onChange={(e) => setChapter(i, { title: e.target.value })} />
                <label className="flex items-center gap-1.5 text-xs whitespace-nowrap cursor-pointer">
                  <Checkbox checked={c.required} onCheckedChange={(v) => setChapter(i, { required: Boolean(v) })} /> 必要
                </label>
                <Input
                  className="w-20" type="number" min={1} max={5} placeholder="權重"
                  value={c.weight ?? ""} onChange={(e) => setChapter(i, { weight: e.target.value ? Number(e.target.value) : undefined })}
                  title="相對重要性 1–5"
                />
                <Button variant="ghost" size="icon" onClick={() => moveChapter(i, -1)}><ArrowUp className="w-4 h-4" /></Button>
                <Button variant="ghost" size="icon" onClick={() => moveChapter(i, 1)}><ArrowDown className="w-4 h-4" /></Button>
                <Button variant="ghost" size="icon" onClick={() => setChapters((cs) => cs.filter((_, j) => j !== i))}>
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
              <Input
                placeholder="寫作指引／評審重點（來自申請須知）"
                value={c.guidance}
                onChange={(e) => setChapter(i, { guidance: e.target.value })}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* 評分標準編輯器 */}
      <Card className="mb-8">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">
            官方評分標準（{rubric.length} 項，共 {rubric.reduce((s, r) => s + (r.points || 0), 0)} 分）
          </CardTitle>
          <Button variant="outline" size="sm" onClick={() => setRubric((rs) => [...rs, { item: "新項目", points: 10, description: "" }])}>
            <Plus className="w-4 h-4 mr-1" /> 加一項
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {rubric.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input className="w-48" value={r.item} onChange={(e) => setRubric((rs) => rs.map((x, j) => (j === i ? { ...x, item: e.target.value } : x)))} />
              <Input
                className="w-24" type="number"
                value={r.points} onChange={(e) => setRubric((rs) => rs.map((x, j) => (j === i ? { ...x, points: Number(e.target.value) } : x)))}
              />
              <span className="text-xs text-muted-foreground">分</span>
              <Input
                className="flex-1" placeholder="評分說明"
                value={r.description} onChange={(e) => setRubric((rs) => rs.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
              />
              <Button variant="ghost" size="icon" onClick={() => setRubric((rs) => rs.filter((_, j) => j !== i))}>
                <Trash2 className="w-4 h-4 text-destructive" />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* 官方範本（等級三：固定格式 Word）*/}
      <TemplateCard
        grantId={isNew ? null : Number(id)}
        chapters={chapters}
        hasTemplate={Boolean(existing.data?.hasTemplate)}
        templateName={existing.data?.templateName ?? null}
      />

      <div className="flex gap-3 pb-8">
        <Button size="lg" onClick={submit} disabled={!form.name || !form.agency || save.isPending || update.isPending}>
          <Save className="w-4 h-4 mr-1" /> {isNew ? "建立補助案" : "儲存修改"}
        </Button>
        <Button size="lg" variant="outline" onClick={() => navigate(-1)}>取消</Button>
      </div>
    </div>
  );
}

// ============================================================================
// 官方範本卡：上傳該補助案的固定格式 .docx；完成的案件會直接填進這個格式
// ============================================================================
function CopyMark({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="shrink-0 p-1 rounded hover:bg-accent text-muted-foreground"
      title="複製標記"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

function TemplateCard({ grantId, chapters, hasTemplate, templateName }: {
  grantId: number | null;
  chapters: ChapterSpec[];
  hasTemplate: boolean;
  templateName: string | null;
}) {
  const utils = trpc.useUtils();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");

  const upload = trpc.grants.uploadTemplate.useMutation({
    onSuccess: () => { setError(""); utils.grants.get.invalidate(); utils.grants.list.invalidate(); },
    onError: (e) => setError(e.message),
  });
  const del = trpc.grants.deleteTemplate.useMutation({
    onSuccess: () => { utils.grants.get.invalidate(); utils.grants.list.invalidate(); },
  });

  const onPick = async (f: File | undefined) => {
    if (!f || grantId == null) return;
    if (!f.name.toLowerCase().endsWith(".docx")) { setError("只接受 .docx 檔案"); return; }
    const data = new Uint8Array(await f.arrayBuffer());
    upload.mutate({ id: grantId, name: f.name, data });
    if (fileRef.current) fileRef.current.value = "";
  };

  const download = async () => {
    if (grantId == null) return;
    const t = await utils.grants.downloadTemplate.fetch({ id: grantId });
    if (t) downloadDocx(t.data, t.name);
  };

  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          官方範本（固定格式 Word）
          {hasTemplate && <Badge variant="secondary">已上傳</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {grantId == null ? (
          <p className="text-sm text-muted-foreground">先儲存補助案，之後就能上傳官方範本。</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              上傳這個補助案的官方申請書 .docx。之後案件完成時，系統會把寫好的內容直接填進這個格式、產出可下載的 Word 檔——不用再複製貼上。
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              <input
                ref={fileRef} type="file" accept=".docx" className="hidden"
                onChange={(e) => onPick(e.target.files?.[0])}
              />
              <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
                <FileUp className="w-4 h-4 mr-1" />
                {upload.isPending ? "上傳中…" : hasTemplate ? "重新上傳範本" : "上傳範本 (.docx)"}
              </Button>
              {hasTemplate && (
                <>
                  <span className="text-sm flex items-center gap-1.5 text-foreground">
                    <FileText className="w-4 h-4 text-primary" /> {templateName}
                  </span>
                  <Button variant="ghost" size="sm" onClick={download}>
                    <Download className="w-4 h-4 mr-1" /> 下載
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => grantId != null && del.mutate({ id: grantId })}>
                    <Trash2 className="w-4 h-4 mr-1 text-destructive" /> 移除
                  </Button>
                </>
              )}
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="rounded-md border bg-muted/40 p-3 space-y-2">
              <p className="text-xs font-medium">範本標記小抄（在 Word 範本裡貼這些標記，匯出時就會自動代入）</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-xs">
                {chapters.map((c) => (
                  <div key={c.key} className="flex items-center gap-1.5">
                    <CopyMark text={`【章節:${c.key}】`} />
                    <code className="text-primary">{`【章節:${c.key}】`}</code>
                    <span className="text-muted-foreground truncate">→ {c.title}</span>
                  </div>
                ))}
                {TEMPLATE_FIELDS.map((f) => (
                  <div key={f.key} className="flex items-center gap-1.5">
                    <CopyMark text={`【欄位:${f.key}】`} />
                    <code className="text-primary">{`【欄位:${f.key}】`}</code>
                    <span className="text-muted-foreground truncate">→ {f.label}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                不貼標記也可以：系統會改用「章節標題自動對應」，把內容插到範本裡同名的標題後面。
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
