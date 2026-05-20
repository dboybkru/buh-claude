import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Download, FileText } from "lucide-react";
import { api } from "@/lib/api";
import { handleApiError } from "@/lib/errors";
import { useDebouncedValue } from "@/lib/hooks";
import { fetchAuthorizedBlob, triggerDownload } from "@/lib/download";
import { DataTable, type Page } from "@/components/DataTable";
import { useUrlSort, sortQueryParam } from "@/lib/use-sort";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatAmount, formatDate } from "@/lib/format";
import { DOCS, type DocKind, statusLabel, statusVariant, isLocked } from "@/lib/documents-config";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const dq = useDebouncedValue(q, 300);
  const [sort, setSort] = useUrlSort({ field: "date", dir: "desc" });

  const list = useQuery({
    queryKey: [kind, { page, q: dq, statusFilter, sort }],
    queryFn: async () =>
      (await api.get<Page<DocRow>>(cfg.apiPath, {
        params: {
          page, pageSize: 20,
          q: dq || undefined,
          status: statusFilter !== "all" ? statusFilter : undefined,
          sort: sortQueryParam(sort),
        },
      })).data,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`${cfg.apiPath}/${id}`),
    onSuccess: () => { toast.success("Удалено"); qc.invalidateQueries({ queryKey: [kind] }); },
    onError: (e) => handleApiError(e, "Не удалось удалить"),
  });

  async function downloadExport(ext: "csv" | "xlsx") {
    try {
      const { blob, filename } = await fetchAuthorizedBlob(`/api/v1/export/${kind}.${ext}`, `${kind}.${ext}`);
      triggerDownload(blob, filename);
    } catch (err) {
      handleApiError(err, "Не удалось скачать экспорт");
    }
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
        toolbar={
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="w-[180px]" aria-label="Фильтр по статусу">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все статусы</SelectItem>
              {cfg.statuses.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
        sort={sort}
        onSortChange={(next) => { setSort(next); setPage(1); }}
        columns={[
          {
            key: "number",
            header: "Номер / дата",
            sortKey: "date",
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
          { key: "total", header: "Сумма", width: "140px", align: "right", sortKey: "total", cell: (d) => <span className="font-mono font-medium">{formatAmount(d.total, { withCurrency: true })}</span> },
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
