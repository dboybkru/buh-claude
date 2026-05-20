import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Upload, FileDown, AlertCircle, CheckCircle2, SkipForward, Loader2 } from "lucide-react";
import { api, getToken } from "@/lib/api";
import { handleApiError } from "@/lib/errors";
import { fetchAuthorizedBlob, triggerDownload } from "@/lib/download";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { FormField } from "@/pages/Organizations";

type ImportType = "counterparties" | "nomenclature" | "payments";

const TYPE_LABELS: Record<ImportType, string> = {
  counterparties: "Контрагенты",
  nomenclature: "Номенклатура",
  payments: "Платежи (банковская выписка)",
};

interface PreviewLine {
  row: number;
  data: Record<string, string>;
  status: "ok" | "skipped" | "error";
  errors?: string[];
  preview?: Record<string, unknown>;
}

interface PreviewResult {
  dryRun: boolean;
  total: number;
  created: number;
  skipped: number;
  failed: number;
  lines: PreviewLine[];
}

interface OrgOpt { id: string; name: string }

export function ImportPage() {
  const [type, setType] = useState<ImportType>("counterparties");
  const [organizationId, setOrganizationId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [working, setWorking] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const orgs = useQuery({
    queryKey: ["orgs-opts"],
    queryFn: async () => (await api.get<{ items: OrgOpt[] }>("/organizations", { params: { pageSize: 200 } })).data.items,
  });

  async function downloadTemplate() {
    try {
      const { blob, filename } = await fetchAuthorizedBlob(`/api/v1/imports/templates/${type}`, `Шаблон-${type}.xlsx`);
      triggerDownload(blob, filename);
    } catch (err) {
      handleApiError(err, "Не удалось скачать шаблон");
    }
  }

  async function uploadFile(dryRun: boolean) {
    if (!file) {
      toast.error("Выберите файл");
      return;
    }
    if (type === "payments" && !organizationId) {
      toast.error("Для платежей укажите организацию");
      return;
    }
    setWorking(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("dryRun", String(dryRun));
      if (organizationId) fd.append("organizationId", organizationId);
      const r = await fetch(`/api/v1/imports/${type}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
        body: fd,
      });
      const data = await r.json();
      if (!r.ok) {
        const code = data?.error?.code ?? "Error";
        const msg = data?.error?.message ?? "Не удалось импортировать";
        toast.error(`${code}: ${msg}`);
        return;
      }
      setPreview(data);
      if (!dryRun) toast.success(`Импорт завершён: создано ${data.created}`);
    } catch (err) {
      handleApiError(err);
    } finally {
      setWorking(false);
    }
  }

  function resetState() {
    setFile(null);
    setPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function onTypeChange(t: ImportType) {
    setType(t);
    resetState();
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <Upload className="h-6 w-6" /> Импорт данных
      </h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Шаг 1. Загрузить файл</CardTitle>
          <CardDescription>
            Поддерживаются файлы XLSX и CSV (UTF-8, разделитель ';' или ','). Скачайте шаблон, чтобы увидеть нужные колонки.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Что импортируем">
              <Select value={type} onValueChange={(v) => onTypeChange(v as ImportType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(TYPE_LABELS) as ImportType[]).map((k) => (
                    <SelectItem key={k} value={k}>{TYPE_LABELS[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            {type === "payments" ? (
              <FormField label="Организация (получатель)">
                <Select value={organizationId} onValueChange={setOrganizationId}>
                  <SelectTrigger><SelectValue placeholder="Выберите..." /></SelectTrigger>
                  <SelectContent>
                    {orgs.data?.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FormField>
            ) : <div />}
          </div>

          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={downloadTemplate}>
              <FileDown className="h-4 w-4" /> Скачать шаблон
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.csv"
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); }}
              className="text-sm flex-1"
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={() => uploadFile(true)} disabled={!file || working} variant="secondary">
              {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Проверить (dry-run)
            </Button>
            <Button onClick={() => uploadFile(false)} disabled={!preview || working || preview.created === 0}>
              {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Импортировать
            </Button>
            {preview ? (
              <Button variant="ghost" onClick={resetState}>Сбросить</Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {preview ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              {preview.dryRun ? "Шаг 2. Превью (без сохранения)" : "Итоги импорта"}
            </CardTitle>
            <CardDescription>
              Всего строк: {preview.total} • ✓ {preview.created} создано/создадутся • ↻ {preview.skipped} пропущено • ✗ {preview.failed} ошибок
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto border rounded-md max-h-[500px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 sticky top-0">
                  <tr className="text-left">
                    <th className="p-2 w-12">№</th>
                    <th className="p-2 w-24">Статус</th>
                    <th className="p-2">Данные</th>
                    <th className="p-2 w-1/3">Ошибки / Превью</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.lines.map((l) => (
                    <tr key={l.row} className="border-b last:border-0">
                      <td className="p-2 text-muted-foreground">{l.row}</td>
                      <td className="p-2">
                        {l.status === "ok" ? (
                          <Badge variant="success"><CheckCircle2 className="h-3 w-3 mr-1" />ok</Badge>
                        ) : l.status === "skipped" ? (
                          <Badge variant="secondary"><SkipForward className="h-3 w-3 mr-1" />skip</Badge>
                        ) : (
                          <Badge variant="destructive"><AlertCircle className="h-3 w-3 mr-1" />error</Badge>
                        )}
                      </td>
                      <td className="p-2 text-xs">
                        {Object.entries(l.data).slice(0, 3).map(([k, v]) => (
                          <div key={k}><span className="text-muted-foreground">{k}:</span> {v}</div>
                        ))}
                      </td>
                      <td className="p-2 text-xs">
                        {l.errors && l.errors.length > 0 ? (
                          <div className="text-destructive">{l.errors.join("; ")}</div>
                        ) : l.preview ? (
                          <div className="text-muted-foreground">→ {Object.entries(l.preview).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(", ")}</div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
