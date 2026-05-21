import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Edit, ArrowDownToLine, ArrowUpFromLine, Layers, Wand2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { api } from "@/lib/api";
import { handleApiError } from "@/lib/errors";
import { useDebouncedValue } from "@/lib/hooks";
import { DataTable, type Page } from "@/components/DataTable";
import { useUrlSort, sortQueryParam } from "@/lib/use-sort";
import { FormField } from "@/pages/Organizations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatAmount, formatDate } from "@/lib/format";

const METHOD_LABELS: Record<string, string> = {
  BANK: "Банк",
  CASH: "Касса",
  CARD: "Карта",
  OTHER: "Другое",
};

interface PaymentAllocationOut {
  id: string;
  invoiceId: string;
  amount: number;
  invoice: { id: string; number: string; status: string; total: number; paid: number; balance: number };
}

interface Payment {
  id: string;
  organizationId: string;
  counterpartyId: string | null;
  bankAccountId: string | null;
  date: string;
  amount: string;
  direction: "IN" | "OUT";
  method: string;
  purpose: string | null;
  reference: string | null;
  notes: string | null;
  organization?: { id: string; name: string };
  counterparty?: { id: string; name: string; inn: string } | null;
  bankAccount?: { id: string; bankName: string; bik: string } | null;
  allocations?: PaymentAllocationOut[];
  allocatedAmount?: number;
  unallocatedAmount?: number;
}

interface OrgOpt { id: string; name: string; bankAccounts?: Array<{ id: string; bankName: string; bik: string; isDefault: boolean }> }
interface CpOpt { id: string; name: string; inn: string }
interface InvOpt { id: string; number: string; total: string; status: string; counterpartyId: string; organizationId: string; date: string }

const paymentSchema = z.object({
  organizationId: z.string().uuid("Выберите организацию"),
  counterpartyId: z.string().uuid().optional().or(z.literal("")),
  bankAccountId: z.string().uuid().optional().or(z.literal("")),
  // Quick mode: один счёт
  invoiceId: z.string().uuid().optional().or(z.literal("")),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата ГГГГ-ММ-ДД"),
  amount: z.coerce.number().positive("Сумма должна быть > 0"),
  direction: z.enum(["IN", "OUT"]),
  method: z.enum(["BANK", "CASH", "CARD", "OTHER"]),
  purpose: z.string().optional().or(z.literal("")),
  reference: z.string().optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
});
type PaymentForm = z.infer<typeof paymentSchema>;

function blank(): PaymentForm {
  return {
    organizationId: "", counterpartyId: "", bankAccountId: "", invoiceId: "",
    date: new Date().toISOString().slice(0, 10),
    amount: 0, direction: "IN", method: "BANK",
    purpose: "", reference: "", notes: "",
  };
}

