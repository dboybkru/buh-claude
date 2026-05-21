import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Edit, FileSignature, Receipt } from "lucide-react";
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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { formatAmount, formatDate } from "@/lib/format";

const STATUSES = [
  { value: "DRAFT", label: "Черновик" },
  { value: "ACTIVE", label: "Действует" },
  { value: "EXPIRED", label: "Истёк" },
  { value: "TERMINATED", label: "Расторгнут" },
];

interface Contract {
  id: string;
  organizationId: string;
  counterpartyId: string;
  number: string;
  date: string;
  expiryDate: string | null;
  subject: string | null;
  amount: string | null;
  currency: string;
  status: string;
  autoRenew: boolean;
  description: string | null;
  organization?: { id: string; name: string; inn: string };
  counterparty?: { id: string; name: string; inn: string };
}

interface OrgOpt { id: string; name: string; inn: string }
interface CpOpt { id: string; name: string; inn: string }

const contractSchema = z.object({
  organizationId: z.string().uuid("Выберите организацию"),
  counterpartyId: z.string().uuid("Выберите контрагента"),
  number: z.string().min(1, "Номер обязателен"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата ГГГГ-ММ-ДД"),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  subject: z.string().optional().or(z.literal("")),
  amount: z.string().optional().or(z.literal("")),
  currency: z.string().length(3),
  status: z.enum(["DRAFT", "ACTIVE", "EXPIRED", "TERMINATED"]),
  autoRenew: z.boolean(),
  description: z.string().optional().or(z.literal("")),
});
type ContractForm = z.infer<typeof contractSchema>;

function blank(): ContractForm {
  return {
    organizationId: "", counterpartyId: "", number: "",
    date: new Date().toISOString().slice(0, 10),
    expiryDate: "", subject: "", amount: "", currency: "RUB",
    status: "ACTIVE", autoRenew: false, description: "",
  };
}

export function ContractsPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const dq = useDebouncedValue(q, 300);
  const [editing, setEditing] = useState<Contract | "new" | null>(null);
  const [sort, setSort] = useUrlSort({ field: "date", dir: "desc" });

  const list = useQuery({
    queryKey: ["contracts", { page, q: dq, sort }],
    queryFn: async () =>
      (await api.get<Page<Contract>>("/contracts", {
        params: { page, pageSize: 20, q: dq || undefined, sort: sortQueryParam(sort) },
      })).data,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/contracts/${id}`),
    onSuccess: () => { toast.success("Удалено"); qc.invalidateQueries({ queryKey: ["contracts"] }); },
    onError: (e) => handleApiError(e, "Не удалось удалить"),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Договоры</h1>
        <Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> Добавить</Button>
      </div>

      <DataTable
        rows={list.data?.items ?? []}
        rowKey={(c) => c.id}
        total={list.data?.total}
        page={page} pageSize={20} onPageChange={setPage}
        search={q} onSearchChange={setQ}
        searchPlaceholder="Номер или предмет"
        loading={list.isLoading}
        empty="Договоров пока нет"
        sort={sort}
        onSortChange={(next) => { setSort(next); setPage(1); }}
        columns={[
          {
            key: "number", header: "№ / Дата",
            sortKey: "number",
            cell: (c) => (
              <div className="flex items-center gap-2">
                <FileSignature className="h-4 w-4 text-muted-foreground" />
                <div>
                  <div className="font-medium">{c.number}</div>
                  <div className="text-xs text-muted-foreground">от {formatDate(c.date)}{c.expiryDate ? ` до ${formatDate(c.expiryDate)}` : ""}</div>
                </div>
              </div>
            ),
          },
          { key: "org", header: "Организация", cell: (c) => <span className="text-sm">{c.organization?.name ?? "—"}</span> },
          { key: "cp", header: "Контрагент", cell: (c) => <span className="text-sm">{c.counterparty?.name ?? "—"}</span> },
          { key: "amount", header: "Сумма", width: "140px", align: "right", cell: (c) => <span className="font-mono text-sm">{c.amount ? `${formatAmount(c.amount)} ${c.currency}` : "—"}</span> },
          { key: "status", header: "", width: "120px", cell: (c) => <Badge variant={c.status === "ACTIVE" ? "default" : c.status === "EXPIRED" ? "destructive" : "secondary"}>{STATUSES.find((s) => s.value === c.status)?.label ?? c.status}</Badge> },
          {
            key: "actions", header: "", width: "100px", align: "right",
            cell: (c) => (
              <div className="flex gap-1 justify-end">
                <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); setEditing(c); }}><Edit className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); if (confirm(`Удалить договор ${c.number}?`)) remove.mutate(c.id); }}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ),
          },
        ]}
        onRowClick={(c) => setEditing(c)}
      />

      {editing ? (
        <ContractDialog
          contract={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ["contracts"] }); }}
        />
      ) : null}
    </div>
  );
}

function ContractDialog({ contract, onClose, onSaved }: { contract: Contract | null; onClose: () => void; onSaved: () => void }) {
  const isNew = !contract;
  const navigate = useNavigate();
  const orgs = useQuery({ queryKey: ["orgs-opts"], queryFn: async () => (await api.get<Page<OrgOpt>>("/organizations", { params: { pageSize: 200 } })).data.items });
  const cps = useQuery({ queryKey: ["cps-opts"], queryFn: async () => (await api.get<Page<CpOpt>>("/counterparties", { params: { pageSize: 200 } })).data.items });

  const form = useForm<ContractForm>({
    resolver: zodResolver(contractSchema),
    defaultValues: contract
      ? {
          ...blank(),
          organizationId: contract.organizationId,
          counterpartyId: contract.counterpartyId,
          number: contract.number,
          date: contract.date.slice(0, 10),
          expiryDate: contract.expiryDate ? contract.expiryDate.slice(0, 10) : "",
          subject: contract.subject ?? "",
          amount: contract.amount ?? "",
          currency: contract.currency,
          status: contract.status as ContractForm["status"],
          autoRenew: contract.autoRenew,
          description: contract.description ?? "",
        }
      : blank(),
  });

  async function onSubmit(v: ContractForm) {
    const payload = {
      ...v,
      expiryDate: v.expiryDate || null,
      subject: v.subject || null,
      amount: v.amount === "" ? null : Number(v.amount),
      description: v.description || null,
    };
    try {
      if (isNew) await api.post("/contracts", payload);
      else await api.patch(`/contracts/${contract!.id}`, payload);
      toast.success("Сохранено");
      onSaved();
    } catch (err) { handleApiError(err); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isNew ? "Новый договор" : `Редактирование: ${contract!.number}`}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Организация" error={form.formState.errors.organizationId?.message}>
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
          <div className="grid grid-cols-3 gap-3">
            <FormField label="Номер" error={form.formState.errors.number?.message}>
              <Input {...form.register("number")} />
            </FormField>
            <FormField label="Дата" error={form.formState.errors.date?.message}>
              <Input type="date" {...form.register("date")} />
            </FormField>
            <FormField label="Дата окончания">
              <Input type="date" {...form.register("expiryDate")} />
            </FormField>
          </div>
          <FormField label="Предмет договора">
            <Input {...form.register("subject")} />
          </FormField>
          <div className="grid grid-cols-3 gap-3">
            <FormField label="Сумма">
              <Input type="number" step="0.01" {...form.register("amount")} />
            </FormField>
            <FormField label="Валюта">
              <Input {...form.register("currency")} className="font-mono" />
            </FormField>
            <FormField label="Статус">
              <Select value={form.watch("status")} onValueChange={(v) => form.setValue("status", v as ContractForm["status"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
            </FormField>
          </div>
          <FormField label="Описание">
            <Textarea {...form.register("description")} rows={2} />
          </FormField>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...form.register("autoRenew")} /> Автопролонгация
          </label>

          <DialogFooter className="gap-2">
            {!isNew ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => navigate(`/invoices/new?fromContract=${contract!.id}`)}
              >
                <Receipt className="h-4 w-4" /> Создать счёт
              </Button>
            ) : null}
            <div className="flex-1" />
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
