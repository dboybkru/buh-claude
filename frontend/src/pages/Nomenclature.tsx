import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Edit, Package } from "lucide-react";
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
import { formatAmount } from "@/lib/format";

const NOMEN_TYPES = [
  { value: "TOVAR", label: "Товар" },
  { value: "USLUGA", label: "Услуга" },
  { value: "RABOTA", label: "Работа" },
];

interface Nomen {
  id: string;
  code: string;
  name: string;
  fullName: string | null;
  unitMeasure: string;
  unitCode: string;
  type: string;
  vatRate: string;
  price: string | null;
  isActive: boolean;
  description: string | null;
}

const nomenSchema = z.object({
  code: z.string().min(1, "Код обязателен"),
  name: z.string().min(1, "Наименование обязательно"),
  fullName: z.string().optional().or(z.literal("")),
  unitMeasure: z.string().min(1),
  unitCode: z.string().min(1),
  type: z.enum(["TOVAR", "USLUGA", "RABOTA"]),
  vatRate: z.coerce.number().min(0).max(99.99),
  price: z.string().optional().or(z.literal("")),
  isActive: z.boolean(),
  description: z.string().optional().or(z.literal("")),
});
type NomenForm = z.infer<typeof nomenSchema>;

function blank(): NomenForm {
  return { code: "", name: "", fullName: "", unitMeasure: "шт", unitCode: "796", type: "TOVAR", vatRate: 20, price: "", isActive: true, description: "" };
}

export function NomenclaturePage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const dq = useDebouncedValue(q, 300);
  const [editing, setEditing] = useState<Nomen | "new" | null>(null);
  const [sort, setSort] = useUrlSort({ field: "name", dir: "asc" });

  const list = useQuery({
    queryKey: ["nomenclature", { page, q: dq, sort }],
    queryFn: async () =>
      (await api.get<Page<Nomen>>("/nomenclature", {
        params: { page, pageSize: 20, q: dq || undefined, sort: sortQueryParam(sort) },
      })).data,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/nomenclature/${id}`),
    onSuccess: () => { toast.success("Удалено"); qc.invalidateQueries({ queryKey: ["nomenclature"] }); },
    onError: (e) => handleApiError(e, "Не удалось удалить"),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Номенклатура</h1>
        <Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> Добавить</Button>
      </div>

      <DataTable
        rows={list.data?.items ?? []}
        rowKey={(n) => n.id}
        total={list.data?.total}
        page={page} pageSize={20} onPageChange={setPage}
        search={q} onSearchChange={setQ}
        searchPlaceholder="Код или наименование"
        loading={list.isLoading}
        empty="Номенклатуры пока нет"
        sort={sort}
        onSortChange={(next) => { setSort(next); setPage(1); }}
        columns={[
          { key: "code", header: "Код", width: "120px", sortKey: "code", cell: (n) => <span className="font-mono text-sm">{n.code}</span> },
          {
            key: "name",
            header: "Наименование",
            sortKey: "name",
            cell: (n) => (
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-muted-foreground" />
                <div>
                  <div>{n.name}</div>
                  {n.fullName ? <div className="text-xs text-muted-foreground">{n.fullName}</div> : null}
                </div>
              </div>
            ),
          },
          { key: "type", header: "Тип", width: "80px", cell: (n) => <Badge variant="outline">{NOMEN_TYPES.find((t) => t.value === n.type)?.label ?? n.type}</Badge> },
          { key: "unit", header: "Ед.", width: "60px", cell: (n) => <span className="text-sm">{n.unitMeasure}</span> },
          { key: "vat", header: "НДС", width: "60px", align: "right", cell: (n) => <span className="text-sm">{n.vatRate}%</span> },
          { key: "price", header: "Цена", width: "120px", align: "right", cell: (n) => <span className="font-mono text-sm">{n.price ? formatAmount(n.price) : "—"}</span> },
          {
            key: "actions",
            header: "",
            width: "100px",
            align: "right",
            cell: (n) => (
              <div className="flex gap-1 justify-end">
                <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); setEditing(n); }}><Edit className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); if (confirm(`Удалить ${n.name}?`)) remove.mutate(n.id); }}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ),
          },
        ]}
        onRowClick={(n) => setEditing(n)}
      />

      {editing ? (
        <NomenDialog
          nomen={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ["nomenclature"] }); }}
        />
      ) : null}
    </div>
  );
}

function NomenDialog({ nomen, onClose, onSaved }: { nomen: Nomen | null; onClose: () => void; onSaved: () => void }) {
  const isNew = !nomen;
  const form = useForm<NomenForm>({
    resolver: zodResolver(nomenSchema),
    defaultValues: nomen
      ? {
          ...blank(),
          code: nomen.code, name: nomen.name, fullName: nomen.fullName ?? "",
          unitMeasure: nomen.unitMeasure, unitCode: nomen.unitCode,
          type: nomen.type as NomenForm["type"],
          vatRate: parseFloat(nomen.vatRate),
          price: nomen.price ?? "",
          isActive: nomen.isActive,
          description: nomen.description ?? "",
        }
      : blank(),
  });

  async function onSubmit(v: NomenForm) {
    const payload = {
      ...v,
      fullName: v.fullName || null,
      price: v.price === "" ? null : Number(v.price),
      description: v.description || null,
    };
    try {
      if (isNew) await api.post("/nomenclature", payload);
      else await api.patch(`/nomenclature/${nomen!.id}`, payload);
      toast.success("Сохранено");
      onSaved();
    } catch (err) { handleApiError(err); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{isNew ? "Новая позиция" : `Редактирование: ${nomen!.name}`}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Код / артикул" error={form.formState.errors.code?.message}>
              <Input {...form.register("code")} className="font-mono" />
            </FormField>
            <FormField label="Тип">
              <Select value={form.watch("type")} onValueChange={(v) => form.setValue("type", v as NomenForm["type"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{NOMEN_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </FormField>
          </div>
          <FormField label="Наименование" error={form.formState.errors.name?.message}>
            <Input {...form.register("name")} />
          </FormField>
          <FormField label="Полное наименование (для документов)">
            <Input {...form.register("fullName")} />
          </FormField>
          <div className="grid grid-cols-3 gap-3">
            <FormField label="Ед. изм">
              <Input {...form.register("unitMeasure")} placeholder="шт" />
            </FormField>
            <FormField label="Код ОКЕИ">
              <Input {...form.register("unitCode")} className="font-mono" placeholder="796" />
            </FormField>
            <FormField label="Ставка НДС, %">
              <Input type="number" step="0.01" {...form.register("vatRate")} />
            </FormField>
          </div>
          <FormField label="Цена за единицу">
            <Input type="number" step="0.01" {...form.register("price")} />
          </FormField>
          <FormField label="Описание">
            <Textarea {...form.register("description")} rows={2} />
          </FormField>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...form.register("isActive")} /> Активна
          </label>

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