export function PaymentsPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const dq = useDebouncedValue(q, 300);
  const [editing, setEditing] = useState<Payment | "new" | null>(null);
  const [sort, setSort] = useUrlSort({ field: "date", dir: "desc" });

  const list = useQuery({
    queryKey: ["payments", { page, q: dq, sort }],
    queryFn: async () =>
      (await api.get<Page<Payment>>("/payments", {
        params: { page, pageSize: 20, q: dq || undefined, sort: sortQueryParam(sort) },
      })).data,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/payments/${id}`),
    onSuccess: () => {
      toast.success("Платёж удалён");
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["counterparty-statement"] });
    },
    onError: (e) => handleApiError(e, "Не удалось удалить"),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Платежи</h1>
        <Button onClick={() => setEditing("new")}>
          <Plus className="h-4 w-4" /> Внести платёж
        </Button>
      </div>

      <DataTable
        rows={list.data?.items ?? []}
        rowKey={(p) => p.id}
        total={list.data?.total}
        page={page} pageSize={20} onPageChange={setPage}
        search={q} onSearchChange={setQ}
        searchPlaceholder="Назначение, № п/п или контрагент"
        loading={list.isLoading}
        empty="Платежей пока нет. Нажмите «Внести платёж»."
        sort={sort}
        onSortChange={(next) => { setSort(next); setPage(1); }}
        columns={[
          {
            key: "date",
            header: "Дата",
            width: "100px",
            sortKey: "date",
            cell: (p) => <span className="text-sm">{formatDate(p.date)}</span>,
          },
          {
            key: "direction",
            header: "",
            width: "40px",
            cell: (p) => p.direction === "IN"
              ? <ArrowDownToLine className="h-4 w-4 text-emerald-600" aria-label="Поступление" />
              : <ArrowUpFromLine className="h-4 w-4 text-red-600" aria-label="Расход" />,
          },
          {
            key: "cp",
            header: "Контрагент",
            cell: (p) => p.counterparty ? (
              <div>
                <div>{p.counterparty.name}</div>
                <div className="text-xs text-muted-foreground">{p.counterparty.inn}</div>
              </div>
            ) : <span className="text-muted-foreground text-sm">—</span>,
          },
          {
            key: "purpose",
            header: "Назначение",
            cell: (p) => (
              <div>
                <div className="truncate max-w-md text-sm">{p.purpose ?? "—"}</div>
                {renderAllocationsSummary(p)}
              </div>
            ),
          },
          {
            key: "method",
            header: "Способ",
            width: "80px",
            cell: (p) => <Badge variant="outline">{METHOD_LABELS[p.method] ?? p.method}</Badge>,
          },
          {
            key: "amount",
            header: "Сумма",
            width: "140px",
            align: "right",
            sortKey: "amount",
            cell: (p) => (
              <span className={`font-mono font-medium ${p.direction === "IN" ? "text-emerald-700" : "text-red-700"}`}>
                {p.direction === "IN" ? "+" : "−"} {formatAmount(p.amount)} ₽
              </span>
            ),
          },
          {
            key: "actions",
            header: "",
            width: "100px",
            align: "right",
            cell: (p) => (
              <div className="flex gap-1 justify-end">
                <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); setEditing(p); }} aria-label="Редактировать">
                  <Edit className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); if (confirm("Удалить платёж?")) remove.mutate(p.id); }} aria-label="Удалить">
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ),
          },
        ]}
        onRowClick={(p) => setEditing(p)}
      />

      {editing ? (
        <PaymentDialog
          payment={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            qc.invalidateQueries({ queryKey: ["payments"] });
            qc.invalidateQueries({ queryKey: ["invoices"] });
            qc.invalidateQueries({ queryKey: ["dashboard"] });
            qc.invalidateQueries({ queryKey: ["counterparty-statement"] });
          }}
        />
      ) : null}
    </div>
  );
}

function renderAllocationsSummary(p: Payment) {
  const allocs = p.allocations ?? [];
  const unalloc = p.unallocatedAmount ?? 0;
  if (allocs.length === 0 && unalloc <= 0) return null;
  return (
    <div className="text-xs text-muted-foreground flex flex-wrap gap-1 mt-0.5">
      {allocs.length === 1 ? (
        <span>→ {allocs[0]!.invoice.number}</span>
      ) : allocs.length > 1 ? (
        <span className="inline-flex items-center gap-1">
          <Layers className="h-3 w-3" /> {allocs.length} счёт{allocs.length === 2 ? "а" : allocs.length > 4 ? "ов" : "а"}
        </span>
      ) : null}
      {unalloc > 0 ? <Badge variant="secondary" className="h-5">Аванс {formatAmount(unalloc)} ₽</Badge> : null}
    </div>
  );
}

export function PaymentDialog({
  payment,
  presetInvoiceId,
  onClose,
  onSaved,
}: {
  payment: Payment | null;
  presetInvoiceId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !payment;
  const orgs = useQuery({ queryKey: ["orgs-opts"], queryFn: async () => (await api.get<{ items: OrgOpt[] }>("/organizations", { params: { pageSize: 200 } })).data.items });
  const cps = useQuery({ queryKey: ["cps-opts"], queryFn: async () => (await api.get<{ items: CpOpt[] }>("/counterparties", { params: { pageSize: 200 } })).data.items });
  const invoices = useQuery({
    queryKey: ["invoices-opts"],
    queryFn: async () => (await api.get<{ items: InvOpt[] }>("/invoices", { params: { pageSize: 500 } })).data.items,
  });

  const presetInvoice = invoices.data?.find((i) => i.id === presetInvoiceId);

  // Если у платежа уже несколько аллокаций — режим distribute, иначе single
  const initialMode: "single" | "distribute" =
    payment && (payment.allocations?.length ?? 0) > 1 ? "distribute" : "single";
  const [mode, setMode] = useState<"single" | "distribute">(initialMode);

  // allocations при distribute: map invoiceId -> amount (строкой для свободного ввода)
  const [allocAmounts, setAllocAmounts] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    if (payment?.allocations) {
      for (const a of payment.allocations) init[a.invoiceId] = String(a.amount);
    }
    return init;
  });

  const form = useForm<PaymentForm>({
    resolver: zodResolver(paymentSchema),
    defaultValues: payment
      ? {
          organizationId: payment.organizationId,
          counterpartyId: payment.counterpartyId ?? "",
          bankAccountId: payment.bankAccountId ?? "",
          invoiceId: (payment.allocations?.length ?? 0) === 1 ? (payment.allocations?.[0]?.invoiceId ?? "") : "",
          date: payment.date.slice(0, 10),
          amount: parseFloat(payment.amount),
          direction: payment.direction,
          method: payment.method as PaymentForm["method"],
          purpose: payment.purpose ?? "",
          reference: payment.reference ?? "",
          notes: payment.notes ?? "",
        }
      : presetInvoice
        ? {
            ...blank(),
            invoiceId: presetInvoice.id,
            counterpartyId: presetInvoice.counterpartyId,
            organizationId: presetInvoice.organizationId,
            amount: parseFloat(presetInvoice.total),
          }
        : blank(),
  });

  const orgId = form.watch("organizationId");
  const cpId = form.watch("counterpartyId");
  const totalAmount = Number(form.watch("amount")) || 0;

  // Кандидаты для distribute: неоплаченные счета выбранного контрагента и организации
  const candidateInvoices = useMemo(() => {
    if (!invoices.data) return [] as InvOpt[];
    return invoices.data
      .filter((i) => i.status !== "PAID" && i.status !== "CANCELLED")
      .filter((i) => !orgId || i.organizationId === orgId)
      .filter((i) => !cpId || i.counterpartyId === cpId)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }, [invoices.data, orgId, cpId]);

  const allocatedSum = useMemo(() => {
    let s = 0;
    for (const inv of candidateInvoices) {
      const v = parseFloat(allocAmounts[inv.id] ?? "");
      if (isFinite(v) && v > 0) s += v;
    }
    return Math.round(s * 100) / 100;
  }, [allocAmounts, candidateInvoices]);

  const unallocated = Math.round((totalAmount - allocatedSum) * 100) / 100;

  // Если при переключении контрагента/организации в режиме distribute счёт исчез из кандидатов — снимаем для него аллокацию
  useEffect(() => {
    if (mode !== "distribute") return;
    const visible = new Set(candidateInvoices.map((c) => c.id));
    setAllocAmounts((prev) => {
      const next: Record<string, string> = {};
      for (const k of Object.keys(prev)) if (visible.has(k)) next[k] = prev[k]!;
      return next;
    });
  }, [mode, candidateInvoices]);

  function autoDistribute() {
    if (totalAmount <= 0) {
      toast.error("Сначала укажите сумму платежа");
      return;
    }
    let remaining = totalAmount;
    const next: Record<string, string> = {};
    for (const inv of candidateInvoices) {
      const total = parseFloat(inv.total);
      // НЕ знаем текущий paid через invoice-options endpoint — берём total как остаток.
      // Backend всё равно проверит overpay. Это упрощение для UI.
      const take = Math.min(remaining, total);
      if (take > 0) {
        next[inv.id] = take.toFixed(2);
        remaining = Math.round((remaining - take) * 100) / 100;
        if (remaining <= 0.005) break;
      }
    }
    setAllocAmounts(next);
  }

  async function onSubmit(v: PaymentForm) {
    const payload: Record<string, unknown> = {
      organizationId: v.organizationId,
      counterpartyId: v.counterpartyId || null,
      bankAccountId: v.bankAccountId || null,
      date: v.date,
      amount: v.amount,
      direction: v.direction,
      method: v.method,
      purpose: v.purpose || null,
      reference: v.reference || null,
      notes: v.notes || null,
    };

    if (mode === "single") {
      payload.invoiceId = v.invoiceId || null;
    } else {
      const allocations: Array<{ invoiceId: string; amount: number }> = [];
      for (const inv of candidateInvoices) {
        const a = parseFloat(allocAmounts[inv.id] ?? "");
        if (isFinite(a) && a > 0) allocations.push({ invoiceId: inv.id, amount: a });
      }
      payload.allocations = allocations;
      if (allocations.length > 0 && allocatedSum > totalAmount + 0.005) {
        toast.error("Распределённая сумма больше суммы платежа");
        return;
      }
    }

    try {
      if (isNew) {
        await api.post("/payments", payload);
        toast.success("Платёж сохранён");
      } else {
        await api.patch(`/payments/${payment!.id}`, payload);
        toast.success("Изменения сохранены");
      }
      onSaved();
    } catch (err) {
      handleApiError(err);
    }
  }

  function onOrgChange(orgId: string) {
    form.setValue("organizationId", orgId);
    const o = orgs.data?.find((x) => x.id === orgId);
    const defAcc = o?.bankAccounts?.find((a) => a.isDefault) ?? o?.bankAccounts?.[0];
    if (defAcc) form.setValue("bankAccountId", defAcc.id);
  }

  function onInvoiceChange(invId: string) {
    form.setValue("invoiceId", invId);
    if (!invId) return;
    const inv = invoices.data?.find((i) => i.id === invId);
    if (inv) {
      form.setValue("counterpartyId", inv.counterpartyId);
      form.setValue("organizationId", inv.organizationId);
      if (form.getValues("amount") <= 0) form.setValue("amount", parseFloat(inv.total));
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isNew ? "Новый платёж" : "Редактирование платежа"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Направление">
              <Select value={form.watch("direction")} onValueChange={(v) => form.setValue("direction", v as PaymentForm["direction"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="IN">Поступление</SelectItem>
                  <SelectItem value="OUT">Расход</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Способ">
              <Select value={form.watch("method")} onValueChange={(v) => form.setValue("method", v as PaymentForm["method"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="BANK">Банк</SelectItem>
                  <SelectItem value="CASH">Касса</SelectItem>
                  <SelectItem value="CARD">Карта</SelectItem>
                  <SelectItem value="OTHER">Другое</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
          </div>

          <FormField label="Организация (получатель)" error={form.formState.errors.organizationId?.message}>
            <Select value={form.watch("organizationId")} onValueChange={onOrgChange}>
              <SelectTrigger><SelectValue placeholder="Выберите..." /></SelectTrigger>
              <SelectContent>
                {orgs.data?.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </FormField>

          <FormField label="Контрагент (плательщик)">
            <Select value={form.watch("counterpartyId") || "none"} onValueChange={(v) => form.setValue("counterpartyId", v === "none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— не указан —</SelectItem>
                {cps.data?.map((c) => <SelectItem key={c.id} value={c.id}>{c.name} ({c.inn})</SelectItem>)}
              </SelectContent>
            </Select>
          </FormField>

          <div className="grid grid-cols-3 gap-3">
            <FormField label="Дата" error={form.formState.errors.date?.message}>
              <Input type="date" {...form.register("date")} />
            </FormField>
            <FormField label="Сумма, ₽" error={form.formState.errors.amount?.message}>
              <Input type="number" step="0.01" min="0" {...form.register("amount")} />
            </FormField>
            <FormField label="№ п/п">
              <Input {...form.register("reference")} />
            </FormField>
          </div>

          <FormField label="Назначение платежа">
            <Textarea rows={2} {...form.register("purpose")} placeholder="Оплата по счёту № ..." />
          </FormField>

          {/* Распределение */}
          {form.watch("direction") === "IN" ? (
            <div className="rounded-md border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">Распределение по счетам</div>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant={mode === "single" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setMode("single")}
                  >
                    Один счёт
                  </Button>
                  <Button
                    type="button"
                    variant={mode === "distribute" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setMode("distribute")}
                  >
                    Несколько счетов
                  </Button>
                </div>
              </div>

              {mode === "single" ? (
                <FormField label="Счёт (закрывается полностью на сумму платежа)">
                  <Select value={form.watch("invoiceId") || "none"} onValueChange={(v) => onInvoiceChange(v === "none" ? "" : v)}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— без привязки (аванс) —</SelectItem>
                      {candidateInvoices.map((i) => (
                        <SelectItem key={i.id} value={i.id}>
                          {i.number} — {formatAmount(i.total)} ₽ ({i.status})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <Button type="button" variant="outline" size="sm" onClick={autoDistribute}>
                      <Wand2 className="h-3 w-3" /> Распределить автоматически
                    </Button>
                    <div className="flex gap-3 font-mono">
                      <span className="text-muted-foreground">Платёж: <b className="text-foreground">{formatAmount(totalAmount)} ₽</b></span>
                      <span className="text-muted-foreground">Распределено: <b className="text-foreground">{formatAmount(allocatedSum)} ₽</b></span>
                      <span className={unallocated > 0 ? "text-blue-700" : unallocated < 0 ? "text-red-700" : "text-muted-foreground"}>
                        {unallocated > 0 ? `Аванс: ${formatAmount(unallocated)} ₽` : unallocated < 0 ? `Превышение: ${formatAmount(-unallocated)} ₽` : "0,00 ₽"}
                      </span>
                    </div>
                  </div>
                  {candidateInvoices.length === 0 ? (
                    <div className="text-xs text-muted-foreground py-2">
                      Нет неоплаченных счетов выбранного контрагента и организации.
                    </div>
                  ) : (
                    <div className="border rounded-md max-h-72 overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/40 sticky top-0">
                          <tr className="text-left">
                            <th className="p-2 w-28">№</th>
                            <th className="p-2 w-24">Дата</th>
                            <th className="p-2 text-right w-28">Сумма счёта</th>
                            <th className="p-2 w-24">Статус</th>
                            <th className="p-2 text-right w-36">К распределению</th>
                          </tr>
                        </thead>
                        <tbody>
                          {candidateInvoices.map((i) => (
                            <tr key={i.id} className="border-b last:border-0">
                              <td className="p-2 font-mono">{i.number}</td>
                              <td className="p-2 text-muted-foreground">{formatDate(i.date)}</td>
                              <td className="p-2 text-right font-mono">{formatAmount(i.total)}</td>
                              <td className="p-2"><Badge variant="outline">{i.status}</Badge></td>
                              <td className="p-2 text-right">
                                <Input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  className="text-right font-mono h-8"
                                  value={allocAmounts[i.id] ?? ""}
                                  onChange={(e) => setAllocAmounts((prev) => ({ ...prev, [i.id]: e.target.value }))}
                                  placeholder="0,00"
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : null}

          <FormField label="Заметки">
            <Textarea rows={2} {...form.register("notes")} />
          </FormField>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Отмена</Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? "Сохранение..." : "Сохранить"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
