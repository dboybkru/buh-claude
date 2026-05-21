import { useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileSignature, Plus, Receipt, Wallet, BookCheck, FileCheck } from "lucide-react";

import { api } from "@/lib/api";
import { formatAmount, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { PaymentDialog } from "@/pages/Payments";

interface StatementInvoice { id: string; number: string; date: string; dueDate: string | null; status: string; total: number; paid: number; balance: number; organization?: { id: string; name: string } | null }
interface StatementPayment { id: string; date: string; amount: number; direction: "IN" | "OUT"; method: string; reference: string | null; purpose: string | null; organization?: { id: string; name: string } | null; allocations: Array<{ invoiceId: string; invoiceNumber: string; amount: number }>; unallocatedAmount: number }
interface StatementContract { id: string; number: string; date: string; expiryDate: string | null; amount: number | null; currency: string; status: string }
interface StatementAct { id: string; number: string; date: string; total: number; status: string; invoiceId: string | null }
interface Statement {
  counterparty: {
    id: string; type: string; name: string; fullName: string | null;
    inn: string; kpp: string | null; ogrn: string | null;
    legalAddress: string | null; actualAddress: string | null;
    managementName: string | null; managementPos: string | null;
    email: string | null; phone: string | null; website: string | null;
    isActive: boolean; notes: string | null;
  };
  totals: { invoiced: number; paid: number; allocated: number; unallocatedAdvance: number; debt: number; overdueDebt: number };
  invoices: StatementInvoice[];
  payments: StatementPayment[];
  contracts: StatementContract[];
  acts: StatementAct[];
}

export function CounterpartyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);

  const statement = useQuery({
    queryKey: ["counterparty-statement", id],
    queryFn: async () => (await api.get<Statement>(`/counterparties/${id}/statement`)).data,
    enabled: !!id,
  });

  if (!id) return null;
  if (statement.isLoading) return <div className="text-muted-foreground">Загрузка...</div>;
  if (statement.isError || !statement.data) {
    return (
      <div className="space-y-2">
        <Button variant="ghost" size="sm" onClick={() => navigate("/counterparties")}><ArrowLeft className="h-4 w-4" /> К списку</Button>
        <div className="text-destructive">Не удалось загрузить выписку контрагента.</div>
      </div>
    );
  }

  const s = statement.data;
  const cp = s.counterparty;
  const t = s.totals;

  const debtColor = t.debt > 0 ? "text-amber-700" : t.debt < 0 ? "text-blue-700" : "text-muted-foreground";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate("/counterparties")}>
          <ArrowLeft className="h-4 w-4" /> К списку
        </Button>
        <div>
          <h1 className="text-2xl font-bold">{cp.name}</h1>
          <div className="text-sm text-muted-foreground font-mono">
            ИНН {cp.inn}{cp.kpp ? ` / КПП ${cp.kpp}` : ""}{cp.ogrn ? ` / ОГРН ${cp.ogrn}` : ""}
          </div>
        </div>
        {!cp.isActive ? <Badge variant="secondary">архив</Badge> : null}
      </div>

      {/* Быстрые действия */}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => navigate(`/invoices/new?counterpartyId=${cp.id}`)}>
          <Receipt className="h-4 w-4" /> Создать счёт
        </Button>
        <Button size="sm" variant="outline" onClick={() => navigate(`/contracts?counterpartyId=${cp.id}&new=1`)}>
          <FileSignature className="h-4 w-4" /> Создать договор
        </Button>
        <Button size="sm" variant="outline" onClick={() => setPaymentDialogOpen(true)}>
          <Wallet className="h-4 w-4" /> Внести платёж
        </Button>
        <Button size="sm" variant="outline" onClick={() => navigate(`/reconciliations?counterpartyId=${cp.id}&new=1`)}>
          <BookCheck className="h-4 w-4" /> Акт сверки
        </Button>
      </div>

      {/* Баланс */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Баланс</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <Stat label="Выставлено" value={t.invoiced} />
            <Stat label="Поступило" value={t.paid} positive />
            <Stat label="Распределено" value={t.allocated} muted />
            <Stat label="Аванс" value={t.unallocatedAdvance} color={t.unallocatedAdvance > 0 ? "text-blue-700" : "text-muted-foreground"} />
            <Stat label="Долг" value={t.debt} color={debtColor} emphasize />
            <Stat label="Просрочено" value={t.overdueDebt} color={t.overdueDebt > 0 ? "text-red-700" : "text-muted-foreground"} />
          </div>
          {t.unallocatedAdvance > 0 ? (
            <div className="mt-3 text-xs text-muted-foreground">
              Нераспределённый аванс — платежи от контрагента, не привязанные к счетам.
              Зайдите в платёж и распределите его на конкретные счета.
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Реквизиты */}
      <Card>
        <CardHeader><CardTitle className="text-base">Реквизиты</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {cp.fullName ? <Row label="Полное наименование" value={cp.fullName} /> : null}
          {cp.legalAddress ? <Row label="Юридический адрес" value={cp.legalAddress} /> : null}
          {cp.actualAddress ? <Row label="Фактический адрес" value={cp.actualAddress} /> : null}
          {cp.managementName ? <Row label="Руководитель" value={`${cp.managementName}${cp.managementPos ? `, ${cp.managementPos}` : ""}`} /> : null}
          {cp.email ? <Row label="Email" value={cp.email} /> : null}
          {cp.phone ? <Row label="Телефон" value={cp.phone} /> : null}
          {cp.website ? <Row label="Сайт" value={cp.website} /> : null}
          {cp.notes ? <Row label="Заметки" value={cp.notes} /> : null}
        </CardContent>
      </Card>

      {/* Списки */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base flex items-center gap-2"><Receipt className="h-4 w-4" /> Счета ({s.invoices.length})</CardTitle>
          <Button size="sm" variant="ghost" onClick={() => navigate(`/invoices/new?counterpartyId=${cp.id}`)}>
            <Plus className="h-4 w-4" /> Новый
          </Button>
        </CardHeader>
        <CardContent>
          {s.invoices.length === 0 ? <Empty>Счетов нет.</Empty> : (
            <MiniTable
              cols={["№", "Дата", "Срок", "Статус", "Сумма", "Оплачено", "Остаток"]}
              rows={s.invoices.map((i) => ({
                key: i.id,
                href: `/invoices/${i.id}`,
                cells: [
                  <span className="font-mono">{i.number}</span>,
                  <span className="text-muted-foreground">{formatDate(i.date)}</span>,
                  <span className="text-muted-foreground">{i.dueDate ? formatDate(i.dueDate) : "—"}</span>,
                  <Badge variant="outline">{i.status}</Badge>,
                  <span className="font-mono">{formatAmount(i.total)}</span>,
                  <span className="font-mono text-emerald-700">{i.paid > 0 ? formatAmount(i.paid) : "—"}</span>,
                  <span className={`font-mono ${i.balance > 0 ? "text-amber-700" : ""}`}>{i.balance > 0 ? formatAmount(i.balance) : "—"}</span>,
                ],
                align: ["left", "left", "left", "left", "right", "right", "right"],
              }))}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Wallet className="h-4 w-4" /> Платежи ({s.payments.length})</CardTitle></CardHeader>
        <CardContent>
          {s.payments.length === 0 ? <Empty>Платежей нет.</Empty> : (
            <MiniTable
              cols={["Дата", "Направление", "Сумма", "Распределение", "Аванс", "Назначение"]}
              rows={s.payments.map((p) => ({
                key: p.id,
                cells: [
                  <span className="text-muted-foreground">{formatDate(p.date)}</span>,
                  <Badge variant={p.direction === "IN" ? "success" : "destructive"}>{p.direction === "IN" ? "Поступление" : "Расход"}</Badge>,
                  <span className={`font-mono ${p.direction === "IN" ? "text-emerald-700" : "text-red-700"}`}>{formatAmount(p.amount)}</span>,
                  <span className="text-xs">{p.allocations.length === 0 ? "—" : p.allocations.length === 1 ? p.allocations[0]!.invoiceNumber : `${p.allocations.length} счёта`}</span>,
                  p.unallocatedAmount > 0 ? <Badge variant="secondary">{formatAmount(p.unallocatedAmount)}</Badge> : <span className="text-muted-foreground text-xs">—</span>,
                  <span className="text-xs text-muted-foreground truncate max-w-md inline-block">{p.purpose ?? "—"}</span>,
                ],
                align: ["left", "left", "right", "left", "left", "left"],
              }))}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><FileCheck className="h-4 w-4" /> Акты ({s.acts.length})</CardTitle></CardHeader>
        <CardContent>
          {s.acts.length === 0 ? <Empty>Актов нет.</Empty> : (
            <MiniTable
              cols={["№", "Дата", "Статус", "Сумма", "На основании"]}
              rows={s.acts.map((a) => ({
                key: a.id,
                href: `/acts/${a.id}`,
                cells: [
                  <span className="font-mono">{a.number}</span>,
                  <span className="text-muted-foreground">{formatDate(a.date)}</span>,
                  <Badge variant="outline">{a.status}</Badge>,
                  <span className="font-mono">{formatAmount(a.total)}</span>,
                  a.invoiceId ? <Link to={`/invoices/${a.invoiceId}`} className="text-xs underline text-muted-foreground hover:text-foreground">счёт</Link> : <span className="text-xs text-muted-foreground">—</span>,
                ],
                align: ["left", "left", "left", "right", "left"],
              }))}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><FileSignature className="h-4 w-4" /> Договоры ({s.contracts.length})</CardTitle></CardHeader>
        <CardContent>
          {s.contracts.length === 0 ? <Empty>Договоров нет.</Empty> : (
            <MiniTable
              cols={["№", "Дата", "Окончание", "Статус", "Сумма"]}
              rows={s.contracts.map((c) => ({
                key: c.id,
                cells: [
                  <span className="font-mono">{c.number}</span>,
                  <span className="text-muted-foreground">{formatDate(c.date)}</span>,
                  <span className="text-muted-foreground">{c.expiryDate ? formatDate(c.expiryDate) : "—"}</span>,
                  <Badge variant="outline">{c.status}</Badge>,
                  <span className="font-mono">{c.amount != null ? `${formatAmount(c.amount)} ${c.currency}` : "—"}</span>,
                ],
                align: ["left", "left", "left", "left", "right"],
              }))}
            />
          )}
        </CardContent>
      </Card>

      <Separator />
      <div className="text-xs text-muted-foreground">
        Расчёт: долг = выставлено − распределённые платежи. Нераспределённый аванс не уменьшает долг,
        пока не привязан к конкретному счёту.
      </div>

      {paymentDialogOpen ? (
        <PaymentDialog
          payment={null}
          onClose={() => setPaymentDialogOpen(false)}
          onSaved={() => {
            setPaymentDialogOpen(false);
            qc.invalidateQueries({ queryKey: ["counterparty-statement", id] });
            qc.invalidateQueries({ queryKey: ["payments"] });
            qc.invalidateQueries({ queryKey: ["invoices"] });
            qc.invalidateQueries({ queryKey: ["dashboard"] });
          }}
        />
      ) : null}
    </div>
  );
}

function Stat({ label, value, color, emphasize, positive, muted }: { label: string; value: number; color?: string; emphasize?: boolean; positive?: boolean; muted?: boolean }) {
  const auto = positive ? "text-emerald-700" : muted ? "text-muted-foreground" : "";
  return (
    <div className="rounded-md border p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`font-mono ${emphasize ? "font-bold text-base" : ""} ${color ?? auto}`}>
        {value === 0 ? "0,00" : formatAmount(value)} ₽
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[180px_1fr] gap-3">
      <div className="text-muted-foreground">{label}</div>
      <div>{value}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-muted-foreground py-2">{children}</div>;
}

function MiniTable({ cols, rows }: { cols: string[]; rows: Array<{ key: string; href?: string; cells: React.ReactNode[]; align?: Array<"left" | "right" | "center"> }> }) {
  const navigate = useNavigate();
  return (
    <div className="border rounded-md overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/40">
          <tr className="text-left">
            {cols.map((c, i) => <th key={i} className="p-2 font-medium">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.key}
              className={`border-b last:border-0 ${r.href ? "cursor-pointer hover:bg-muted/30" : ""}`}
              onClick={r.href ? () => navigate(r.href!) : undefined}
            >
              {r.cells.map((cell, i) => (
                <td key={i} className="p-2" style={{ textAlign: r.align?.[i] ?? "left" }}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
