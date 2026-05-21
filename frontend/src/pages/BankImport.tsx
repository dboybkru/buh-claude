// Импорт банковской выписки: загрузить файл → preview → подтвердить → отчёт.

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Upload, FileSpreadsheet, Layers, CheckCircle2, AlertTriangle, XCircle, ArrowDownToLine, ArrowUpFromLine, Loader2 } from "lucide-react";

import { api } from "@/lib/api";
import { handleApiError } from "@/lib/errors";
import { formatAmount, formatDate } from "@/lib/format";
import { FormField } from "@/pages/Organizations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

interface OrgOpt { id: string; name: string; bankAccounts?: Array<{ id: string; bankName: string; bik: string }> }
interface CpOpt { id: string; name: string; inn: string }
interface InvOpt { id: string; number: string; total: string; status: string; counterpartyId: string; organizationId: string; date: string }

interface SuggestedAllocation {
  invoiceId: string;
  invoiceNumber: string;
  invoiceTotal: number;
  invoicePaid: number;
  invoiceBalance: number;
  suggestedAmount: number;
  confidence: number;
  reason: string;
}

interface PreviewRow {
  rowNumber: number;
  date: string | null;
  amount: number | null;
  direction: "IN" | "OUT" | null;
  purpose: string | null;
  counterpartyName: string | null;
  counterpartyInn: string | null;
  reference: string | null;
  errors: string[];
  warnings: string[];
  suggestedCounterpartyId: string | null;
  suggestedInvoiceAllocations: SuggestedAllocation[];
  status: "ready" | "needs_review" | "error";
}

interface PreviewResponse {
  importId: string;
  organizationId: string;
  bankAccountId: string | null;
  fileName: string;
  rows: PreviewRow[];
  summary: { totalRows: number; ready: number; needsReview: number; errors: number; totalIncome: number; totalExpense: number };
}

interface ConfirmResponse {
  createdPayments: string[];
  skippedRows: number[];
  errors: Array<{ rowNumber: number; message: string }>;
}

interface EditState {
  action: "import" | "skip";
  counterpartyId: string | null;
  allocations: Array<{ invoiceId: string; amount: string }>;
}

