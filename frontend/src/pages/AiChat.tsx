import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bot, Send, Loader2, Check, X, FileText, Users, AlertTriangle, FileCheck, FileSignature, BarChart3 } from "lucide-react";
import { api } from "@/lib/api";
import { handleApiError } from "@/lib/errors";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

/* ---------- types ---------- */

type ActionType =
  | "create_counterparty"
  | "create_invoice"
  | "create_act_from_invoice"
  | "create_contract"
  | "analyze_debt";

type TargetType = "counterparty" | "invoice" | "act" | "contract" | "analysis";

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

interface CreateActFromInvoicePayload {
  organizationId: string;
  invoiceId: string;
  date?: string | null;
  note?: string | null;
}

interface CreateContractPayload {
  organizationId: string;
  counterpartyId: string;
  templateId?: string | null;
  number?: string | null;
  date?: string | null;
  subject: string;
  amount?: number | null;
  validUntil?: string | null;
  terms?: string | null;
}

interface AnalyzeDebtPayload {
  organizationId: string;
  counterpartyId?: string | null;
  asOfDate?: string | null;
}

interface DebtAnalysisCounterparty {
  counterpartyId: string;
  name: string;
  debt: number;
  overdueDebt: number;
  unpaidInvoicesCount: number;
  oldestOverdueDate: string | null;
}

interface DebtAnalysisResult {
  totalDebt: number;
  overdueDebt: number;
  counterparties: DebtAnalysisCounterparty[];
  recommendations: string[];
  asOfDate: string;
}

type Action =
  | { id: string; type: "create_counterparty"; payload: CreateCounterpartyPayload }
  | { id: string; type: "create_invoice"; payload: CreateInvoicePayload }
  | { id: string; type: "create_act_from_invoice"; payload: CreateActFromInvoicePayload }
  | { id: string; type: "create_contract"; payload: CreateContractPayload }
  | { id: string; type: "analyze_debt"; payload: AnalyzeDebtPayload };

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

interface AppliedActionResult {
  id: string;
  actionType: ActionType;
  targetType: TargetType;
  targetId: string | null;
  result?: DebtAnalysisResult;
}

interface ConfirmResult {
  applied: AppliedActionResult[];
  skipped: Array<{ id: string; actionType: ActionType; reason: string }>;
  errors: Array<{ id: string; actionType: ActionType; error: string }>;
}

interface OrgOpt { id: string; name: string; inn: string }

