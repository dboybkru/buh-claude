import { useSearchParams } from "react-router-dom";
import type { SortState } from "@/components/DataTable";

/** Сортировка состоит в URL как ?sort=field:dir. */
export function useUrlSort(defaultSort: SortState | null = null): [SortState | null, (next: SortState | null) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get("sort");
  let current: SortState | null = defaultSort;
  if (raw) {
    const [f, d] = raw.split(":");
    if (f) current = { field: f, dir: d === "desc" ? "desc" : "asc" };
  }
  function set(next: SortState | null): void {
    const p = new URLSearchParams(params);
    if (next) p.set("sort", `${next.field}:${next.dir}`);
    else p.delete("sort");
    setParams(p, { replace: true });
  }
  return [current, set];
}

export function sortQueryParam(s: SortState | null): string | undefined {
  return s ? `${s.field}:${s.dir}` : undefined;
}
