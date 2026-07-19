import { Link, useNavigate } from "react-router";
import { Plus, MapPin } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { PageHeader, EmptyBox } from "@/components/bits";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default function Clients() {
  const navigate = useNavigate();
  const list = trpc.clients.list.useQuery();

  return (
    <div>
      <PageHeader
        title="客戶資料庫"
        desc="客戶的所有資訊永久記住——建立新案件時自動帶入，不用重問"
        action={<Button onClick={() => navigate("/clients/new")}><Plus className="w-4 h-4 mr-1" /> 新增客戶</Button>}
      />

      {(list.data ?? []).length === 0 && !list.isLoading && (
        <EmptyBox text="還沒有客戶" action={<Button variant="outline" onClick={() => navigate("/clients/new")}>建立第一位客戶</Button>} />
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {(list.data ?? []).map((c) => (
          <Link key={c.id} to={`/clients/${c.id}`}>
            <Card className="h-full hover:shadow-md transition-shadow">
              <CardContent className="pt-5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{c.name}</div>
                    <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                      <Badge variant="secondary">{c.orgType}</Badge>
                      {c.city && <span className="flex items-center gap-0.5"><MapPin className="w-3 h-3" />{c.city}</span>}
                      {c.foundedYear && <span>{c.foundedYear} 年成立</span>}
                    </div>
                  </div>
                  <Badge variant="outline">{c.caseCount} 案</Badge>
                </div>
                {c.strengths && <p className="text-xs text-muted-foreground mt-3 line-clamp-2 leading-relaxed">{c.strengths}</p>}
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {(c.tags ?? []).slice(0, 5).map((t) => (
                    <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground">{t}</span>
                  ))}
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
