import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bot, Send, Loader2, Check, X, FileText, Users, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";
import { handleApiError } from "@/lib/errors";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

/* ---------- types ---------- */

type ActionType = "create_counterparty" | "create_invoice";

interface CreateCounterpartyPayload {
  organizationId: string;
  name: string;
  inn: string;
  kpp?: string | null;
  legalAddress?: string | null;
  phone?: string | null;
  email?: string | null;
}

interface InvoiceItemPayload {
  name: string;
  unit: string;
  quantity: number;
  price: number;
  vatRate: "no_vat" | 0 | 10 | 20 | 22;
}

interface CreateInvoicePayload {
  organizationId: string;
  counterpartyId: string;
  date: string;
  dueDate?: string | null;
  items: InvoiceItemPayload[];
  note?: string | null;
}

type Action =
  | { id: string; type: "create_counterparty"; payload: CreateCounterpartyPayload }
  | { id: string; type: "create_invoice"; payload: CreateInvoicePayload };

interface ActionPlan {
  intent: string;
  summary: string;
  confidence: number;
  missingFields: string[];
  warnings: string[];
  actions: Action[];
}

interface ChatResponse {
  actionPlanId: string | null;
  message?: string;
  actionPlan: ActionPlan | null;
  warnings: string[];
  error?: string;
  raw?: string;
}

interface ConfirmResult {
  applied: Array<{ id: string; actionType: ActionType; targetType: "counterparty" | "invoice"; targetId: string }>;
  skipped: Array<{ id: string; actionType: ActionType; reason: string }>;
  errors: Array<{ id: string; actionType: ActionType; error: string }>;
}

interface OrgOpt { id: string; name: string; inn: string }

/* ---------- page ---------- */

