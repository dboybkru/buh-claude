import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Edit, Users, Search } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { api } from "@/lib/api";
import { handleApiError } from "@/lib/errors";
import { useDebouncedValue } from "@/lib/hooks";
import { isValidInn, isValidKpp, isValidOgrn } from "@/lib/checksums";
import { DataTable, type Page } from "@/components/DataTable";
import { FormField } from "@/pages/Organizations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

const ORG_TYPES = [
  { value: "OOO", label: "ООО" }, { value: "AO", label: "АО" }, { value: "PAO", label: "ПАО" },
  { value: "ZAO", label: "ЗАО" }, { value: "OAO", label: "ОАО" }, { value: "IP", label: "ИП" },
];

interface Counterparty {
  id: string;
  type: string;
  inn: string;
  kpp: string | null;
  name: string;
  fullName: string | null;
  ogrn: string | null;
  legalAddress: string | null;
  managementName: string | null;
  managementPos: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  notes: string | null;
  isActive: boolean;
}

const cpSchema = z.object({
  type: z.enum(["OOO", "AO", "PAO", "ZAO", "OAO", "IP"]),
  inn: z.string().refine(isValidInn, "ИНН: неверный формат или контрольная сумма"),
  kpp: z.string().refine((v) => v === "" || isValidKpp(v), "КПП — 9 цифр").optional().or(z.literal("")),
  name: z.string().min(1, "Название обязательно"),
  fullName: z.string().optional().or(z.literal("")),
  ogrn: z.string().refine((v) => v === "" || isValidOgrn(v), "ОГРН: неверная контрольная сумма").optional().or(z.literal("")),
  legalAddress: z.string().optional().or(z.literal("")),
  managementName: z.string().optional().or(z.literal("")),
  managementPos: z.string().optional().or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")),
  website: z.string().optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
  isActive: z.boolean(),
});
type CpForm = z.infer<typeof cpSchema>;

function blankCp(): CpForm {
  return {
    type: "OOO", inn: "", kpp: "", name: "", fullName: "", ogrn: "",
    legalAddress: "", managementName: "", managementPos: "",
    email: "", phone: "", website: "", notes: "", isActive: true,
  };
}

