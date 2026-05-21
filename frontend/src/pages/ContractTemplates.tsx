import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Edit, FileSignature } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { api } from "@/lib/api";
import { handleApiError } from "@/lib/errors";
import { useDebouncedValue } from "@/lib/hooks";
import { DataTable, type Page } from "@/components/DataTable";
import { FormField } from "@/pages/Organizations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface TemplateVariable {
  key: string;
  description: string;
}

interface ContractTemplate {
  id: string;
  name: string;
  description: string | null;
  content: string;
  variables: string[];
  isDefault: boolean;
  organizationId: string | null;
  organization?: { id: string; name: string } | null;
  createdAt: string;
}

const tplSchema = z.object({
  name: z.string().min(1, "Название обязательно"),
  description: z.string().optional().or(z.literal("")),
  content: z.string().min(1, "Текст шаблона обязателен"),
  isDefault: z.boolean(),
});
type TplForm = z.infer<typeof tplSchema>;

export function ContractTemplatesPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const dq = useDebouncedValue(q, 300);
  const [editing, setEditing] = useState<ContractTemplate | "new" | null>(null);

  const list = useQuery({
    queryKey: ["contract-templates", { page, q: dq }],
    queryFn: async () =>
      (await api.get<Page<ContractTemplate>>("/contract-templates", { params: { page, pageSize: 20, q: dq || undefined } })).data,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/contract-templates/${id}`),
    onSuccess: () => { toast.success("Удалено"); qc.invalidateQueries({ queryKey: ["contract-templates"] }); },
    onError: (e) => handleApiError(e, "Не удалось удалить"),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Шаблоны договоров</h1>
        <Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> Добавить</Button>
      </div>

      <DataTable
        rows={list.data?.items ?? []}
        rowKey={(t) => t.id}
        total={list.data?.total}
        page={page} pageSize={20} onPageChange={setPage}
        search={q} onSearchChange={setQ}
        searchPlaceholder="Название или описание"
        loading={list.isLoading}
        empty="Шаблонов пока нет"
        columns={[
          {
            key: "name", header: "Название",
            cell: (t) => (
              <div className="flex items-center gap-2">
                <FileSignature className="h-4 w-4 text-muted-foreground" />
                <div>
                  <div className="font-medium">{t.name}</div>
                  {t.description ? <div className="text-xs text-muted-foreground">{t.description}</div> : null}
                </div>
                {t.isDefault ? <Badge className="ml-1" variant="secondary">по умолчанию</Badge> : null}
              </div>
            ),
          },
          { key: "vars", header: "Переменные", cell: (t) => <span className="text-xs font-mono">{t.variables.length}</span>, width: "100px" },
          {
            key: "actions", header: "", width: "100px", align: "right",
            cell: (t) => (
              <div className="flex gap-1 justify-end">
                <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); setEditing(t); }}>
                  <Edit className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); if (confirm(`Удалить шаблон «${t.name}»?`)) remove.mutate(t.id); }}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ),
          },
        ]}
        onRowClick={(t) => setEditing(t)}
      />

      {editing ? (
        <TplDialog
          template={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ["contract-templates"] }); }}
        />
      ) : null}
    </div>
  );
}

function TplDialog({ template, onClose, onSaved }: { template: ContractTemplate | null; onClose: () => void; onSaved: () => void }) {
  const isNew = !template;
  const form = useForm<TplForm>({
    resolver: zodResolver(tplSchema),
    defaultValues: template ? {
      name: template.name, description: template.description ?? "", content: template.content, isDefault: template.isDefault,
    } : { name: "", description: "", content: "", isDefault: false },
  });
  const [previewHtml, setPreviewHtml] = useState<string>("");
  const [missing, setMissing] = useState<string[]>([]);
  const [unknown, setUnknown] = useState<string[]>([]);

  const variablesQuery = useQuery({
    queryKey: ["template-variables"],
    queryFn: async () => (await api.get<{ variables: TemplateVariable[] }>("/contract-templates/variables")).data.variables,
  });

  async function refreshPreview() {
    const content = form.getValues("content");
    if (!content) return;
    try {
      const r = await api.post<{ text: string; missing: string[]; unknown: string[] }>("/contract-templates/render-preview", { content });
      setPreviewHtml(r.data.text);
      setMissing(r.data.missing);
      setUnknown(r.data.unknown);
    } catch (err) {
      handleApiError(err);
    }
  }

  async function onSubmit(v: TplForm) {
    const payload = { ...v, description: v.description || null };
    try {
      if (isNew) await api.post("/contract-templates", payload);
      else await api.patch(`/contract-templates/${template!.id}`, payload);
      toast.success("Сохранено");
      onSaved();
    } catch (err) { handleApiError(err); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isNew ? "Новый шаблон договора" : `Редактирование: ${template!.name}`}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
          <FormField label="Название" error={form.formState.errors.name?.message}>
            <Input {...form.register("name")} />
          </FormField>
          <FormField label="Описание">
            <Input {...form.register("description")} />
          </FormField>
          <FormField label="Текст шаблона" error={form.formState.errors.content?.message}>
            <Textarea {...form.register("content")} rows={14} className="font-mono text-xs" />
          </FormField>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...form.register("isDefault")} /> По умолчанию для новых договоров
          </label>

          <Separator />

          <div className="rounded-md border p-3 space-y-2 text-xs">
            <div className="font-semibold">Доступные переменные</div>
            <div className="grid grid-cols-2 gap-y-1 gap-x-3">
              {variablesQuery.data?.map((v) => (
                <div key={v.key}>
                  <span className="font-mono">{`{{${v.key}}}`}</span> — <span className="text-muted-foreground">{v.description}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Button type="button" variant="secondary" onClick={refreshPreview}>Предпросмотр рендера</Button>
            {previewHtml ? (
              <div className="rounded-md border bg-muted/30 p-3 text-xs whitespace-pre-wrap font-mono max-h-64 overflow-y-auto">
                {previewHtml}
              </div>
            ) : null}
            {missing.length > 0 ? (
              <div className="text-xs text-amber-700">Без значения: <span className="font-mono">{missing.join(", ")}</span></div>
            ) : null}
            {unknown.length > 0 ? (
              <div className="text-xs text-destructive">Неизвестные переменные (опечатка?): <span className="font-mono">{unknown.join(", ")}</span></div>
            ) : null}
          </div>

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
