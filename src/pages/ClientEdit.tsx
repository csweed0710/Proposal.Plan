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
          <div className="md:col-span-2">
            <Label htmlFor="client-name">組織全名 <span aria-hidden="true" className="text-destructive">*</span></Label>
            <Input id="client-name" required aria-describedby="client-name-help" value={form.name} onChange={(e) => set("name", e.target.value)} />
            {!form.name && <p id="client-name-help" className="mt-1 text-xs text-muted-foreground">填寫組織全名後即可建立客戶。</p>}
          </div>
          <div>
            <Label htmlFor="client-org-type">組織型態</Label>
            <Select value={form.orgType} onValueChange={(v) => set("orgType", v)}>
              <SelectTrigger id="client-org-type"><SelectValue /></SelectTrigger>
              <SelectContent>{ORG_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label htmlFor="client-tax-id">統一編號／立案字號</Label><Input id="client-tax-id" value={form.taxId} onChange={(e) => set("taxId", e.target.value)} /></div>
          <div><Label htmlFor="client-founded-year">成立年份</Label><Input id="client-founded-year" type="number" min="1800" max="2100" value={form.foundedYear} onChange={(e) => set("foundedYear", e.target.value)} /></div>
          <div><Label htmlFor="client-city">所在地</Label><Input id="client-city" autoComplete="address-level1" value={form.city} onChange={(e) => set("city", e.target.value)} /></div>
          <div><Label htmlFor="client-employees-full">專職人數</Label><Input id="client-employees-full" type="number" min="0" value={form.employeesFull} onChange={(e) => set("employeesFull", e.target.value)} /></div>
          <div><Label htmlFor="client-employees-part">兼職人數</Label><Input id="client-employees-part" type="number" min="0" value={form.employeesPart} onChange={(e) => set("employeesPart", e.target.value)} /></div>
          <div><Label htmlFor="client-capital">資本額／基金（元）</Label><Input id="client-capital" type="number" min="0" value={form.capital} onChange={(e) => set("capital", e.target.value)} /></div>
          <div><Label htmlFor="client-revenue">年均營業額（元）</Label><Input id="client-revenue" type="number" min="0" value={form.revenueAvg} onChange={(e) => set("revenueAvg", e.target.value)} /></div>
          <div className="md:col-span-3"><Label htmlFor="client-strengths">優勢與特色</Label><Textarea id="client-strengths" rows={2} value={form.strengths} onChange={(e) => set("strengths", e.target.value)} /></div>
          <div className="md:col-span-3">
            <Label htmlFor="client-tags">領域標籤（用、分隔，適配分析要用）</Label>
            <Input id="client-tags" value={form.tagsText} onChange={(e) => set("tagsText", e.target.value)} placeholder="例如：社區、長照、公益、ESG" />
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base">聯絡窗口</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><Label htmlFor="contact-name">姓名</Label><Input id="contact-name" autoComplete="name" value={form.contactName} onChange={(e) => set("contactName", e.target.value)} /></div>
          <div><Label htmlFor="contact-title">職稱</Label><Input id="contact-title" autoComplete="organization-title" value={form.contactTitle} onChange={(e) => set("contactTitle", e.target.value)} /></div>
          <div><Label htmlFor="contact-phone">電話</Label><Input id="contact-phone" type="tel" autoComplete="tel" value={form.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} /></div>
          <div><Label htmlFor="contact-email">Email</Label><Input id="contact-email" type="email" autoComplete="email" value={form.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} /></div>
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
            <div key={i} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
              <Input className="col-span-5" placeholder="計畫名稱" value={p.name}
                aria-label={`第 ${i + 1} 件實績的計畫名稱`}
                onChange={(e) => setProjects((ps) => ps.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <Input className="col-span-2" placeholder="年度" value={p.year}
                aria-label={`第 ${i + 1} 件實績的年度`}
                onChange={(e) => setProjects((ps) => ps.map((x, j) => (j === i ? { ...x, year: e.target.value } : x)))} />
              <Input className="col-span-2" placeholder="經費" value={p.budget}
                aria-label={`第 ${i + 1} 件實績的經費`}
                onChange={(e) => setProjects((ps) => ps.map((x, j) => (j === i ? { ...x, budget: e.target.value } : x)))} />
              <Input className="col-span-2" placeholder="成果數據" value={p.outcome}
                aria-label={`第 ${i + 1} 件實績的成果數據`}
                onChange={(e) => setProjects((ps) => ps.map((x, j) => (j === i ? { ...x, outcome: e.target.value } : x)))} />
              <Button variant="ghost" size="icon" className="col-span-1" aria-label={`刪除第 ${i + 1} 件實績`} onClick={() => setProjects((ps) => ps.filter((_, j) => j !== i))}>
                <Trash2 className="w-4 h-4 text-destructive" />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="mb-8">
        <CardHeader><CardTitle className="text-base">執行能量與備忘</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 gap-4">
          <div><Label htmlFor="client-admin-capability">行政與核銷能量</Label><Textarea id="client-admin-capability" rows={2} value={form.adminCapability} onChange={(e) => set("adminCapability", e.target.value)} /></div>
          <div><Label htmlFor="client-financial-note">財務狀況</Label><Textarea id="client-financial-note" rows={2} value={form.financialNote} onChange={(e) => set("financialNote", e.target.value)} /></div>
          <div><Label htmlFor="client-notes">內部備忘（僅限已授權的系統使用者）</Label><Textarea id="client-notes" rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} /></div>
        </CardContent>
      </Card>

      <div className="flex gap-3 pb-8 items-center">
        {(create.isError || update.isError) && (
          <p className="text-sm text-destructive" role="alert">{(create.error ?? update.error)?.message}</p>
        )}
        <Button size="lg" onClick={submit} disabled={!form.name || create.isPending || update.isPending}>
          <Save className="w-4 h-4 mr-1" /> {isNew ? "建立客戶" : "儲存修改"}
        </Button>
        <Button size="lg" variant="outline" onClick={() => navigate(-1)}>取消</Button>
      </div>
    </div>
  );
}