export function CounterpartiesPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const dq = useDebouncedValue(q, 300);
  const [editing, setEditing] = useState<Counterparty | "new" | null>(null);

  const list = useQuery({
    queryKey: ["counterparties", { page, q: dq }],
    queryFn: async () =>
      (await api.get<Page<Counterparty>>("/counterparties", { params: { page, pageSize: 20, q: dq || undefined } })).data,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/counterparties/${id}`),
    onSuccess: () => { toast.success("Удалено"); qc.invalidateQueries({ queryKey: ["counterparties"] }); },
    onError: (e) => handleApiError(e, "Не удалось удалить"),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Контрагенты</h1>
        <Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> Добавить</Button>
      </div>

      <DataTable
        rows={list.data?.items ?? []}
        rowKey={(c) => c.id}
        total={list.data?.total}
        page={page}
        pageSize={20}
        onPageChange={setPage}
        search={q}
        onSearchChange={setQ}
        searchPlaceholder="Название или ИНН"
        loading={list.isLoading}
        empty="Контрагентов пока нет"
        columns={[
          { key: "type", header: "Тип", width: "60px", cell: (c) => <Badge variant="outline">{c.type}</Badge> },
          {
            key: "name",
            header: "Контрагент",
            cell: (c) => (
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <div>
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-muted-foreground">{c.fullName ?? "—"}</div>
                </div>
              </div>
            ),
          },
          { key: "inn", header: "ИНН/КПП", width: "180px", cell: (c) => <span className="font-mono text-sm">{c.inn}{c.kpp ? `/${c.kpp}` : ""}</span> },
          { key: "status", header: "", width: "100px", cell: (c) => c.isActive ? null : <Badge variant="secondary">архив</Badge> },
          {
            key: "actions",
            header: "",
            width: "100px",
            align: "right",
            cell: (c) => (
              <div className="flex gap-1 justify-end">
                <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); setEditing(c); }}><Edit className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); if (confirm(`Удалить ${c.name}?`)) remove.mutate(c.id); }}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ),
          },
        ]}
        onRowClick={(c) => setEditing(c)}
      />

      {editing ? (
        <CpDialog
          counterparty={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ["counterparties"] }); }}
        />
      ) : null}
    </div>
  );
}

function CpDialog({ counterparty, onClose, onSaved }: { counterparty: Counterparty | null; onClose: () => void; onSaved: () => void }) {
  const isNew = !counterparty;
  const [dadataInn, setDadataInn] = useState("");
  const [dadataLoading, setDadataLoading] = useState(false);

  const form = useForm<CpForm>({
    resolver: zodResolver(cpSchema),
    defaultValues: counterparty
      ? {
          ...blankCp(),
          ...counterparty,
          kpp: counterparty.kpp ?? "",
          fullName: counterparty.fullName ?? "",
          ogrn: counterparty.ogrn ?? "",
          legalAddress: counterparty.legalAddress ?? "",
          managementName: counterparty.managementName ?? "",
          managementPos: counterparty.managementPos ?? "",
          email: counterparty.email ?? "",
          phone: counterparty.phone ?? "",
          website: counterparty.website ?? "",
          notes: counterparty.notes ?? "",
          type: counterparty.type as CpForm["type"],
        }
      : blankCp(),
  });

  async function fetchByInn() {
    if (!/^\d{10}(\d{2})?$/.test(dadataInn)) {
      toast.error("ИНН должен быть 10 или 12 цифр");
      return;
    }
    setDadataLoading(true);
    try {
      const r = await api.get("/dadata/party/by-inn", { params: { inn: dadataInn } });
      const sug = (r.data as { suggestions?: Array<{ value: string; data: Record<string, unknown> }> }).suggestions?.[0];
      if (!sug) {
        toast.error("По этому ИНН ничего не найдено");
        return;
      }
      const d = sug.data as {
        inn?: string; kpp?: string | null; ogrn?: string | null;
        name?: { short_with_opf?: string; full_with_opf?: string };
        address?: { unrestricted_value?: string };
        management?: { name?: string; post?: string };
        type?: "LEGAL" | "INDIVIDUAL";
      };
      const isInd = d.type === "INDIVIDUAL";
      form.reset({
        ...form.getValues(),
        type: isInd ? "IP" : "OOO",
        inn: d.inn ?? dadataInn,
        kpp: d.kpp ?? "",
        ogrn: d.ogrn ?? "",
        name: d.name?.short_with_opf ?? sug.value,
        fullName: d.name?.full_with_opf ?? "",
        legalAddress: d.address?.unrestricted_value ?? "",
        managementName: d.management?.name ?? "",
        managementPos: d.management?.post ?? "",
      });
      toast.success("Данные подставлены из DaData");
    } catch (err) {
      const code = (err as { response?: { status?: number } }).response?.status;
      if (code === 503) toast.error("DaData не настроена. Добавьте DADATA_API_KEY в backend/.env");
      else handleApiError(err);
    } finally {
      setDadataLoading(false);
    }
  }

  async function onSubmit(values: CpForm) {
    const payload = {
      ...values,
      kpp: values.kpp || null,
      fullName: values.fullName || null,
      ogrn: values.ogrn || null,
      legalAddress: values.legalAddress || null,
      managementName: values.managementName || null,
      managementPos: values.managementPos || null,
      email: values.email || null,
      phone: values.phone || null,
      website: values.website || null,
      notes: values.notes || null,
    };
    try {
      if (isNew) {
        await api.post("/counterparties", payload);
        toast.success("Контрагент создан");
      } else {
        await api.patch(`/counterparties/${counterparty!.id}`, payload);
        toast.success("Сохранено");
      }
      onSaved();
    } catch (err) { handleApiError(err); }
  }

  const type = form.watch("type");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isNew ? "Новый контрагент" : `Редактирование: ${counterparty!.name}`}</DialogTitle>
          <DialogDescription>Реквизиты используются при выставлении документов.</DialogDescription>
        </DialogHeader>

        {isNew ? (
          <div className="rounded-md border p-3 bg-muted/30 space-y-2">
            <div className="text-xs font-medium">Найти по ИНН через DaData</div>
            <div className="flex gap-2">
              <Input
                placeholder="ИНН (10 или 12 цифр)"
                value={dadataInn}
                onChange={(e) => setDadataInn(e.target.value)}
                className="font-mono"
              />
              <Button type="button" variant="outline" onClick={fetchByInn} disabled={dadataLoading}>
                <Search className="h-4 w-4" /> {dadataLoading ? "Поиск..." : "Найти"}
              </Button>
            </div>
          </div>
        ) : null}

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <FormField label="Тип">
              <Select value={type} onValueChange={(v) => form.setValue("type", v as CpForm["type"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{ORG_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </FormField>
            <FormField label="ИНН" error={form.formState.errors.inn?.message}>
              <Input {...form.register("inn")} className="font-mono" />
            </FormField>
            <FormField label="КПП">
              <Input {...form.register("kpp")} className="font-mono" />
            </FormField>
          </div>
          <FormField label="Краткое наименование" error={form.formState.errors.name?.message}>
            <Input {...form.register("name")} />
          </FormField>
          <FormField label="Полное наименование">
            <Input {...form.register("fullName")} />
          </FormField>
          <FormField label="ОГРН">
            <Input {...form.register("ogrn")} className="font-mono" />
          </FormField>
          <FormField label="Юридический адрес">
            <Textarea {...form.register("legalAddress")} rows={2} />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Руководитель (ФИО)">
              <Input {...form.register("managementName")} />
            </FormField>
            <FormField label="Должность">
              <Input {...form.register("managementPos")} />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Email" error={form.formState.errors.email?.message}>
              <Input type="email" {...form.register("email")} />
            </FormField>
            <FormField label="Телефон">
              <Input {...form.register("phone")} />
            </FormField>
          </div>
          <FormField label="Сайт">
            <Input {...form.register("website")} />
          </FormField>
          <FormField label="Заметки">
            <Textarea {...form.register("notes")} rows={2} />
          </FormField>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...form.register("isActive")} /> Активный
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
