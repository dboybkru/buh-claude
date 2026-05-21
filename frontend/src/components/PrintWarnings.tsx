import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertTriangle, AlertCircle, Info } from "lucide-react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";

export type PrintWarningSeverity = "error" | "warning" | "info";

export interface PrintWarning {
  code: string;
  severity: PrintWarningSeverity;
  message: string;
  field?: string;
}

interface ActionLink {
  label: string;
  to: string;
}

interface ActionContext {
  organizationId?: string | null;
  documentRoute?: string | null;
}

/** Маппинг warning.code → ссылка действия. Возвращает null, если действия нет. */
function actionFor(w: PrintWarning, ctx: ActionContext): ActionLink | null {
  const org = ctx.organizationId;
  switch (w.code) {
    case "org.missing":
      return { label: "Выбрать организацию", to: "/organizations" };
    case "org.inn":
    case "org.kpp":
    case "org.address":
    case "org.director":
      return org ? { label: "Заполнить реквизиты", to: `/organizations?focus=${org}` } : { label: "Заполнить реквизиты", to: "/organizations" };
    case "org.logo":
    case "org.stamp":
    case "org.signature":
      return org ? { label: "Загрузить изображение", to: `/organizations?focus=${org}` } : null;
    case "bank.missing":
      return org ? { label: "Добавить расчётный счёт", to: `/organizations?focus=${org}` } : null;
    case "cp.missing":
    case "cp.inn":
    case "cp.name":
      return { label: "Открыть контрагента", to: "/counterparties" };
    case "items.empty":
      return ctx.documentRoute ? { label: "Добавить позиции", to: ctx.documentRoute } : null;
    case "contract.subject":
      return { label: "Указать предмет договора", to: "/contracts" };
    default:
      return null;
  }
}

function severityIcon(severity: PrintWarningSeverity) {
  if (severity === "error") return <AlertCircle className="h-4 w-4 text-destructive" aria-label="Ошибка" />;
  if (severity === "warning") return <AlertTriangle className="h-4 w-4 text-yellow-700" aria-label="Предупреждение" />;
  return <Info className="h-4 w-4 text-sky-700" aria-label="Информация" />;
}

const SEVERITY_LABEL: Record<PrintWarningSeverity, string> = {
  error: "Критично",
  warning: "Предупреждение",
  info: "Рекомендация",
};

const SEVERITY_ORDER: PrintWarningSeverity[] = ["error", "warning", "info"];

export interface PrintWarningsResponse {
  warnings: PrintWarning[];
}

/** Хук — возвращает результат + счётчики. Используется и компонентом, и бейджем у кнопки. */
export function usePrintWarnings(url: string | null) {
  return useQuery({
    queryKey: ["print-warnings", url],
    queryFn: async () => (await api.get<PrintWarningsResponse>(url!)).data,
    enabled: !!url,
  });
}

interface PrintWarningsProps {
  url: string;
  organizationId?: string | null;
  documentRoute?: string | null;
}

export function PrintWarnings({ url, organizationId, documentRoute }: PrintWarningsProps) {
  const q = usePrintWarnings(url);
  const warnings = q.data?.warnings ?? [];
  if (q.isLoading || warnings.length === 0) return null;

  const ctx: ActionContext = { organizationId, documentRoute };

  return (
    <div className="rounded-md border bg-yellow-50 dark:bg-yellow-950/30 p-3 text-sm">
      <div className="font-semibold mb-2 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-yellow-700" />
        Перед отправкой документа проверьте ({warnings.length}):
      </div>
      <ul className="space-y-1.5">
        {SEVERITY_ORDER.flatMap((sev) =>
          warnings
            .filter((w) => w.severity === sev)
            .map((w) => {
              const action = actionFor(w, ctx);
              return (
                <li key={w.code} className="flex items-start gap-2">
                  <span className="mt-0.5">{severityIcon(w.severity)}</span>
                  <div className="flex-1">
                    <span className={
                      w.severity === "error"
                        ? "text-destructive"
                        : w.severity === "warning"
                          ? "text-yellow-900 dark:text-yellow-100"
                          : "text-sky-900 dark:text-sky-100"
                    }>
                      {w.message}
                    </span>
                    {action ? (
                      <Link
                        to={action.to}
                        className="ml-2 text-xs underline underline-offset-2 hover:no-underline"
                      >
                        {action.label}
                      </Link>
                    ) : null}
                  </div>
                </li>
              );
            }),
        )}
      </ul>
    </div>
  );
}

/** Бейдж со счётчиком предупреждений — для размещения рядом с кнопками Preview/PDF. */
export function PrintWarningsBadge({ url }: { url: string }) {
  const q = usePrintWarnings(url);
  const warnings = q.data?.warnings ?? [];
  if (q.isLoading || warnings.length === 0) return null;
  const errors = warnings.filter((w) => w.severity === "error").length;
  const variant: "destructive" | "warning" = errors > 0 ? "destructive" : "warning";
  return (
    <Badge variant={variant} title={`${warnings.length} замечани${warnings.length === 1 ? "е" : warnings.length < 5 ? "я" : "й"} к документу`}>
      {warnings.length}
    </Badge>
  );
}

void SEVERITY_LABEL; // экспортируется на будущее, пока не используется напрямую
