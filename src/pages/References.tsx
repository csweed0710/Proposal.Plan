import { useRef, useState } from "react";
import { BookOpen, FileUp, Plus, Trash2, Eye, Sparkles, Info } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { PageHeader } from "@/components/bits";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { REF_KINDS, REF_KIND_LABELS, type RefKind } from "@contracts/types";

const KIND_CLS: Record<string, string> = {
  example: "bg-emerald-100 text-emerald-700",
  rubric_doc: "bg-blue-100 text-blue-700",
  feedback: "bg-amber-100 text-amber-700",
  data: "bg-violet-100 text-violet-700",
};

export default function References() {
  const utils = trpc.useUtils();
  const [kindFilter, setKindFilter] = useState("");
  const [grantFilter, setGrantFilter] = useState<number | null>(null);
  const list = trpc.references.list.useQuery({ kind: kindFilter, grantId: grantFilter });
  const grants = trpc.grants.list.useQuery({ windowDays: 3650, q: "", category: "" });

  // 新增對話框狀態
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<RefKind>("example");
  const [grantId, setGrantId] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<{ name: string; data: Uint8Array } | null>(null);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // 檢視全文
  const [viewId, setViewId] = useState<number | null>(null);
  const viewDoc = trpc.references.get.useQuery({ id: viewId! }, { enabled: viewId != null });

  const create = trpc.references.create.useMutation({
    onSuccess: () => {
      setOpen(false);
      setTitle(""); setNote(""); setText(""); setFile(null); setError("");
      utils.references.list.invalidate();
    },
    onError: (e) => setError(e.message),
  });
  const remove = trpc.references.remove.useMutation({
    onSuccess: () => utils.references.list.invalidate(),
  });

  const onPick = async (f: File | undefined) => {
    if (!f) return;
    const name = f.name.toLowerCase();
    if (name.endsWith(".pdf")) {
      setError("PDF 無法直接讀取——請開啟檔案、複製文字，改用「貼上文字」");
      return;
    }
    if (!name.endsWith(".docx") && !name.endsWith(".txt") && !name.endsWith(".md")) {
      setError("只接受 .docx／.txt／.md；掃描檔與照片請將重點打字貼上");
      return;
    }
    setError("");
    const data = new Uint8Array(await f.arrayBuffer());
    setFile({ name: f.name, data });
    if (!title) setTitle(f.name.replace(/\.(docx|txt|md)$/i, ""));
    if (fileRef.current) fileRef.current.value = "";
  };

  const submit = () => {
    create.mutate({
      title: title.trim(),
      kind,
      grantId,
      note,
      text,
      filename: file?.name ?? null,
      fileData: file?.data,
    });
  };

  const kindUsage = REF_KINDS.find((k) => k.key === kind)?.usage ?? "";

  return (
    <div>
      <PageHeader
        title="參考資料庫"
        desc="得標範本、委員意見、數據文獻——餵給系統，AI 起草與修改自動引用，越用越強"
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus className="w-4 h-4 mr-1" /> 新增資料
          </Button>
        }
      />

      {/* 說明卡 */}
      <Card className="mb-5 border-accent/30 bg-accent/5">
        <CardContent className="py-3 text-xs text-muted-foreground flex gap-2">
          <Info className="w-4 h-4 shrink-0 text-accent" />
          <span>
            系統只保留<b>文字內容</b>供 AI 使用，原始檔案請自行留存。綁定特定補助案的資料只會用在該案；「通用」則全部案件都會參考。
            登錄案件結果時填的委員意見會<b>自動歸檔</b>到這裡。
          </span>
        </CardContent>
      </Card>

      {/* 篩選列 */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <button
          onClick={() => setKindFilter("")}
          className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${kindFilter === "" ? "bg-primary text-primary-foreground border-primary" : "hover:bg-secondary"}`}
        >
          全部
        </button>
        {REF_KINDS.map((k) => (
          <button
            key={k.key}
            onClick={() => setKindFilter(kindFilter === k.key ? "" : k.key)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${kindFilter === k.key ? "bg-primary text-primary-foreground border-primary" : "hover:bg-secondary"}`}
          >
            {k.label}
          </button>
        ))}
        <div className="ml-auto">
          <Select
            value={grantFilter == null ? "all" : String(grantFilter)}
            onValueChange={(v) => setGrantFilter(v === "all" ? null : Number(v))}
          >
            <SelectTrigger className="w-52 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部補助案</SelectItem>
              {(grants.data ?? []).map((g) => (
                <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 清單 */}
      <div className="space-y-3 pb-8">
        {(list.data ?? []).length === 0 && (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              還沒有參考資料。從一份得標範本開始——AI 寫出來的東西會立刻不一樣。
            </CardContent>
          </Card>
        )}
        {(list.data ?? []).map((d) => (
          <Card key={d.id}>
            <CardContent className="py-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className={`${KIND_CLS[d.kind] ?? "bg-gray-100 text-gray-600"} hover:bg-current/10`}>
                    {REF_KIND_LABELS[d.kind] ?? d.kind}
                  </Badge>
                  <span className="text-sm font-medium">{d.title}</span>
                  <Badge variant="outline" className="text-xs">{d.grantName ?? "全部通用"}</Badge>
                </div>
                {d.note && <div className="text-xs text-muted-foreground mt-1">備註：{d.note}</div>}
                <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{d.preview}</div>
                <div className="text-xs text-muted-foreground/70 mt-1">
                  {d.textLength.toLocaleString()} 字・{new Date(d.createdAt).toLocaleDateString("zh-TW")} 加入
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="icon" onClick={() => setViewId(d.id)} title="檢視全文">
                  <Eye className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => remove.mutate({ id: d.id })} title="刪除">
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 新增對話框 */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>新增參考資料</DialogTitle>
            <DialogDescription>
              系統只保留文字內容。PDF 請複製文字貼上；掃描檔與照片請把重點打字輸入。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>資料類型</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as RefKind)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REF_KINDS.map((k) => (
                    <SelectItem key={k.key} value={k.key}>{k.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {kindUsage && <p className="text-xs text-muted-foreground flex items-center gap-1"><Sparkles className="w-3 h-3 text-accent" />{kindUsage}</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>標題</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：113 年 SBIR 得標計畫書" />
              </div>
              <div className="space-y-1.5">
                <Label>適用補助案</Label>
                <Select value={grantId == null ? "all" : String(grantId)} onValueChange={(v) => setGrantId(v === "all" ? null : Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部通用</SelectItem>
                    {(grants.data ?? []).map((g) => (
                      <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>備註（這份好在哪裡／要注意什麼）</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：效益章的寫法特別受委員肯定" />
            </div>

            <div className="space-y-1.5">
              <Label>內容</Label>
              <Textarea
                rows={8}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="直接貼上全文或重點段落……（上傳檔案則免貼）"
              />
            </div>

            <div className="flex items-center gap-3">
              <input ref={fileRef} type="file" accept=".docx,.txt,.md" className="hidden" onChange={(e) => onPick(e.target.files?.[0])} />
              <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
                <FileUp className="w-4 h-4 mr-1" /> 上傳 .docx／.txt
              </Button>
              {file && <span className="text-xs text-muted-foreground">{file.name}（{(file.data.byteLength / 1024).toFixed(0)} KB）</span>}
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button
              className="w-full"
              disabled={!title.trim() || (!text.trim() && !file) || create.isPending}
              onClick={submit}
            >
              {create.isPending ? "存入中…" : "存入參考資料庫"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 檢視全文 */}
      <Dialog open={viewId != null} onOpenChange={(o) => !o && setViewId(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookOpen className="w-4 h-4" /> {viewDoc.data?.title ?? "載入中…"}
            </DialogTitle>
          </DialogHeader>
          <div className="text-sm whitespace-pre-wrap leading-relaxed">{viewDoc.data?.textContent ?? ""}</div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