export function BankImportPage() {
  const qc = useQueryClient();
  const [organizationId, setOrganizationId] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [editRows, setEditRows] = useState<Record<number, EditState>>({});
  const [report, setReport] = useState<ConfirmResponse | null>(null);

  const orgs = useQuery({
    queryKey: ["orgs-opts"],
    queryFn: async () => (await api.get<{ items: OrgOpt[] }>("/organizations", { params: { pageSize: 200 } })).data.items,
  });
  const cps = useQuery({
    queryKey: ["cps-opts"],
    queryFn: async () => (await api.get<{ items: CpOpt[] }>("/counterparties", { params: { pageSize: 200 } })).data.items,
  });
  // Кандидаты счетов — для ручного выбора аллокаций
  const invoices = useQuery({
    queryKey: ["invoices-opts"],
    queryFn: async () => (await api.get<{ items: InvOpt[] }>("/invoices", { params: { pageSize: 500 } })).data.items,
  });

  const selectedOrg = orgs.data?.find((o) => o.id === organizationId);

  const previewMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Выберите файл");
      if (!organizationId) throw new Error("Выберите организацию");
      const fd = new FormData();
      fd.append("organizationId", organizationId);
      if (bankAccountId) fd.append("bankAccountId", bankAccountId);
      fd.append("file", file);
      const r = await api.post<PreviewResponse>("/bank-import/preview", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      return r.data;
    },
    onSuccess: (data) => {
      setPreview(data);
      setReport(null);
      // Инициализация редактируемого состояния
      const init: Record<number, EditState> = {};
      for (const r of data.rows) {
        init[r.rowNumber] = {
          action: r.status === "error" ? "skip" : "import",
          counterpartyId: r.suggestedCounterpartyId,
          allocations: r.suggestedInvoiceAllocations.map((a) => ({ invoiceId: a.invoiceId, amount: String(a.suggestedAmount) })),
        };
      }
      setEditRows(init);
      toast.success(`Прочитано ${data.summary.totalRows} строк`);
    },
    onError: (err) => handleApiError(err, "Не удалось обработать файл"),
  });

  const confirmMutation = useMutation({
    mutationFn: async () => {
      if (!preview) throw new Error("Нет preview");
      const rows = preview.rows
        .filter((r) => editRows[r.rowNumber]?.action === "import" && r.status !== "error")
        .map((r) => {
          const e = editRows[r.rowNumber]!;
          return {
            rowNumber: r.rowNumber,
            action: "import" as const,
            counterpartyId: e.counterpartyId,
            bankAccountId: bankAccountId || undefined,
            date: r.date!,
            amount: r.amount!,
            direction: r.direction!,
            purpose: r.purpose,
            reference: r.reference,
            allocations: r.direction === "IN"
              ? e.allocations
                  .map((a) => ({ invoiceId: a.invoiceId, amount: parseFloat(a.amount) }))
                  .filter((a) => isFinite(a.amount) && a.amount > 0)
              : [],
          };
        });

      // Skipped тоже передаём — backend ждёт их для отчёта
      const skipped = preview.rows
        .filter((r) => editRows[r.rowNumber]?.action !== "import" || r.status === "error")
        .map((r) => ({
          rowNumber: r.rowNumber,
          action: "skip" as const,
          date: r.date ?? "2000-01-01",
          amount: r.amount ?? 1,
          direction: r.direction ?? "IN",
        }));

      if (rows.length === 0) throw new Error("Нет строк для импорта");

      const r = await api.post<ConfirmResponse>("/bank-import/confirm", {
        importId: preview.importId,
        rows: [...rows, ...skipped],
      });
      return r.data;
    },
    onSuccess: (data) => {
      setReport(data);
      toast.success(`Создано платежей: ${data.createdPayments.length}`);
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["counterparties"] });
      qc.invalidateQueries({ queryKey: ["counterparty-statement"] });
    },
    onError: (err) => handleApiError(err, "Не удалось импортировать"),
  });

  function reset() {
    setPreview(null);
    setReport(null);
    setEditRows({});
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  const hasErrorRows = useMemo(() => preview?.rows.some((r) => r.status === "error") ?? false, [preview]);
  const importableCount = useMemo(() => {
    if (!preview) return 0;
    return preview.rows.filter((r) => editRows[r.rowNumber]?.action === "import" && r.status !== "error").length;
  }, [preview, editRows]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Импорт банковской выписки</h1>
        {preview ? <Button variant="ghost" onClick={reset}>Загрузить другой файл</Button> : null}
      </div>

      {/* Шаг 1: выбор файла */}
      {!preview ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Загрузить выписку (CSV или XLSX)</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Организация (получатель)">
                <Select value={organizationId} onValueChange={(v) => { setOrganizationId(v); setBankAccountId(""); }}>
                  <SelectTrigger><SelectValue placeholder="Выберите..." /></SelectTrigger>
                  <SelectContent>
                    {orgs.data?.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="Банковский счёт (опционально)">
                <Select value={bankAccountId || "none"} onValueChange={(v) => setBankAccountId(v === "none" ? "" : v)} disabled={!selectedOrg}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— не выбирать —</SelectItem>
                    {selectedOrg?.bankAccounts?.map((ba) => (
                      <SelectItem key={ba.id} value={ba.id}>{ba.bankName} ({ba.bik})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            </div>
            <FormField label="Файл выписки">
              <Input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </FormField>
            <div className="text-xs text-muted-foreground">
              Поддерживаемые колонки: Дата · Сумма (или Приход/Расход) · Контрагент · ИНН · Назначение · Номер документа.
              Формат даты: ГГГГ-ММ-ДД или ДД.ММ.ГГГГ. Пример: <code className="font-mono">examples/bank-statements/sample-bank-statement.csv</code>.
            </div>
            <Button
              onClick={() => previewMutation.mutate()}
              disabled={!file || !organizationId || previewMutation.isPending}
            >
              {previewMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Предпросмотр
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {/* Шаг 2: preview */}
      {preview && !report ? (
        <>
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><FileSpreadsheet className="h-4 w-4" /> {preview.fileName}</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 md:grid-cols-6 gap-3 text-sm">
                <Stat label="Всего" value={preview.summary.totalRows} />
                <Stat label="Готово" value={preview.summary.ready} color="text-emerald-700" />
                <Stat label="Требует проверки" value={preview.summary.needsReview} color="text-amber-700" />
                <Stat label="Ошибки" value={preview.summary.errors} color={preview.summary.errors > 0 ? "text-red-700" : ""} />
                <Stat label="Приход" value={formatAmount(preview.summary.totalIncome)} valueColor="text-emerald-700" />
                <Stat label="Расход" value={formatAmount(preview.summary.totalExpense)} valueColor="text-red-700" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Строки выписки</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="border rounded-md overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 sticky top-0">
                    <tr className="text-left">
                      <th className="p-2 w-12">№</th>
                      <th className="p-2 w-20">Статус</th>
                      <th className="p-2 w-24">Действие</th>
                      <th className="p-2 w-24">Дата</th>
                      <th className="p-2 w-12"></th>
                      <th className="p-2 w-24 text-right">Сумма</th>
                      <th className="p-2 w-44">Контрагент</th>
                      <th className="p-2">Назначение / распределение</th>
                      <th className="p-2 w-16">№ п/п</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r) => {
                      const e = editRows[r.rowNumber];
                      if (!e) return null;
                      return (
                        <RowEditor
                          key={r.rowNumber}
                          row={r}
                          edit={e}
                          cps={cps.data ?? []}
                          invoices={invoices.data ?? []}
                          onChange={(next) => setEditRows((p) => ({ ...p, [r.rowNumber]: next }))}
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Separator className="my-3" />
              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  К импорту: <b className="text-foreground">{importableCount}</b> строк{hasErrorRows ? ", строки с ошибками будут пропущены" : ""}
                </div>
                <Button
                  onClick={() => confirmMutation.mutate()}
                  disabled={importableCount === 0 || confirmMutation.isPending}
                >
                  {confirmMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Импортировать выбранные ({importableCount})
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}

      {/* Шаг 3: отчёт */}
      {report ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Результат импорта</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-3 text-sm">
              <Stat label="Создано платежей" value={report.createdPayments.length} color="text-emerald-700" />
              <Stat label="Пропущено" value={report.skippedRows.length} />
              <Stat label="Ошибки" value={report.errors.length} color={report.errors.length > 0 ? "text-red-700" : ""} />
            </div>
            {report.errors.length > 0 ? (
              <div className="border rounded-md p-2 bg-destructive/5">
                <div className="text-sm font-medium mb-1">Ошибки по строкам:</div>
                <ul className="space-y-1 text-xs">
                  {report.errors.map((e, i) => (
                    <li key={i}>Строка {e.rowNumber}: {e.message}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="flex gap-2">
              <Button variant="outline" onClick={reset}>Загрузить другой файл</Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function RowEditor({ row, edit, cps, invoices, onChange }: {
  row: PreviewRow;
  edit: EditState;
  cps: CpOpt[];
  invoices: InvOpt[];
  onChange: (next: EditState) => void;
}) {
  const statusBadge = row.status === "error"
    ? <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> ошибка</Badge>
    : row.status === "needs_review"
      ? <Badge variant="secondary" className="gap-1"><AlertTriangle className="h-3 w-3" /> проверить</Badge>
      : <Badge variant="success" className="gap-1"><CheckCircle2 className="h-3 w-3" /> готово</Badge>;

  const totalAlloc = edit.allocations.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
  const unallocated = (row.amount ?? 0) - totalAlloc;

  return (
    <tr className="border-b last:border-0 align-top">
      <td className="p-2 text-muted-foreground">{row.rowNumber}</td>
      <td className="p-2">{statusBadge}</td>
      <td className="p-2">
        <Select
          value={edit.action}
          onValueChange={(v) => onChange({ ...edit, action: v as EditState["action"] })}
          disabled={row.status === "error"}
        >
          <SelectTrigger className="h-7"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="import">Импортировать</SelectItem>
            <SelectItem value="skip">Пропустить</SelectItem>
          </SelectContent>
        </Select>
      </td>
      <td className="p-2 text-muted-foreground">{row.date ? formatDate(row.date) : "—"}</td>
      <td className="p-2">
        {row.direction === "IN" ? <ArrowDownToLine className="h-4 w-4 text-emerald-600" />
          : row.direction === "OUT" ? <ArrowUpFromLine className="h-4 w-4 text-red-600" />
          : null}
      </td>
      <td className="p-2 text-right font-mono">
        {row.amount != null ? formatAmount(row.amount) : <span className="text-destructive">—</span>}
      </td>
      <td className="p-2">
        <div>
          {row.counterpartyName ?? "—"}
          {row.counterpartyInn ? <div className="text-muted-foreground font-mono">{row.counterpartyInn}</div> : null}
        </div>
        {row.direction !== "OUT" ? (
          <Select
            value={edit.counterpartyId ?? "none"}
            onValueChange={(v) => onChange({ ...edit, counterpartyId: v === "none" ? null : v, allocations: [] })}
          >
            <SelectTrigger className="h-7 mt-1"><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— не выбран —</SelectItem>
              {cps.map((c) => <SelectItem key={c.id} value={c.id}>{c.name} ({c.inn})</SelectItem>)}
            </SelectContent>
          </Select>
        ) : null}
      </td>
      <td className="p-2">
        <div className="text-muted-foreground line-clamp-2">{row.purpose ?? "—"}</div>
        {row.errors.length > 0 ? (
          <div className="text-destructive mt-1">{row.errors.join("; ")}</div>
        ) : null}
        {row.warnings.length > 0 ? (
          <div className="text-amber-700 mt-1">{row.warnings.join("; ")}</div>
        ) : null}
        {row.direction === "IN" && edit.counterpartyId ? (
          <div className="mt-1">
            <AllocationsEditor
              counterpartyId={edit.counterpartyId}
              allocations={edit.allocations}
              invoices={invoices}
              amount={row.amount ?? 0}
              onChange={(allocs) => onChange({ ...edit, allocations: allocs })}
            />
            {unallocated > 0.005 ? (
              <Badge variant="secondary" className="mt-1">Аванс {formatAmount(unallocated)} ₽</Badge>
            ) : null}
          </div>
        ) : null}
      </td>
      <td className="p-2 text-muted-foreground font-mono">{row.reference ?? "—"}</td>
    </tr>
  );
}

function AllocationsEditor({ counterpartyId, allocations, invoices, amount, onChange }: {
  counterpartyId: string;
  allocations: Array<{ invoiceId: string; amount: string }>;
  invoices: InvOpt[];
  amount: number;
  onChange: (next: Array<{ invoiceId: string; amount: string }>) => void;
}) {
  const candidates = useMemo(
    () => invoices.filter((i) => i.counterpartyId === counterpartyId && i.status !== "PAID" && i.status !== "CANCELLED"),
    [invoices, counterpartyId],
  );

  if (candidates.length === 0) return (
    <div className="text-xs text-muted-foreground">Нет неоплаченных счетов — всё уйдёт в аванс</div>
  );

  return (
    <div className="space-y-1">
      <div className="flex gap-2 items-center text-xs">
        <span className="text-muted-foreground">Распределение:</span>
        <Button
          type="button" variant="ghost" size="sm"
          className="h-6 px-2"
          onClick={() => {
            // Авто-распределение
            let remaining = amount;
            const next: Array<{ invoiceId: string; amount: string }> = [];
            for (const inv of candidates) {
              if (remaining <= 0.005) break;
              const balance = parseFloat(inv.total);  // упрощение: считаем что неоплачен полностью
              const take = Math.min(remaining, balance);
              if (take > 0) {
                next.push({ invoiceId: inv.id, amount: take.toFixed(2) });
                remaining = Math.round((remaining - take) * 100) / 100;
              }
            }
            onChange(next);
          }}
        >
          <Layers className="h-3 w-3" /> Авто
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-6 px-2" onClick={() => onChange([])}>
          Очистить
        </Button>
      </div>
      <div className="space-y-1">
        {allocations.map((a, idx) => {
          const inv = candidates.find((c) => c.id === a.invoiceId) ?? invoices.find((c) => c.id === a.invoiceId);
          return (
            <div key={idx} className="flex gap-1 items-center text-xs">
              <Select
                value={a.invoiceId}
                onValueChange={(v) => onChange(allocations.map((x, i) => i === idx ? { ...x, invoiceId: v } : x))}
              >
                <SelectTrigger className="h-7 flex-1"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {candidates.map((c) => <SelectItem key={c.id} value={c.id}>{c.number} ({formatAmount(c.total)})</SelectItem>)}
                </SelectContent>
              </Select>
              <Input
                type="number" step="0.01" min="0" className="h-7 w-24 text-right font-mono"
                value={a.amount}
                onChange={(e) => onChange(allocations.map((x, i) => i === idx ? { ...x, amount: e.target.value } : x))}
              />
              <Button type="button" variant="ghost" size="sm" className="h-6 px-1" onClick={() => onChange(allocations.filter((_, i) => i !== idx))}>×</Button>
              {inv && a.invoiceId === inv.id ? null : <span className="text-amber-700">?</span>}
            </div>
          );
        })}
        {allocations.length < candidates.length ? (
          <Button
            type="button" variant="outline" size="sm" className="h-6 text-xs"
            onClick={() => {
              const used = new Set(allocations.map((a) => a.invoiceId));
              const next = candidates.find((c) => !used.has(c.id));
              if (next) onChange([...allocations, { invoiceId: next.id, amount: "0" }]);
            }}
          >
            + добавить счёт
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Stat({ label, value, color, valueColor }: { label: string; value: number | string; color?: string; valueColor?: string }) {
  return (
    <div className="rounded-md border p-2">
      <div className={`text-xs ${color ?? "text-muted-foreground"}`}>{label}</div>
      <div className={`font-mono font-medium ${valueColor ?? ""}`}>{value}</div>
    </div>
  );
}
