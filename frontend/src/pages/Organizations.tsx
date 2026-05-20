import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Edit, Building2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { api } from "@/lib/api";
import { handleApiError } from "@/lib/errors";
import { useDebouncedValue } from "@/lib/hooks";
import { isValidInn, isValidOgrn, isValidKpp, isValidBik, isValidAccount } from "@/lib/checksums";
import { VAT_MODE_LABELS, type VatMode } from "@/lib/vat-rates";
import { DataTable, type Page } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

const ORG_TYPES = [
  { value: "OOO", label: "ООО" }, { value: "AO", label: "АО" }, { value: "PAO", label: "ПАО" },
  { value: "ZAO", label: "ЗАО" }, { value: "OAO", label: "ОАО" }, { value: "IP", label: "ИП" },
] as const;
const TAX_SYSTEMS = [
  { value: "OSN", label: "ОСН (общая)" },
  { value: "USN", label: "УСН (доходы−расходы)" },
  { value: "USN_INCOME", label: "УСН (доходы)" },
  { value: "AUSN", label: "АУСН (автоматическая упрощёнка)" },
  { value: "PSN", label: "Патент" },
  { value: "NPD", label: "НПД (самозанятые)" },
  { value: "ENVD", label: "ЕНВД (отменён)" },
] as const;

const VAT_MODES: Array<{ value: VatMode; label: string; description: string }> = (
  ["GENERAL", "USN_5", "USN_7", "EXEMPT"] as const
).map((mode) => ({ value: mode, label: VAT_MODE_LABELS[mode].short, description: VAT_MODE_LABELS[mode].description }));

interface BankAccount {
  id: string;
  bankName: string;
  bik: string;
  account: string;
  corrAccount: string;
  isDefault: boolean;
}
interface Organization {
  id: string;
  type: string;
  name: string;
  fullName: string;
  inn: string;
  kpp: string | null;
  ogrn: string | null;
  directorName: string | null;
  directorPosition: string | null;
  entrepreneurName: string | null;
  chiefAccountant: string | null;
  email: string | null;
  phone: string | null;
  legalAddress: string;
  actualAddress: string | null;
  vatMode: VatMode;
  taxSystem: string;
  isDefault: boolean;
  bankAccounts: BankAccount[];
}

const orgSchema = z.object({
  type: z.enum(["OOO", "AO", "PAO", "ZAO", "OAO", "IP"]),
  name: z.string().min(1, "Краткое наименование обязательно"),
  fullName: z.string().min(1, "Полное наименование обязательно"),
  inn: z.string().refine(isValidInn, "ИНН: неверный формат или контрольная сумма"),
  kpp: z.string().refine((v) => v === "" || isValidKpp(v), "КПП — 9 цифр").optional().or(z.literal("")),
  ogrn: z.string().refine((v) => v === "" || isValidOgrn(v), "ОГРН: неверная контрольная сумма").optional().or(z.literal("")),
  directorName: z.string().optional().or(z.literal("")),
  directorPosition: z.string().optional().or(z.literal("")),
  entrepreneurName: z.string().optional().or(z.literal("")),
  chiefAccountant: z.string().optional().or(z.literal("")),
  email: z.string().email("Некорректный email").optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")),
  legalAddress: z.string().min(1, "Юридический адрес обязателен"),
  actualAddress: z.string().optional().or(z.literal("")),
  vatMode: z.enum(["EXEMPT", "USN_5", "USN_7", "GENERAL"]),
  taxSystem: z.enum(["OSN", "USN", "USN_INCOME", "AUSN", "ENVD", "PSN", "NPD"]),
  isDefault: z.boolean(),
});
type OrgForm = z.infer<typeof orgSchema>;

function blankOrg(): OrgForm {
  return {
    type: "OOO", name: "", fullName: "", inn: "", kpp: "", ogrn: "",
    directorName: "", directorPosition: "", entrepreneurName: "", chiefAccountant: "",
    email: "", phone: "", legalAddress: "", actualAddress: "",
    vatMode: "GENERAL", taxSystem: "OSN", isDefault: false,
  };
}

