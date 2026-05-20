import { type ReactNode } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronLeft, ChevronRight, ChevronsUpDown, ArrowDown, ArrowUp, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  header: string;
  align?: "left" | "right" | "center";
  cell: (row: T) => ReactNode;
  width?: string;
  /** Если задано — заголовок становится кликабельным и шлёт sortBy на сервер. */
  sortKey?: string;
}

export interface SortState {
  field: string;
  dir: "asc" | "desc";
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  total?: number;
  page?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
  search?: string;
  onSearchChange?: (q: string) => void;
  searchPlaceholder?: string;
  loading?: boolean;
  empty?: ReactNode;
  toolbar?: ReactNode;
  sort?: SortState | null;
  onSortChange?: (next: SortState | null) => void;
}

export function DataTable<T>({
  columns, rows, rowKey, onRowClick,
  total, page = 1, pageSize = 20, onPageChange,
  search, onSearchChange, searchPlaceholder = "Поиск...",
  loading, empty = "Записей не найдено", toolbar,
  sort, onSortChange,
}: DataTableProps<T>) {
  const totalPages = total !== undefined ? Math.max(1, Math.ceil(total / pageSize)) : 1;

  function cycleSort(col: Column<T>) {
    if (!col.sortKey || !onSortChange) return;
    if (!sort || sort.field !== col.sortKey) {
      onSortChange({ field: col.sortKey, dir: "asc" });
    } else if (sort.dir === "asc") {
      onSortChange({ field: col.sortKey, dir: "desc" });
    } else {
      onSortChange(null);   // третий клик — сброс
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {onSearchChange ? (
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search ?? ""}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={searchPlaceholder}
              className="pl-8"
            />
          </div>
        ) : null}
        <div className="ml-auto flex items-center gap-2">{toolbar}</div>
      </div>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((c) => {
                const active = sort?.field === c.sortKey;
                const sortable = !!c.sortKey && !!onSortChange;
                return (
                  <TableHead
                    key={c.key}
                    style={{ width: c.width, textAlign: c.align ?? "left" }}
                    aria-sort={active ? (sort?.dir === "asc" ? "ascending" : "descending") : undefined}
                    className={cn(sortable && "cursor-pointer select-none hover:text-foreground")}
                    onClick={sortable ? () => cycleSort(c) : undefined}
                  >
                    <span className="inline-flex items-center gap-1">
                      {c.header}
                      {sortable ? (
                        active ? (
                          sort?.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                        ) : (
                          <ChevronsUpDown className="h-3 w-3 opacity-40" />
                        )
                      ) : null}
                    </span>
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="text-center text-muted-foreground py-8">
                  Загрузка...
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="text-center text-muted-foreground py-8">
                  {empty}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow
                  key={rowKey(r)}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                  className={onRowClick ? "cursor-pointer" : undefined}
                >
                  {columns.map((c) => (
                    <TableCell key={c.key} style={{ textAlign: c.align ?? "left" }}>
                      {c.cell(r)}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {total !== undefined && total > pageSize && onPageChange ? (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <div>Всего: {total}</div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span>
              {page} / {totalPages}
            </span>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
