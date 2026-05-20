import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Bot, Send, Loader2, Check, X, FileText, Search } from "lucide-react";
import { api } from "@/lib/api";
import { handleApiError } from "@/lib/errors";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { formatAmount, formatDate } from "@/lib/format";

interface InvoiceItem {
  name: string;
  unit: string;
  quantity: number;
  price: number;
  vatRate: number;
}
interface CreateInvoicePayload {
  organizationId?: string;
  counterpartyId?: string;
  counterpartyInn?: string;
  dueDate?: string;
  paymentPurpose?: string;
  vatRate: number;
  vatIncluded: boolean;
  items: InvoiceItem[];
}
type AiAction =
  | { type: "answer"; payload: { text: string }; missingFields: string[] }
  | { type: "find_overdue_invoices"; payload: Record<string, never>; missingFields: string[] }
  | { type: "create_invoice"; payload: CreateInvoicePayload; missingFields: string[] };

interface ApplyResult {
  ok: boolean;
  result?: unknown;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  action?: AiAction;
  applied?: ApplyResult;
}

export function AiChatPage() {
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [thread, setThread] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [applying, setApplying] = useState(false);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    const userMsg: ChatMessage = { role: "user", content: text };
    setThread((prev) => [...prev, userMsg]);
    setInput("");
    try {
      const history = thread.map((m) => ({ role: m.role, content: m.content }));
      const r = await api.post<{ action: AiAction; raw: string }>("/ai/chat", { message: text, history });
      const assistantContent =
        r.data.action.type === "answer"
          ? r.data.action.payload.text
          : "AI предложил действие — подтвердите выполнение ниже.";
      setThread((prev) => [...prev, { role: "assistant", content: assistantContent, action: r.data.action }]);
    } catch (err) {
      handleApiError(err);
      setThread((prev) => [...prev, { role: "assistant", content: "Произошла ошибка. Возможно AI не настроен — откройте раздел AI → Настройки." }]);
    } finally {
      setSending(false);
    }
  }

  async function apply(index: number) {
    const msg = thread[index];
    if (!msg?.action) return;
    setApplying(true);
    try {
      const r = await api.post<ApplyResult>("/ai/apply", { action: msg.action });
      setThread((prev) => prev.map((m, i) => i === index ? { ...m, applied: r.data } : m));
      toast.success("Действие выполнено");
    } catch (err) {
      handleApiError(err);
    } finally {
      setApplying(false);
    }
  }

  function reject(index: number) {
    setThread((prev) => prev.map((m, i) => i === index ? { ...m, applied: { ok: false } } : m));
  }

  const suggestions = [
    "Покажи все просроченные счета",
    "Создай счёт для ООО Бета на 50 000 рублей за консалтинг",
    "Какая ставка НДС на УСН в 2026 при доходе 100 млн?",
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Bot className="h-6 w-6" /> AI Ассистент
        </h1>
        <Button variant="outline" onClick={() => navigate("/ai/settings")}>Настройки</Button>
      </div>

      {thread.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">С чего начать?</CardTitle>
            <CardDescription>Спросите вопрос или попросите создать документ. AI возвращает структурированное действие, которое вы подтверждаете перед применением.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {suggestions.map((s) => (
              <Button key={s} variant="outline" className="w-full justify-start" onClick={() => setInput(s)}>
                {s}
              </Button>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="space-y-3">
        {thread.map((m, i) => (
          <Card key={i} className={m.role === "user" ? "bg-muted/30" : ""}>
            <CardContent className="pt-4 space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant={m.role === "user" ? "secondary" : "default"}>
                  {m.role === "user" ? "Вы" : "AI"}
                </Badge>
                {m.action ? <Badge variant="outline">{actionLabel(m.action.type)}</Badge> : null}
              </div>
              <div className="text-sm whitespace-pre-wrap">{m.content}</div>

              {m.action && m.action.type !== "answer" && !m.applied ? (
                <ActionPreview action={m.action} onApply={() => apply(i)} onReject={() => reject(i)} applying={applying} />
              ) : null}

              {m.applied?.ok ? (
                <ResultBlock action={m.action} result={m.applied.result} />
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>

      <form onSubmit={send} className="flex gap-2 sticky bottom-0 bg-background py-3">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Напишите запрос — создать счёт, найти просроченные..."
          rows={2}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <Button type="submit" disabled={sending || !input.trim()} aria-label="Отправить">
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </form>
    </div>
  );
}

function actionLabel(type: AiAction["type"]): string {
  if (type === "create_invoice") return "Создание счёта";
  if (type === "find_overdue_invoices") return "Поиск просроченных";
  return "Ответ";
}

function ActionPreview({ action, onApply, onReject, applying }: { action: AiAction; onApply: () => void; onReject: () => void; applying: boolean }) {
  const missing = action.missingFields ?? [];

  if (action.type === "create_invoice") {
    const p = action.payload;
    const totals = p.items.reduce((s, it) => s + (it.quantity * it.price), 0);
    return (
      <div className="rounded-md border p-3 bg-muted/30 space-y-2 mt-2">
        <div className="text-xs font-semibold flex items-center gap-1">
          <FileText className="h-3.5 w-3.5" /> Превью счёта
        </div>
        <div className="text-sm space-y-0.5">
          <div>Контрагент: {p.counterpartyInn ? `по ИНН ${p.counterpartyInn}` : p.counterpartyId ?? <span className="text-destructive">не указан</span>}</div>
          <div>Срок оплаты: {p.dueDate ?? "—"}</div>
          <div>НДС: {p.vatRate}% ({p.vatIncluded ? "включён" : "сверху"})</div>
          <div>Назначение: {p.paymentPurpose ?? "—"}</div>
        </div>
        <div className="text-xs">
          <div className="font-medium">Позиции ({p.items.length}):</div>
          {p.items.map((it, idx) => (
            <div key={idx} className="ml-2">• {it.name} — {it.quantity} {it.unit} × {formatAmount(it.price)} = {formatAmount(it.quantity * it.price)} ₽</div>
          ))}
        </div>
        <div className="text-sm">Итого (с НДС): <span className="font-semibold font-mono">{formatAmount(totals, { withCurrency: true })}</span></div>
        {missing.length > 0 ? (
          <div className="text-xs text-amber-700">
            ⚠ AI не смог заполнить: {missing.join(", ")}. Откройте «Счета» → «Создать», чтобы дозаполнить вручную.
          </div>
        ) : null}
        <div className="flex gap-2">
          <Button size="sm" onClick={onApply} disabled={applying || missing.includes("organizationId") || (missing.includes("counterpartyId") && !p.counterpartyInn)}>
            {applying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Создать
          </Button>
          <Button size="sm" variant="outline" onClick={onReject}>
            <X className="h-3.5 w-3.5" /> Отклонить
          </Button>
        </div>
      </div>
    );
  }

  if (action.type === "find_overdue_invoices") {
    return (
      <div className="rounded-md border p-3 bg-muted/30 space-y-2 mt-2">
        <div className="text-xs font-semibold flex items-center gap-1">
          <Search className="h-3.5 w-3.5" /> Поиск просроченных счетов
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={onApply} disabled={applying}>
            {applying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Выполнить
          </Button>
          <Button size="sm" variant="outline" onClick={onReject}><X className="h-3.5 w-3.5" /> Отклонить</Button>
        </div>
      </div>
    );
  }
  return null;
}

function ResultBlock({ action, result }: { action: AiAction | undefined; result: unknown }) {
  if (!action || !result) return null;
  if (action.type === "find_overdue_invoices") {
    const r = result as { count: number; invoices: Array<{ id: string; number: string; counterparty: string; dueDate: string; total: number; status: string }> };
    return (
      <div className="rounded-md border-2 border-emerald-600 p-3 bg-emerald-50 mt-2 space-y-1">
        <div className="text-sm font-semibold">Найдено просроченных счетов: {r.count}</div>
        {r.invoices.length === 0 ? (
          <div className="text-sm text-muted-foreground">Нет просроченных счетов 🎉</div>
        ) : (
          <ul className="text-sm space-y-0.5">
            {r.invoices.map((i) => (
              <li key={i.id}>• <span className="font-mono">{i.number}</span> — {i.counterparty} (до {formatDate(i.dueDate)}, {formatAmount(i.total)} ₽)</li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  if (action.type === "create_invoice") {
    const r = result as { id: string; number: string; total: number };
    return (
      <div className="rounded-md border-2 border-emerald-600 p-3 bg-emerald-50 mt-2 text-sm">
        ✓ Создан счёт <span className="font-mono font-medium">{r.number}</span> на сумму {formatAmount(r.total, { withCurrency: true })}.
      </div>
    );
  }
  return null;
}
