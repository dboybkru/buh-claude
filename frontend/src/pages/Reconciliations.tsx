import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, FileDown, Eye, BookCheck, Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { api } from "@/lib/api";
import { handleApiError } from "@/lib/errors";
import { useDebouncedValue } from "@/lib/hooks";
import { fetchAuthorizedBlob, triggerDownload } from "@/lib/download";
import { DataTable, type Page } from "@/components/DataTable";
import { PdfPreviewDialog } from "@/components/PdfPreviewDialog";
import { FormField } from "@/pages/Organizations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { formatAmount, formatDate } from "@/lib/format";

interface ReconciliationAct {
  id: string;
  number: string;
  date: string;
  periodFrom: string;
  periodTo: string;
  openingBalance: string;
  totalDebit: string;
  totalCredit: string;
  closingBalance: string;
  status: string;
  organization?: { id: string; name: string };
  counterparty?: { id: string; name: string; inn: string };
}

interface OrgOpt { id: string; name: string; inn: string }
interface CpOpt { id: string; name: string; inn: string }

interface PreviewLine {
  date: string;
  kind: "INVOICE" | "ACT" | "UPD" | "WAYBILL" | "PAYMENT";
  description: string;
  debit: number;
  credit: number;
}
interface PreviewResult {
  openingBalance: number;
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
  lines: PreviewLine[];
  organization: { id: string; name: string; inn: string };
  counterparty: { id: string; name: string; inn: string };
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Черновик",
  SENT: "Отправлен",
  AGREED: "Согласован",
  DISAGREED: "Расхождения",
};

