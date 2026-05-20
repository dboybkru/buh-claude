import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Download, FileText } from "lucide-react";
import { api, getToken } from "@/lib/api";
import { handleApiError } from "@/lib/errors";
import { useDebouncedValue } from "@/lib/hooks";
import { DataTable, type Page } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatAmount, formatDate } from "@/lib/format";
import { DOCS, type DocKind, statusLabel, statusVariant, isLocked } from "@/lib/documents-config";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface DocRow {
  id: string;
  number: string;
  date: string;
  status: string;
  total: string;
  organization?: { id: string; name: string };
  counterparty?: { id: string; name: string; inn: string };
}

export function DocumentsListPage({ kind }: { kind: DocKind }) {
  const cfg = DOCS[kind];
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const dq = useDebouncedValue(q, 300);

  const list = useQuery({
    queryKey: [kind, { page, q: dq }],
    queryFn: async () =>
      (await api.get<Page<DocRow>>(cfg.apiPath, { params: { page, pageSize: 20, q: dq || undefined } })).data,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`${cfg.apiPath}/${id}`),
    onSuccess: () => { toast.success("Удалено"); qc.invalidateQueries({ queryKey: [kind] }); },
    onError: (e) => handleApiError(e, "Не удалось удалить"),
  });

  function downloadExport(ext: "csv" | "xlsx") {
    const url = `/api/v1/export/${kind}.${ext}`;
    fetch(url, { headers: { Authorization: `Bearer ${getToken() ?? ""}` } })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const blob = await r.blob();
        const cd = r.headers.get("content-disposition") ?? "";
        const m = cd.match(/filename\*=UTF-8''([^;]+)/i);
        const filename = m ? decodeURIComponent(m[1]!) : `${kind}.${ext}`;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch((err) => handleApiError(err, "Не удалось скачать экспорт"));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{cfg.titlePlural}</h1>
        <div className="flex gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline"><Download className="h-4 w-4" /> Экспорт</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => downloadExport("xlsx")}>В Excel (.xlsx)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => downloadExport("csv")}>В CSV</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={() => navigate(`${cfg.routePath}/new`)}>
            <Plus className="h-4 w-4" /> Создать
          </Button>
        </div>
      </div>

      <DataTable
        rows={list.data?.items ?? []}
        rowKey={(d) => d.id}
        total={list.data?.total}
        page={page} pageSize={20} onPageChange={setPage}
        search={q} onSearchChange={setQ}
        searchPlaceholder="Номер или контрагент"
        loading={list.isLoading}
        empty={`${cfg.titleSingular.toLowerCase()}ов пока нет. Создайте первый.`}
        columns={[
          {
            key: "number",
            header: "Номер / дата",
            cell: (d) => (
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <div>
                  <div className="font-medium font-mono text-sm">{d.number}</div>
                  <div className="text-xs text-muted-foreground">{formatDate(d.date)}</div>
                </div>
              </div>
            ),
          },
          { key: "cp", header: "Контрагент", cell: (d) => <div><div>{d.counterparty?.name ?? "—"}</div><div className="text-xs text-muted-foreground">{d.counterparty?.inn ?? ""}</div></div> },
          { key: "total", header: "Сумма", width: "140px", align: "right", cell: (d) => <span className="font-mono font-medium">{formatAmount(d.total, { withCurrency: true })}</span> },
          { key: "status", header: "Статус", width: "140px", cell: (d) => <Badge variant={statusVariant(kind, d.status)}>{statusLabel(kind, d.status)}</Badge> },
          {
            key: "actions",
            header: "",
            width: "60px",
            align: "right",
            cell: (d) => (
              <Button
                variant="ghost"
                size="icon"
                disabled={isLocked(kind, d.status)}
                title={isLocked(kind, d.status) ? "Документ заблокирован" : "Удалить"}
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Удалить ${d.number}?`)) remove.mutate(d.id);
                }}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            ),
          },
        ]}
        onRowClick={(d) => navigate(`${cfg.routePath}/${d.id}`)}
      />
    </div>
  );
}