export function OrganizationsPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const dq = useDebouncedValue(q, 300);
  const [editing, setEditing] = useState<Organization | "new" | null>(null);

  const list = useQuery({
    queryKey: ["organizations", { page, q: dq }],
    queryFn: async () =>
      (await api.get<Page<Organization>>("/organizations", { params: { page, pageSize: 20, q: dq || undefined } })).data,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/organizations/${id}`),
    onSuccess: () => {
      toast.success("Удалено");
      qc.invalidateQueries({ queryKey: ["organizations"] });
    },
    onError: (e) => handleApiError(e, "Не удалось удалить"),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Мои организации</h1>
        <Button onClick={() => setEditing("new")}>
          <Plus className="h-4 w-4" /> Добавить
        </Button>
      </div>

      <DataTable
        rows={list.data?.items ?? []}
        rowKey={(o) => o.id}
        total={list.data?.total}
        page={page}
        pageSize={20}
        onPageChange={setPage}
        search={q}
        onSearchChange={setQ}
        searchPlaceholder="Название или ИНН"
        loading={list.isLoading}
        empty="Организаций пока нет. Добавьте первую."
        columns={[
          { key: "type", header: "Тип", width: "60px", cell: (o) => <Badge variant="outline">{o.type}</Badge> },
          {
            key: "name",
            header: "Наименование",
            cell: (o) => (
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <div>
                  <div className="font-medium">{o.name}</div>
                  <div className="text-xs text-muted-foreground">{o.fullName}</div>
                </div>
                {o.isDefault ? <Badge className="ml-1" variant="secondary">основная</Badge> : null}
              </div>
            ),
          },
          { key: "inn", header: "ИНН/КПП", width: "180px", cell: (o) => <span className="font-mono text-sm">{o.inn}{o.kpp ? `/${o.kpp}` : ""}</span> },
          { key: "tax", header: "Налог", width: "120px", cell: (o) => <span className="text-sm">{o.taxSystem}</span> },
          {
            key: "actions",
            header: "",
            width: "100px",
            align: "right",
            cell: (o) => (
              <div className="flex gap-1 justify-end">
                <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); setEditing(o); }}>
                  <Edit className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Удалить организацию "${o.name}"?`)) remove.mutate(o.id);
                  }}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ),
          },
        ]}
        onRowClick={(o) => setEditing(o)}
      />

      {editing ? (
        <OrgDialog
          organization={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            qc.invalidateQueries({ queryKey: ["organizations"] });
          }}
        />
      ) : null}
    </div>
  );
}

