import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Plus, Search, ExternalLink } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { PageHeader, EmptyBox, fmtMoney, deadlineText } from "@/components/bits";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GRANT_CATEGORIES } from "@contracts/types";

export default function Grants() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [windowDays, setWindowDays] = useState("90");
  const list = trpc.grants.list.useQuery({ windowDays: Number(windowDays), q, category });

  return (
    <div>
      <PageHeader
        title="補助情報"
        desc="每一案都帶著自己的官方章節格式與評分標準——案件建立時整組帶入，不寫死"
        action={
          <Button onClick={() => navigate("/grants/new")}>
            <Plus className="w-4 h-4 mr-1" /> 新增補助案
          </Button>
        }
      />

      <div className="flex flex-wrap gap-3 mb-5">
        <div className="relative flex-1 min-w-56">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="搜尋計畫名稱或機關…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select value={category || "all"} onValueChange={(v) => setCategory(v === "all" ? "" : v)}>
          <SelectTrigger className="w-40"><SelectValue placeholder="全部類別" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部類別</SelectItem>
            {GRANT_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={windowDays} onValueChange={setWindowDays}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="30">未來 30 天</SelectItem>
            <SelectItem value="90">未來 3 個月</SelectItem>
            <SelectItem value="180">未來 6 個月</SelectItem>
            <SelectItem value="3650">全部（含未來）</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {(list.data ?? []).length === 0 && !list.isLoading && (
        <EmptyBox text="此條件下沒有補助案" action={<Button variant="outline" onClick={() => navigate("/grants/new")}>新增或貼上公告解析</Button>} />
      )}

      <div className="space-y-3">
        {(list.data ?? []).map((g) => (
          <Link key={g.id} to={`/grants/${g.id}`}>
            <Card className="hover:shadow-md transition-shadow">
              <CardContent className="py-4 flex items-center gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{g.name}</span>
                    <Badge variant="secondary">{g.category}</Badge>
                    {g.rolling && <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">常年受理</Badge>}
                    {g.needsVerification && <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">時程待查證</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1.5 flex flex-wrap gap-x-4">
                    <span>{g.agency}</span>
                    <span>補助上限 {fmtMoney(g.amountMax)}</span>
                    <span className="text-accent">{deadlineText(g.rolling, g.applyEnd, g.deadlineNote)}</span>
                    <span>{(g.chapterSchema ?? []).length} 章・{(g.rubric ?? []).length} 項評分</span>
                  </div>
                </div>
                {g.sourceUrl && <ExternalLink className="w-4 h-4 text-muted-foreground shrink-0" />}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