export function ReconciliationsPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const dq = useDebouncedValue(q, 300);
  const [creating, setCreating] = useState(false);
  const [previewActId, setPreviewActId] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ["reconciliations", { page, q: dq }],
    queryFn: async () =>
      (await api.get<Page<ReconciliationAct>>("/reconciliations", { params: { page, pageSize: 20, q: dq || undefined } })).data,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/reconciliations/${id}`),
    onSuccess: () => {
      toast.success("Акт сверки удалён");
      qc.invalidateQueries({ queryKey: ["reconciliations"] });
    },
    onError: (e) => handleApiError(e, "Не удалось удалить"),
  });

  async function downloadPdf(id: string, number: string) {
    try {
      const { blob, filename } = await fetchAuthorizedBlob(`/api/v1/reconciliations/${id}/pdf`, `Акт-сверки-${number}.pdf`);
      triggerDownload(blob, filename);
    } catch (err) {
      handleApiError(err, "Не удалось скачать PDF");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Акты сверки</h1>
        <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Сформировать акт</Button>
      </div>

      <DataTable
        rows={list.data?.items ?? []}
        rowKey={(r) => r.id}
        total={list.data?.total}
        page={page} pageSize={20} onPageChange={setPage}
        search={q} onSearchChange={setQ}
        searchPlaceholder="Номер или контрагент"
        loading={list.isLoading}
        empty="Актов сверки пока нет. Нажмите «Сформировать акт»."
        columns={[
          {
            key: "number",
            header: "№ акта",
            cell: (r) => (
              <div className="flex items-center gap-2">
                <BookCheck className="h-4 w-4 text-muted-foreground" />
                <div>
                  <div className="font-medium font-mono text-sm">{r.number}</div>
                  <div className="text-xs text-muted-foreground">от {formatDate(r.date)}</div>
                </div>
              </div>
            ),
          },
          { key: "cp", header: "Контрагент", cell: (r) => <div>{r.counterparty?.name ?? "—"}<div className="text-xs text-muted-foreground">{r.counterparty?.inn}</div></div> },
          { key: "period", header: "Период", width: "200px", cell: (r) => <span className="text-sm">{formatDate(r.periodFrom)} — {formatDate(r.periodTo)}</span> },
          {
            key: "closing",
            header: "Сальдо",
            width: "160px",
            align: "right",
            cell: (r) => {
              const cb = parseFloat(r.closingBalance);
              return (
                <span className={`font-mono font-medium ${cb > 0 ? "text-amber-700" : cb < 0 ? "text-blue-700" : "text-muted-foreground"}`}>
                  {cb === 0 ? "0,00 ₽" : (cb > 0 ? "+" : "") + formatAmount(cb) + " ₽"}
                </span>
              );
            },
          },
          { key: "status", header: "Статус", width: "120px", cell: (r) => <Badge variant={r.status === "AGREED" ? "success" : r.status === "DISAGREED" ? "destructive" : "secondary"}>{STATUS_LABEL[r.status] ?? r.status}</Badge> },
          {
            key: "actions",
            header: "",
            width: "120px",
            align: "right",
            cell: (r) => (
              <div className="flex gap-1 justify-end">
                <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); setPreviewActId(r.id); }} aria-label="Превью"><Eye className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); downloadPdf(r.id, r.number); }} aria-label="Скачать"><FileDown className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); if (confirm(`Удалить акт сверки ${r.number}?`)) remove.mutate(r.id); }} aria-label="Удалить">
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ),
          },
        ]}
      />

      {creating ? (
        <CreateDialog onClose={() => setCreating(false)} onSaved={() => { setCreating(false); qc.invalidateQueries({ queryKey: ["reconciliations"] }); }} />
      ) : null}

      {previewActId ? (
        <PdfPreviewDialog
          open
          url={`/api/v1/reconciliations/${previewActId}/pdf`}
          fallbackName="Акт сверки.pdf"
          title="Акт сверки"
          onClose={() => setPreviewActId(null)}
        />
      ) : null}
    </div>
  );
}

const createSchema = z.object({
  organizationId: z.string().uuid("Выберите организацию"),
  counterpartyId: z.string().uuid("Выберите контрагента"),
  periodFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().optional(),
});
type CreateForm = z.infer<typeof createSchema>;

function CreateDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const orgs = useQuery({ queryKey: ["orgs-opts"], queryFn: async () => (await api.get<{ items: OrgOpt[] }>("/organizations", { params: { pageSize: 200 } })).data.items });
  const cps = useQuery({ queryKey: ["cps-opts"], queryFn: async () => (await api.get<{ items: CpOpt[] }>("/counterparties", { params: { pageSize: 200 } })).data.items });

  const year = new Date().getFullYear();
  const form = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      organizationId: "",
      counterpartyId: "",
      periodFrom: `${year}-01-01`,
      periodTo: new Date().toISOString().slice(0, 10),
      notes: "",
    },
  });

  const values = form.watch();
  const canPreview = !!values.organizationId && !!values.counterpartyId && !!values.periodFrom && !!values.periodTo;

  const preview = useQuery({
    queryKey: ["reconciliation-preview", values.organizationId, values.counterpartyId, values.periodFrom, values.periodTo],
    queryFn: async () => (await api.get<PreviewResult>("/reconciliations/preview", { params: { organizationId: values.organizationId, counterpartyId: values.counterpartyId, periodFrom: values.periodFrom, periodTo: values.periodTo } })).data,
    enabled: canPreview,
  });

  async function onSubmit(v: CreateForm) {
    try {
      await api.post("/reconciliations", { ...v, notes: v.notes || null });
      toast.success("Акт сверки сохранён");
      onSaved();
    } catch (err) {
      handleApiError(err);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Сформировать акт сверки</DialogTitle>
          <DialogDescription>
            Выберите контрагента и период. Акт включает все счета и платежи за период с учётом сальдо на начало.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Наша организация" error={form.formState.errors.organizationId?.message}>
              <Select value={form.watch("organizationId")} onValueChange={(v) => form.setValue("organizationId", v)}>
                <SelectTrigger><SelectValue placeholder="Выберите..." /></SelectTrigger>
                <SelectContent>
                  {orgs.data?.map((o) => <SelectItem key={o.id} value={o.id}>{o.name} ({o.inn})</SelectItem>)}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Контрагент" error={form.formState.errors.counterpartyId?.message}>
              <Select value={form.watch("counterpartyId")} onValueChange={(v) => form.setValue("counterpartyId", v)}>
                <SelectTrigger><SelectValue placeholder="Выберите..." /></SelectTrigger>
                <SelectContent>
                  {cps.data?.map((c) => <SelectItem key={c.id} value={c.id}>{c.name} ({c.inn})</SelectItem>)}
                </SelectContent>
              </Select>
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Период с">
              <Input type="date" {...form.register("periodFrom")} />
            </FormField>
            <FormField label="Период по">
              <Input type="date" {...form.register("periodTo")} />
            </FormField>
          </div>

          <FormField label="Примечание">
            <Textarea rows={2} {...form.register("notes")} />
          </FormField>

          <Separator />

          {!canPreview ? (
            <div className="text-sm text-muted-foreground text-center py-4">
              Заполните организацию, контрагента и период — внизу появится превью акта.
            </div>
          ) : preview.isLoading ? (
            <div className="flex items-center gap-2 justify-center py-4 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Считаем движения...
            </div>
          ) : preview.data ? (
            <Card>
              <CardContent className="pt-4 space-y-3">
                <div className="text-sm font-semibold">Предварительный расчёт</div>
                <div className="grid grid-cols-4 gap-2 text-sm">
                  <Stat label="Сальдо начала" value={preview.data.openingBalance} />
                  <Stat label="Обороты дебет" value={preview.data.totalDebit} />
                  <Stat label="Обороты кредит" value={preview.data.totalCredit} />
                  <Stat label="Сальдо конца" value={preview.data.closingBalance} emphasize />
                </div>
                <div className="border rounded-md overflow-x-auto max-h-64 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 sticky top-0">
                      <tr className="text-left">
                        <th className="p-2 w-24">Дата</th>
                        <th className="p-2">Документ</th>
                        <th className="p-2 text-right w-28">Дебет</th>
                        <th className="p-2 text-right w-28">Кредит</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.data.lines.length === 0 ? (
                        <tr><td colSpan={4} className="text-center text-muted-foreground py-4">Движений за период нет</td></tr>
                      ) : (
                        preview.data.lines.map((l, i) => (
                          <tr key={i} className="border-b last:border-0">
                            <td className="p-2 text-muted-foreground">{formatDate(l.date)}</td>
                            <td className="p-2">{l.description}</td>
                            <td className="p-2 text-right font-mono">{l.debit > 0 ? formatAmount(l.debit) : ""}</td>
                            <td className="p-2 text-right font-mono">{l.credit > 0 ? formatAmount(l.credit) : ""}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Отмена</Button>
            <Button type="submit" disabled={form.formState.isSubmitting || !canPreview || preview.isLoading}>
              {form.formState.isSubmitting ? "Сохранение..." : "Сохранить акт"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, emphasize }: { label: string; value: number; emphasize?: boolean }) {
  const color = value > 0 ? "text-amber-700" : value < 0 ? "text-blue-700" : "text-muted-foreground";
  return (
    <div className="rounded-md border p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`font-mono ${emphasize ? "font-bold text-base" : ""} ${color}`}>
        {value === 0 ? "0,00" : (value > 0 ? "+" : "") + formatAmount(value)} ₽
      </div>
    </div>
  );
}