export function AiChatPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [organizationId, setOrganizationId] = useState<string>("");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const [currentPlan, setCurrentPlan] = useState<{ planId: string; plan: ActionPlan; raw?: string } | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [confirmResult, setConfirmResult] = useState<ConfirmResult | null>(null);

  const orgs = useQuery({
    queryKey: ["orgs-opts"],
    queryFn: async () => (await api.get<{ items: OrgOpt[] }>("/organizations", { params: { pageSize: 200 } })).data.items,
  });

  const orgList = orgs.data ?? [];
  // Авто-выбираем первую организацию, если ещё не выбрана
  if (!organizationId && orgList.length > 0 && !orgs.isLoading) {
    setOrganizationId(orgList[0]!.id);
  }

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setCurrentPlan(null);
    setConfirmResult(null);
    setPlanError(null);
    try {
      const r = await api.post<ChatResponse>("/ai/chat", {
        message: text,
        organizationId: organizationId || undefined,
        scope: organizationId ? "organization" : "global",
      });
      const body = r.data;
      if (body.error || !body.actionPlanId || !body.actionPlan) {
        setPlanError(body.error ?? "AI не вернул валидный план");
        return;
      }
      setCurrentPlan({ planId: body.actionPlanId, plan: body.actionPlan, raw: body.raw });
      setInput("");
    } catch (err) {
      handleApiError(err);
    } finally {
      setSending(false);
    }
  }

  async function confirm() {
    if (!currentPlan) return;
    setConfirming(true);
    try {
      const r = await api.post<ConfirmResult>(`/ai/action-plans/${currentPlan.planId}/confirm`, {});
      setConfirmResult(r.data);
      const okCount = r.data.applied.length;
      const errCount = r.data.errors.length;
      if (okCount > 0 && errCount === 0) toast.success(`Применено: ${okCount}`);
      else if (errCount > 0) toast.error(`Применено: ${okCount}, ошибок: ${errCount}`);
      else toast(`Ничего не применено`);
      // Инвалидация связанных запросов
      qc.invalidateQueries({ queryKey: ["counterparties"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["cps-opts"] });
    } catch (err) {
      handleApiError(err);
    } finally {
      setConfirming(false);
    }
  }

  function reject() {
    setCurrentPlan(null);
    setPlanError(null);
    setConfirmResult(null);
  }

  const hasCriticalMissing = !!currentPlan && currentPlan.plan.missingFields.length > 0;
  const hasActions = !!currentPlan && currentPlan.plan.actions.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Bot className="h-6 w-6" /> AI Ассистент
        </h1>
        <Button variant="outline" onClick={() => navigate("/ai/settings")}>Настройки</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Контекст</CardTitle>
          <CardDescription>Выберите организацию — её реквизиты, контрагенты и последние документы передаются AI как контекст. Чужие данные не передаются.</CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={organizationId} onValueChange={setOrganizationId}>
            <SelectTrigger><SelectValue placeholder="Выберите организацию..." /></SelectTrigger>
            <SelectContent>
              {orgList.map((o) => <SelectItem key={o.id} value={o.id}>{o.name} ({o.inn})</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {!currentPlan && !confirmResult && !planError ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">С чего начать?</CardTitle>
            <CardDescription>AI вернёт action plan — вы подтверждаете его явно. AI ничего не пишет в БД без вашего согласия.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {[
              "Создай контрагента ООО Ромашка ИНН 7701234567",
              "Создай счёт для контрагента на услугу консультации 10000 ₽ без НДС",
              "Создай счёт на 50000 рублей за разработку",
            ].map((s) => (
              <Button key={s} variant="outline" className="w-full justify-start" onClick={() => setInput(s)}>
                {s}
              </Button>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {planError ? (
        <Card className="border-destructive">
          <CardContent className="pt-4 text-sm">
            <div className="font-semibold text-destructive flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> AI не смог сформировать корректный план
            </div>
            <div className="mt-1 text-muted-foreground">{planError}</div>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="outline" onClick={reject}>Закрыть</Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {currentPlan && !confirmResult ? (
        <ActionPlanCard
          plan={currentPlan.plan}
          confirming={confirming}
          disableConfirm={hasCriticalMissing || !hasActions}
          onConfirm={confirm}
          onReject={reject}
        />
      ) : null}

      {confirmResult ? <ConfirmResultCard result={confirmResult} onClose={reject} /> : null}

      <form onSubmit={send} className="flex gap-2 sticky bottom-0 bg-background py-3">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Напишите запрос — «создай контрагента ...» или «создай счёт ...»"
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

/* ---------- subcomponents ---------- */

function ActionPlanCard({
  plan, confirming, disableConfirm, onConfirm, onReject,
}: {
  plan: ActionPlan;
  confirming: boolean;
  disableConfirm: boolean;
  onConfirm: () => void;
  onReject: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Bot className="h-4 w-4" /> AI предлагает план
          </span>
          <Badge variant="outline">confidence {plan.confidence.toFixed(2)}</Badge>
        </CardTitle>
        <CardDescription>{plan.summary}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {plan.missingFields.length > 0 ? (
          <div className="rounded-md border bg-yellow-50 dark:bg-yellow-950/30 p-2 text-xs">
            <div className="font-semibold mb-1">Не хватает данных:</div>
            <div className="font-mono">{plan.missingFields.join(", ")}</div>
          </div>
        ) : null}

        {plan.warnings.length > 0 ? (
          <ul className="text-xs space-y-0.5 text-muted-foreground">
            {plan.warnings.map((w, i) => <li key={i}>• {w}</li>)}
          </ul>
        ) : null}

        {plan.actions.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            Action plan не содержит действий — уточните запрос и отправьте ещё раз.
          </div>
        ) : (
          <div className="space-y-2">
            {plan.actions.map((a) => (
              <ActionPreview key={a.id} action={a} />
            ))}
          </div>
        )}

        <Separator />

        <div className="flex gap-2">
          <Button size="sm" onClick={onConfirm} disabled={confirming || disableConfirm}>
            {confirming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Подтвердить
          </Button>
          <Button size="sm" variant="outline" onClick={onReject}>
            <X className="h-3.5 w-3.5" /> Отклонить
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ActionPreview({ action }: { action: Action }) {
  if (action.type === "create_counterparty") {
    const p = action.payload;
    return (
      <div className="rounded-md border p-3 bg-muted/30 text-sm">
        <div className="font-semibold flex items-center gap-1 text-xs mb-1">
          <Users className="h-3.5 w-3.5" /> Создание контрагента
        </div>
        <div>Наименование: <span className="font-medium">{p.name}</span></div>
        <div>ИНН: <span className="font-mono">{p.inn}</span></div>
        {p.kpp ? <div>КПП: <span className="font-mono">{p.kpp}</span></div> : null}
        {p.legalAddress ? <div>Адрес: {p.legalAddress}</div> : null}
        {p.phone ? <div>Телефон: {p.phone}</div> : null}
        {p.email ? <div>Email: {p.email}</div> : null}
      </div>
    );
  }
  const p = action.payload;
  const total = p.items.reduce((s, it) => s + it.quantity * it.price, 0);
  return (
    <div className="rounded-md border p-3 bg-muted/30 text-sm">
      <div className="font-semibold flex items-center gap-1 text-xs mb-1">
        <FileText className="h-3.5 w-3.5" /> Создание счёта
      </div>
      <div>Дата: <span className="font-mono">{p.date}</span> {p.dueDate ? <>, срок оплаты <span className="font-mono">{p.dueDate}</span></> : null}</div>
      <div className="mt-1 font-medium">Позиции ({p.items.length}):</div>
      <ul className="text-xs ml-3 space-y-0.5">
        {p.items.map((it, i) => (
          <li key={i}>
            • {it.name} — {it.quantity} {it.unit} × {it.price} ₽ = {(it.quantity * it.price).toFixed(2)} ₽ (НДС: {it.vatRate === "no_vat" ? "без НДС" : `${it.vatRate}%`})
          </li>
        ))}
      </ul>
      <div className="mt-1">Итого: <span className="font-mono font-semibold">{total.toFixed(2)} ₽</span></div>
      {p.note ? <div className="text-xs text-muted-foreground mt-1">Примечание: {p.note}</div> : null}
    </div>
  );
}

function ConfirmResultCard({ result, onClose }: { result: ConfirmResult; onClose: () => void }) {
  return (
    <Card className={result.errors.length > 0 ? "border-destructive" : "border-emerald-600"}>
      <CardHeader>
        <CardTitle className="text-base">Результат применения</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {result.applied.length > 0 ? (
          <div>
            <div className="font-semibold text-emerald-700">✓ Применено ({result.applied.length}):</div>
            <ul className="ml-3 text-xs">
              {result.applied.map((a) => (
                <li key={a.id}>• {labelFor(a.actionType)} → {a.targetType} id <span className="font-mono">{a.targetId}</span></li>
              ))}
            </ul>
          </div>
        ) : null}
        {result.skipped.length > 0 ? (
          <div>
            <div className="font-semibold text-muted-foreground">⊘ Пропущено ({result.skipped.length}):</div>
            <ul className="ml-3 text-xs">
              {result.skipped.map((s) => <li key={s.id}>• {labelFor(s.actionType)} — {s.reason}</li>)}
            </ul>
          </div>
        ) : null}
        {result.errors.length > 0 ? (
          <div>
            <div className="font-semibold text-destructive">✗ Ошибки ({result.errors.length}):</div>
            <ul className="ml-3 text-xs">
              {result.errors.map((e) => <li key={e.id}>• {labelFor(e.actionType)} — {e.error}</li>)}
            </ul>
          </div>
        ) : null}
        <Button size="sm" variant="outline" onClick={onClose}>Новый запрос</Button>
      </CardContent>
    </Card>
  );
}

function labelFor(t: ActionType): string {
  if (t === "create_counterparty") return "Создание контрагента";
  return "Создание счёта";
}
