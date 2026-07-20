import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import { CheckCircle2, ClipboardList, Send } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { IntakeQuestion } from "@contracts/types";

// 客戶自填問卷頁（分享連結，無需登入）
// 設計原則：客戶不是系統使用者——畫面只給「看題、填答、送出」，其他一概不放。
export default function IntakeShare() {
  const { token } = useParams();
  const form = trpc.share.getForm.useQuery({ token: token ?? "" }, { retry: false });
  const submit = trpc.share.submit.useMutation();

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (form.data) {
      const init: Record<string, string> = {};
      for (const q of form.data.questions) init[q.id] = q.answer ?? "";
      setAnswers(init);
    }
  }, [form.data]);

  const groups = useMemo(() => {
    const qs = form.data?.questions ?? [];
    const order: string[] = [];
    const map = new Map<string, IntakeQuestion[]>();
    for (const q of qs) {
      if (!map.has(q.chapterKey)) { map.set(q.chapterKey, []); order.push(q.chapterKey); }
      map.get(q.chapterKey)!.push(q);
    }
    return order.map((key) => ({ key, items: map.get(key)! }));
  }, [form.data]);

  if (form.isLoading) {
    return <Shell><div className="text-center text-muted-foreground py-20">問卷載入中…</div></Shell>;
  }
  if (form.error || !form.data) {
    return (
      <Shell>
        <Card className="max-w-lg mx-auto">
          <CardContent className="py-10 text-center space-y-2">
            <div className="text-lg font-semibold">連結無效</div>
            <p className="text-sm text-muted-foreground">
              這個問卷連結不存在或已失效，請向您的提案顧問重新索取連結。
            </p>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  const d = form.data;
  const total = d.questions.length;
  const answered = d.questions.filter((q) => (answers[q.id] ?? "").trim()).length;

  const titleOf = (key: string, idx: number) =>
    key === "__profile__" ? `${idx + 1}．組織基本資料` :
    key === "__rubric__" ? `${idx + 1}．評分重點補充` :
    `${idx + 1}．${d.chapterTitles[key] ?? "計畫內容"}`;

  const onSubmit = () => {
    submit.mutate(
      { token: token ?? "", answers: Object.entries(answers).map(([id, answer]) => ({ id, answer })) },
      { onSuccess: () => { setDone(true); window.scrollTo({ top: 0 }); } },
    );
  };

  if (done) {
    return (
      <Shell>
        <Card className="max-w-lg mx-auto">
          <CardContent className="py-12 text-center space-y-3">
            <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
            <div className="text-xl font-bold">已送出，感謝您！</div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              您的資料已安全送達。提案顧問會依此撰寫計畫書，如需補充會再與您聯繫。
              若發現有誤，在顧問開始寫作前，用同一個連結可再次修改送出。
            </p>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="max-w-2xl mx-auto space-y-5">
        {/* 標頭 */}
        <div className="text-center space-y-1.5 pb-1">
          <ClipboardList className="w-8 h-8 text-primary mx-auto" />
          <h1 className="text-xl font-bold">{d.clientName}｜計畫資料問卷</h1>
          <p className="text-sm text-muted-foreground">
            申請「{d.grantName}」（{d.agency}）
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed max-w-md mx-auto">
            用自己的話回答就好——條列、口語都可以，每題下面的「例」只是示範，照那個感覺寫您真實的情況。
            不確定的題目寫「不知道」沒關係，顧問會接手補強；您給的事實（數字、日期、名字）越多，計畫書就越有說服力。
          </p>
          {d.submittedAt && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-1.5 inline-block">
              您曾於 {new Date(d.submittedAt).toLocaleString("zh-TW", { hour12: false })} 送出；可修改後再次送出
            </p>
          )}
        </div>

        {/* 進度條（置頂吸附） */}
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur py-2">
          <div className="flex items-center gap-3">
            <div className="h-2 flex-1 rounded-full bg-secondary overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${total ? (answered / total) * 100 : 0}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground whitespace-nowrap tabular-nums">{answered}/{total} 題</span>
          </div>
        </div>

        {/* 題目（依章節分組） */}
        {groups.map((g, gi) => (
          <Card key={g.key}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{titleOf(g.key, gi)}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {g.items.map((q) => (
                <div key={q.id}>
                  <div className="text-sm font-medium mb-1">{q.question}</div>
                  {q.hint && <div className="text-xs text-muted-foreground mb-1.5">{q.hint}</div>}
                  <Textarea
                    rows={3}
                    value={answers[q.id] ?? ""}
                    onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                    placeholder="請在此填寫…"
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        ))}

        {/* 送出 */}
        <div className="pb-10 space-y-2">
          {submit.error && <p className="text-sm text-destructive text-center">{submit.error.message}</p>}
          <Button size="lg" className="w-full" disabled={submit.isPending} onClick={onSubmit}>
            <Send className="w-4 h-4 mr-1" />
            {submit.isPending ? "送出中…" : `送出問卷（已填 ${answered}/${total} 題）`}
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            沒填完的題目可以留空，之後用同一個連結回來補。
          </p>
        </div>
      </div>
    </Shell>
  );
}

// 獨立外框：不給系統側欄，只有乾淨的置中版面
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-secondary/40">
      <div className="px-4 py-8">{children}</div>
    </div>
  );
}
