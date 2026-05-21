import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";

export interface PrintWarning {
  code: string;
  severity: "warning" | "error";
  message: string;
  field?: string;
}

export function PrintWarnings({ url }: { url: string }) {
  const q = useQuery({
    queryKey: ["print-warnings", url],
    queryFn: async () => (await api.get<{ warnings: PrintWarning[] }>(url)).data,
  });
  const warnings = q.data?.warnings ?? [];
  if (q.isLoading || warnings.length === 0) return null;

  const errors = warnings.filter((w) => w.severity === "error");
  const warns = warnings.filter((w) => w.severity === "warning");
  return (
    <div className="rounded-md border bg-yellow-50 dark:bg-yellow-950/30 p-3 text-sm">
      <div className="font-semibold mb-1 flex items-center gap-2">
        {errors.length > 0 ? (
          <AlertCircle className="h-4 w-4 text-destructive" />
        ) : (
          <AlertTriangle className="h-4 w-4 text-yellow-700" />
        )}
        Перед отправкой документа проверьте:
      </div>
      <ul className="list-disc pl-6 space-y-0.5">
        {errors.map((w) => (
          <li key={w.code} className="text-destructive">
            <span className="font-medium">[ошибка]</span> {w.message}
          </li>
        ))}
        {warns.map((w) => (
          <li key={w.code} className="text-yellow-800 dark:text-yellow-200">
            {w.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