function OrgDialog({ organization, onClose, onSaved }: { organization: Organization | null; onClose: () => void; onSaved: () => void }) {
  const isNew = !organization;
  const form = useForm<OrgForm>({
    resolver: zodResolver(orgSchema),
    defaultValues: organization
      ? {
          ...blankOrg(),
          ...organization,
          kpp: organization.kpp ?? "",
          ogrn: organization.ogrn ?? "",
          directorName: organization.directorName ?? "",
          directorPosition: organization.directorPosition ?? "",
          entrepreneurName: organization.entrepreneurName ?? "",
          chiefAccountant: organization.chiefAccountant ?? "",
          email: organization.email ?? "",
          phone: organization.phone ?? "",
          actualAddress: organization.actualAddress ?? "",
          type: organization.type as OrgForm["type"],
          taxSystem: organization.taxSystem as OrgForm["taxSystem"],
        }
      : blankOrg(),
  });

  async function onSubmit(values: OrgForm) {
    const payload = {
      ...values,
      kpp: values.kpp || null,
      ogrn: values.ogrn || null,
      directorName: values.directorName || null,
      directorPosition: values.directorPosition || null,
      entrepreneurName: values.entrepreneurName || null,
      chiefAccountant: values.chiefAccountant || null,
      email: values.email || null,
      phone: values.phone || null,
      actualAddress: values.actualAddress || null,
    };
    try {
      if (isNew) {
        await api.post("/organizations", payload);
        toast.success("Организация создана");
      } else {
        await api.patch(`/organizations/${organization!.id}`, payload);
        toast.success("Сохранено");
      }
      onSaved();
    } catch (err) {
      handleApiError(err);
    }
  }

  const type = form.watch("type");
  const isIp = type === "IP";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isNew ? "Новая организация" : `Редактирование: ${organization!.name}`}</DialogTitle>
          <DialogDescription>Реквизиты используются при формировании документов и PDF.</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Тип</Label>
              <Select value={type} onValueChange={(v) => form.setValue("type", v as OrgForm["type"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ORG_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Система налогообложения</Label>
              <Select value={form.watch("taxSystem")} onValueChange={(v) => form.setValue("taxSystem", v as OrgForm["taxSystem"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TAX_SYSTEMS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <FormField label="Краткое наименование" error={form.formState.errors.name?.message}>
            <Input {...form.register("name")} placeholder="ООО Альфа" />
          </FormField>
          <FormField label="Полное наименование" error={form.formState.errors.fullName?.message}>
            <Input {...form.register("fullName")} placeholder={`Общество с ограниченной ответственностью "Альфа"`} />
          </FormField>

          <div className="grid grid-cols-3 gap-3">
            <FormField label={`ИНН${isIp ? " (12 цифр)" : " (10 цифр)"}`} error={form.formState.errors.inn?.message}>
              <Input {...form.register("inn")} className="font-mono" />
            </FormField>
            {!isIp ? (
              <FormField label="КПП" error={form.formState.errors.kpp?.message}>
                <Input {...form.register("kpp")} className="font-mono" />
              </FormField>
            ) : (
              <div />
            )}
            <FormField label="ОГРН">
              <Input {...form.register("ogrn")} className="font-mono" />
            </FormField>
          </div>

          {isIp ? (
            <FormField label="ФИО предпринимателя">
              <Input {...form.register("entrepreneurName")} />
            </FormField>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Руководитель (ФИО)">
                <Input {...form.register("directorName")} />
              </FormField>
              <FormField label="Должность руководителя">
                <Input {...form.register("directorPosition")} placeholder="Генеральный директор" />
              </FormField>
            </div>
          )}
          <FormField label="Главный бухгалтер">
            <Input {...form.register("chiefAccountant")} />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Email" error={form.formState.errors.email?.message}>
              <Input type="email" {...form.register("email")} />
            </FormField>
            <FormField label="Телефон">
              <Input {...form.register("phone")} />
            </FormField>
          </div>

          <FormField label="Юридический адрес" error={form.formState.errors.legalAddress?.message}>
            <Textarea {...form.register("legalAddress")} rows={2} />
          </FormField>
          <FormField label="Фактический адрес (если отличается)">
            <Textarea {...form.register("actualAddress")} rows={2} />
          </FormField>

          <FormField label="Режим НДС">
            <Select value={form.watch("vatMode")} onValueChange={(v) => form.setValue("vatMode", v as OrgForm["vatMode"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {VAT_MODES.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    <div>
                      <div>{m.label}</div>
                      <div className="text-xs text-muted-foreground">{m.description}</div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="text-xs text-muted-foreground mt-1">
              С 2026 года УСН становится плательщиком НДС при доходе &gt; 20 млн ₽ (ФЗ № 425-ФЗ).
            </div>
          </FormField>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...form.register("isDefault")} /> Основная организация
          </label>

          {!isNew ? (
            <>
              <Separator />
              <BankAccountsEditor organizationId={organization!.id} accounts={organization!.bankAccounts} />
            </>
          ) : (
            <div className="text-xs text-muted-foreground">
              Банковские реквизиты можно добавить после сохранения организации.
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? "Сохранение..." : "Сохранить"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function BankAccountsEditor({ organizationId, accounts }: { organizationId: string; accounts: BankAccount[] }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["organizations"] });

  const baSchema = z.object({
    bankName: z.string().min(1, "Укажите банк"),
    bik: z.string().refine(isValidBik, "БИК: 9 цифр, начинается с 04"),
    account: z.string().refine(isValidAccount, "Счёт — 20 цифр"),
    corrAccount: z.string().refine(isValidAccount, "Корр.счёт — 20 цифр"),
    isDefault: z.boolean(),
  });
  type Ba = z.infer<typeof baSchema>;

  const form = useForm<Ba>({
    resolver: zodResolver(baSchema),
    defaultValues: { bankName: "", bik: "", account: "", corrAccount: "", isDefault: false },
  });

  async function add(values: Ba) {
    try {
      await api.post(`/organizations/${organizationId}/bank-accounts`, values);
      form.reset();
      refresh();
      toast.success("Счёт добавлен");
    } catch (err) { handleApiError(err); }
  }

  async function remove(id: string) {
    if (!confirm("Удалить расчётный счёт?")) return;
    try {
      await api.delete(`/organizations/${organizationId}/bank-accounts/${id}`);
      refresh();
    } catch (err) { handleApiError(err); }
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Банковские счета</h3>
      {accounts.length > 0 ? (
        <div className="space-y-1.5">
          {accounts.map((a) => (
            <div key={a.id} className="flex items-center justify-between rounded border p-2 text-sm">
              <div>
                <div className="font-medium">{a.bankName}</div>
                <div className="text-xs text-muted-foreground font-mono">БИК {a.bik} • р/с {a.account}</div>
              </div>
              <div className="flex items-center gap-2">
                {a.isDefault ? <Badge variant="secondary">основной</Badge> : null}
                <Button type="button" variant="ghost" size="icon" onClick={() => remove(a.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">Счетов пока нет</div>
      )}
      <div className="grid grid-cols-2 gap-2 rounded-md border p-3 bg-muted/30">
        <FormField label="Банк">
          <Input {...form.register("bankName")} placeholder="ПАО Сбербанк" />
        </FormField>
        <FormField label="БИК" error={form.formState.errors.bik?.message}>
          <Input {...form.register("bik")} className="font-mono" />
        </FormField>
        <FormField label="Расчётный счёт" error={form.formState.errors.account?.message}>
          <Input {...form.register("account")} className="font-mono" />
        </FormField>
        <FormField label="Корр.счёт" error={form.formState.errors.corrAccount?.message}>
          <Input {...form.register("corrAccount")} className="font-mono" />
        </FormField>
        <label className="flex items-center gap-2 text-sm col-span-2">
          <input type="checkbox" {...form.register("isDefault")} /> Сделать основным
        </label>
        <Button type="button" className="col-span-2" onClick={form.handleSubmit(add)}>
          <Plus className="h-4 w-4" /> Добавить счёт
        </Button>
      </div>
    </div>
  );
}

export function FormField({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
      {error ? <div className="text-xs text-destructive">{error}</div> : null}
    </div>
  );
}
