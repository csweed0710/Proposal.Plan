import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Plus, Save, Trash2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { PageHeader } from "@/components/bits";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ORG_TYPES } from "@contracts/types";

type Project = { name: string; year: string; budget: string; outcome: string };

const empty = {
  name: "", orgType: "社團法人", taxId: "", foundedYear: "", city: "",
  employeesFull: "", employeesPart: "", capital: "", revenueAvg: "",
  contactName: "", contactTitle: "", contactPhone: "", contactEmail: "",
  strengths: "", adminCapability: "", financialNote: "", notes: "", tagsText: "",
};

export default function ClientEdit() {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [form, setForm] = useState(empty);
  const [projects, setProjects] = useState<Project[]>([]);

  const existing = trpc.clients.get.useQuery({ id: Number(id) }, { enabled: !isNew });
  useEffect(() => {
    if (existing.data) {
      const c = existing.data;
      setForm({
        name: c.name, orgType: c.orgType, taxId: c.taxId ?? "",
        foundedYear: c.foundedYear != null ? String(c.foundedYear) : "",
        city: c.city ?? "",
        employeesFull: c.employeesFull != null ? String(c.employeesFull) : "",
        employeesPart: c.employeesPart != null ? String(c.employeesPart) : "",
        capital: c.capital != null ? String(c.capital) : "",
        revenueAvg: c.revenueAvg != null ? String(c.revenueAvg) : "",
        contactName: c.contactName ?? "", contactTitle: c.contactTitle ?? "",
        contactPhone: c.contactPhone ?? "", contactEmail: c.contactEmail ?? "",
        strengths: c.strengths ?? "", adminCapability: c.adminCapability ?? "",
        financialNote: c.financialNote ?? "", notes: c.notes ?? "",
        tagsText: (c.tags ?? []).join("、"),
      });
      setProjects(c.pastProjects ?? []);
    }
  }, [existing.data]);

  const create = trpc.clients.create.useMutation({
    onSuccess: (d) => { utils.clients.list.invalidate(); navigate(`/clients/${d.id}`); },
  });
  const update = trpc.clients.update.useMutation({
    onSuccess: () => { utils.clients.list.invalidate(); utils.clients.get.invalidate(); navigate(-1); },
  });

  const set = (k: keyof typeof empty, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const num = (s: string) => (s ? Number(s) : null);

  const submit = () => {
    const payload = {
      name: form.name, orgType: form.orgType, taxId: form.taxId,
      foundedYear: num(form.foundedYear), city: form.city,
      employeesFull: num(form.employeesFull), employeesPart: num(form.employeesPart),
      capital: num(form.capital), revenueAvg: num(form.revenueAvg),
      contactName: form.contactName, contactTitle: form.contactTitle,
      contactPhone: form.contactPhone, contactEmail: form.contactEmail,
      strengths: form.strengths, adminCapability: form.adminCapability,
      financialNote: form.financialNote, notes: form.notes,
      pastProjects: projects.filter((p) => p.name.trim()),
      tags: form.tagsText.split(/[、,，\s]/).map((t) => t.trim()).filter(Boolean),
    };
    if (isNew) create.mutate(payload);
    else update.mutate({ ...payload, id: Number(id) });
  };

  return (
    <div>
      <PageHeader title={isNew ? "新增客戶" : "編輯客戶"} desc="這裡的每一個欄位，都是下一次案件的記憶" />

      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base">組織資料</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2"><Label>組織全名</Label><Input value={form.name} onChange={(e) => set("name", e.target.value)} /></div>
          <div>
            <Label>組織型態</Label>
            <Select value={form.orgType} onValueChange={(v) => set("orgType", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{ORG_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>統一編號／立案字號</Label><Input value={form.taxId} onChange={(e) => set("taxId", e.target.value)} /></div>
          <div><Label>成立年份</Label><Input type="number" value={form.foundedYear} onChange={(e) => set("foundedYear", e.target.value)} /></div>
          <div><Label>所在地</Label><Input value={form.city} onChange={(e) => set("city", e.target.value)} /></div>
          <div><Label>專職人數</Label><Input type="number" value={form.employeesFull} onChange={(e) => set("employeesFull", e.target.value)} /></div>
          <div><Label>兼職人數</Label><Input type="number" value={form.employeesPart} onChange={(e) => set("employeesPart", e.target.value)} /></div>
          <div><Label>資本額／基金（元）</Label><Input type="number" value={form.capital} onChange={(e) => set("capital", e.target.value)} /></div>
          <div><Label>年均營業額（元）</Label><Input type="number" value={form.revenueAvg} onChange={(e) => set("revenueAvg", e.target.value)} /></div>
          <div className="md:col-span-3"><Label>優勢與特色</Label><Textarea rows={2} value={form.strengths} onChange={(e) => set("strengths", e.target.value)} /></div>
          <div className="md:col-span-3">
            <Label>領域標籤（用、分隔，適配分析要用）</Label>
            <Input value={form.tagsText} onChange={(e) => set("tagsText", e.target.value)} placeholder="例如：社區、長照、公益、ESG" />
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base">聯絡窗口</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><Label>姓名</Label><Input value={form.contactName} onChange={(e) => set("contactName", e.target.value)} /></div>
          <div><Label>職稱</Label><Input value={form.contactTitle} onChange={(e) => set("contactTitle", e.target.value)} /></div>
          <div><Label>電話</Label><Input value={form.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} /></div>
          <div><Label>Email</Label><Input value={form.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} /></div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">過往實績（{projects.length} 件）</CardTitle>
          <Button variant="outline" size="sm" onClick={() => setProjects((ps) => [...ps, { name: "", year: "", budget: "", outcome: "" }])}>
            <Plus className="w-4 h-4 mr-1" /> 加一件
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {projects.length === 0 && <div className="text-sm text-muted-foreground">實績是適配分析與計畫書「過去實績」章節的彈藥。</div>}
          {projects.map((p, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center">
              <Input className="col-span-5" placeholder="計畫名稱" value={p.name}
                onChange={(e) => setProjects((ps) => ps.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <Input className="col-span-2" placeholder="年度" value={p.year}
                onChange={(e) => setProjects((ps) => ps.map((x, j) => (j === i ? { ...x, year: e.target.value } : x)))} />
              <Input className="col-span-2" placeholder="經費" value={p.budget}
                onChange={(e) => setProjects((ps) => ps.map((x, j) => (j === i ? { ...x, budget: e.target.value } : x)))} />
              <Input className="col-span-2" placeholder="成果數據" value={p.outcome}
                onChange={(e) => setProjects((ps) => ps.map((x, j) => (j === i ? { ...x, outcome: e.target.value } : x)))} />
              <Button variant="ghost" size="icon" className="col-span-1" onClick={() => setProjects((ps) => ps.filter((_, j) => j !== i))}>
                <Trash2 className="w-4 h-4 text-destructive" />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="mb-8">
        <CardHeader><CardTitle className="text-base">執行能量與備忘</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 gap-4">
          <div><Label>行政與核銷能量</Label><Textarea rows={2} value={form.adminCapability} onChange={(e) => set("adminCapability", e.target.value)} /></div>
          <div><Label>財務狀況</Label><Textarea rows={2} value={form.financialNote} onChange={(e) => set("financialNote", e.target.value)} /></div>
          <div><Label>內部備忘（只有你看得到）</Label><Textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} /></div>
        </CardContent>
      </Card>

      <div className="flex gap-3 pb-8">
        <Button size="lg" onClick={submit} disabled={!form.name || create.isPending || update.isPending}>
          <Save className="w-4 h-4 mr-1" /> {isNew ? "建立客戶" : "儲存修改"}
        </Button>
        <Button size="lg" variant="outline" onClick={() => navigate(-1)}>取消</Button>
      </div>
    </div>
  );
}