interface AuditLogEntry {
  id: string;
  createdAt: string;
  actionType: ActionType;
  targetType: TargetType;
  targetId: string | null;
  organizationId: string | null;
  actionPlan: { id: string; message: string; status: string } | null;
}

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

  const auditLog = useQuery({
    queryKey: ["ai-audit-log", organizationId],
    queryFn: async () => (await api.get<{ items: AuditLogEntry[] }>("/ai/audit-log", {
      params: { organizationId: organizationId || undefined, limit: 50 },
    })).data.items,
    enabled: !!organizationId,
  });

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
      // Инвалидация связанных запросов (Sprint 6A + 6B)
      qc.invalidateQueries({ queryKey: ["counterparties"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["acts"] });
      qc.invalidateQueries({ queryKey: ["contracts"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["cps-opts"] });
      qc.invalidateQueries({ queryKey: ["ai-audit-log"] });
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
              "Создай акт по последнему счёту",
              "Создай договор на оказание консультационных услуг",
              "Покажи должников",
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

      {currentPlan && (!confirmResult || confirmResult.errors.length > 0) ? (
        <ActionPlanCard
          plan={currentPlan.plan}
          confirming={confirming}
          disableConfirm={hasCriticalMissing || !hasActions || !!confirmResult}
          onConfirm={confirm}
          onReject={reject}
        />
      ) : null}

      {confirmResult ? <ConfirmResultCard result={confirmResult} onClose={reject} /> : null}

      <AuditLogCard items={auditLog.data ?? []} loading={auditLog.isLoading} />

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

const READ_ONLY_ACTION_TYPES: ActionType[] = ["analyze_debt"];

function isReadOnly(t: ActionType): boolean {
  return READ_ONLY_ACTION_TYPES.includes(t);
}

interface ConfidenceLevel {
  label: string;
  variant: "default" | "secondary" | "warning";
}

function confidenceLevel(c: number): ConfidenceLevel {
  if (c >= 0.85) return { label: `высокий ${c.toFixed(2)}`, variant: "default" };
  if (c >= 0.6) return { label: `средний ${c.toFixed(2)}`, variant: "secondary" };
  return { label: `низкий ${c.toFixed(2)} — проверьте план внимательно`, variant: "warning" };
}

function ActionPlanCard({
  plan, confirming, disableConfirm, onConfirm, onReject,
}: {
  plan: ActionPlan;
  confirming: boolean;
  disableConfirm: boolean;
  onConfirm: () => void;
  onReject: () => void;
}) {
  const conf = confidenceLevel(plan.confidence);
  const allReadOnly = plan.actions.length > 0 && plan.actions.every((a) => isReadOnly(a.type));
  const hasWriteActions = plan.actions.some((a) => !isReadOnly(a.type));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center justify-between flex-wrap gap-2">
          <span className="flex items-center gap-2">
            <Bot className="h-4 w-4" /> AI предлагает план
          </span>
          <div className="flex gap-2 flex-wrap">
            <Badge variant={conf.variant} title="Уровень уверенности модели">{conf.label}</Badge>
            {hasWriteActions ? (
              <Badge variant="warning" title="Действия изменят данные после подтверждения">
                Создаст данные после подтверждения
              </Badge>
            ) : allReadOnly ? (
              <Badge variant="secondary" title="Только анализ — данные не изменяются">
                Только анализ, данные не изменяются
              </Badge>
            ) : null}
          </div>
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

        <div className="flex gap-2 flex-wrap">
          <Button size="sm" onClick={onConfirm} disabled={confirming || disableConfirm}>
            {confirming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Подтвердить действия
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
  if (action.type === "create_invoice") {
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
  if (action.type === "create_act_from_invoice") {
    const p = action.payload;
    return (
      <div className="rounded-md border p-3 bg-muted/30 text-sm">
        <div className="font-semibold flex items-center gap-1 text-xs mb-1">
          <FileCheck className="h-3.5 w-3.5" /> Создание акта на основании счёта
        </div>
        <div>Счёт: <span className="font-mono">{p.invoiceId}</span></div>
        <div>Дата акта: <span className="font-mono">{p.date ?? "сегодня"}</span></div>
        {p.note ? <div className="text-xs text-muted-foreground mt-1">Примечание: {p.note}</div> : null}
        <div className="text-xs text-muted-foreground mt-1">Позиции и суммы будут скопированы из счёта.</div>
      </div>
    );
  }
  if (action.type === "create_contract") {
    const p = action.payload;
    return (
      <div className="rounded-md border p-3 bg-muted/30 text-sm">
        <div className="font-semibold flex items-center gap-1 text-xs mb-1">
          <FileSignature className="h-3.5 w-3.5" /> Создание договора
        </div>
        <div>Контрагент: <span className="font-mono">{p.counterpartyId}</span></div>
        <div>Предмет: <span className="font-medium">{p.subject}</span></div>
        {p.amount != null ? <div>Сумма: <span className="font-mono">{p.amount.toFixed(2)} ₽</span></div> : null}
        {p.date ? <div>Дата: <span className="font-mono">{p.date}</span></div> : null}
        {p.validUntil ? <div>Срок действия до: <span className="font-mono">{p.validUntil}</span></div> : null}
        {p.templateId ? <div>Шаблон: <span className="font-mono text-xs">{p.templateId}</span></div> : <div className="text-xs text-muted-foreground">Шаблон не задан — будет использован default или поле «Описание»</div>}
        {p.number ? <div>Номер: <span className="font-mono">{p.number}</span></div> : <div className="text-xs text-muted-foreground">Номер будет сгенерирован автоматически</div>}
        {p.terms ? <div className="text-xs text-muted-foreground mt-1">Условия: {p.terms}</div> : null}
      </div>
    );
  }
  // analyze_debt
  const p = action.payload;
  return (
    <div className="rounded-md border p-3 bg-muted/30 text-sm">
      <div className="font-semibold flex items-center gap-1 text-xs mb-1">
        <BarChart3 className="h-3.5 w-3.5" /> Анализ задолженности
        <Badge variant="secondary" className="ml-2 text-[10px]">не изменяет данные</Badge>
      </div>
      <div>
        Область: {p.counterpartyId ? <>контрагент <span className="font-mono">{p.counterpartyId}</span></> : "вся организация (топ должников)"}
      </div>
      {p.asOfDate ? <div>На дату: <span className="font-mono">{p.asOfDate}</span></div> : null}
    </div>
  );
}

function ConfirmResultCard({ result, onClose }: { result: ConfirmResult; onClose: () => void }) {
  const analysis = result.applied.find((a) => a.actionType === "analyze_debt" && a.result)?.result;
  return (
    <Card className={result.errors.length > 0 ? "border-destructive" : "border-emerald-600"}>
      <CardHeader>
        <CardTitle className="text-base">Результат применения</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {result.applied.length > 0 ? (
          <div>
            <div className="font-semibold text-emerald-700">✓ Применено ({result.applied.length}):</div>
            <ul className="ml-3 text-xs space-y-0.5">
              {result.applied.map((a) => (
                <li key={a.id}>
                  • {labelFor(a.actionType)}
                  {a.targetId ? (
                    <>
                      {" → "}
                      <Link to={routeFor(a.targetType, a.targetId)} className="underline underline-offset-2 hover:no-underline">
                        Открыть {labelForTarget(a.targetType)}
                      </Link>
                      <span className="text-muted-foreground"> (id <span className="font-mono">{a.targetId.slice(0, 8)}…</span>)</span>
                    </>
                  ) : (
                    <> → <span className="text-muted-foreground">read-only (без созданной сущности)</span></>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {analysis ? <DebtAnalysisBlock analysis={analysis} /> : null}
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
  switch (t) {
    case "create_counterparty": return "Создание контрагента";
    case "create_invoice": return "Создание счёта";
    case "create_act_from_invoice": return "Создание акта по счёту";
    case "create_contract": return "Создание договора";
    case "analyze_debt": return "Анализ задолженности";
  }
}

function AuditLogCard({ items, loading }: { items: AuditLogEntry[]; loading: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">История AI-действий</CardTitle>
        <CardDescription>
          Подтверждённые действия по выбранной организации. Read-only: вы видите только свои данные.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Загрузка истории...
          </div>
        ) : items.length === 0 ? (
          <div className="text-sm text-muted-foreground">Истории нет — выберите организацию и подтвердите хотя бы одно действие.</div>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {items.map((row) => (
              <li key={row.id} className="border-b last:border-0 pb-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-muted-foreground font-mono">
                    {new Date(row.createdAt).toLocaleString("ru-RU")}
                  </span>
                  <Badge variant="outline">{labelFor(row.actionType)}</Badge>
                  {row.targetId ? (
                    <Link to={routeFor(row.targetType, row.targetId)} className="text-xs underline underline-offset-2">
                      открыть {labelForTarget(row.targetType)}
                    </Link>
                  ) : (
                    <Badge variant="secondary" className="text-[10px]">read-only</Badge>
                  )}
                </div>
                {row.actionPlan?.message ? (
                  <div className="text-xs text-muted-foreground mt-0.5">«{row.actionPlan.message}»</div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function labelForTarget(t: TargetType): string {
  switch (t) {
    case "counterparty": return "контрагента";
    case "invoice": return "счёт";
    case "act": return "акт";
    case "contract": return "договор";
    case "analysis": return "результат";
  }
}

/** Возвращает URL на странице фронта для созданной сущности. */
function routeFor(t: TargetType, id: string): string {
  switch (t) {
    case "counterparty": return `/counterparties/${id}`;
    case "invoice": return `/invoices/${id}`;
    case "act": return `/acts/${id}`;
    case "contract": return `/contracts?focus=${id}`;
    case "analysis": return "/ai";
  }
}

function DebtAnalysisBlock({ analysis }: { analysis: DebtAnalysisResult }) {
  return (
    <div className="rounded-md border bg-sky-50 dark:bg-sky-950/30 p-3 mt-2">
      <div className="text-sm font-semibold mb-2 flex items-center gap-2">
        <BarChart3 className="h-4 w-4" /> Задолженность на {analysis.asOfDate}
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs mb-2">
        <div>
          <div className="text-muted-foreground">Общий долг</div>
          <div className="font-mono font-semibold">{analysis.totalDebt.toFixed(2)} ₽</div>
        </div>
        <div>
          <div className="text-muted-foreground">Просрочено</div>
          <div className={`font-mono font-semibold ${analysis.overdueDebt > 0 ? "text-destructive" : ""}`}>
            {analysis.overdueDebt.toFixed(2)} ₽
          </div>
        </div>
      </div>
      {analysis.counterparties.length > 0 ? (
        <>
          <div className="text-xs font-semibold mt-2 mb-1">Должники ({analysis.counterparties.length}):</div>
          <ul className="space-y-1 text-xs">
            {analysis.counterparties.map((c) => (
              <li key={c.counterpartyId} className="border-b border-sky-200 dark:border-sky-800 pb-1 last:border-0">
                <span className="font-medium">{c.name}</span>
                {" — "}
                <span className="font-mono">{c.debt.toFixed(2)} ₽</span>
                {c.overdueDebt > 0 ? (
                  <span className="text-destructive"> (просрочено {c.overdueDebt.toFixed(2)} ₽ с {c.oldestOverdueDate})</span>
                ) : null}
                <span className="text-muted-foreground"> · {c.unpaidInvoicesCount} счёт(ов)</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="text-xs text-muted-foreground">Должников нет.</div>
      )}
      {analysis.recommendations.length > 0 ? (
        <div className="mt-2 text-xs">
          <div className="font-semibold">Рекомендации:</div>
          <ul className="ml-3">
            {analysis.recommendations.map((r, i) => <li key={i}>• {r}</li>)}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
