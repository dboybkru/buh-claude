import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatAmount, formatDate } from "@/lib/format";
import { AlertCircle, Building2, Users, Package, FileSignature, Receipt, Wallet } from "lucide-react";
import { VatCalculator } from "@/components/VatCalculator";

interface DashboardData {
  counters: Record<string, number>;
  invoices: { byStatus: Array<{ status: string; count: number; total: number }> };
  revenue: { year: number; month: number; byMonth: Array<{ month: string; revenue: number }> };
  topCounterparties: Array<{ counterpartyId: string; name: string; inn: string; total: number; count: number }>;
  contracts: { expiringSoon: Array<{ id: string; number: string; expiryDate: string; counterparty: { name: string } }>; expired: Array<{ id: string; number: string; expiryDate: string; counterparty: { name: string } }> };
  overdueInvoices: Array<{ id: string; number: string; dueDate: string; total: string; counterparty: { name: string } }>;
}

export function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => (await api.get<DashboardData>("/dashboard")).data,
  });

  if (isLoading) return <div className="text-muted-foreground">Загрузка...</div>;
  if (error || !data) return <div className="text-destructive">Не удалось загрузить данные дашборда</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Дашборд</h1>

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Выручка за год" value={formatAmount(data.revenue.year, { withCurrency: true })} icon={Wallet} />
        <KpiCard label="Выручка за месяц" value={formatAmount(data.revenue.month, { withCurrency: true })} icon={Receipt} />
        <KpiCard label="Контрагенты" value={String(data.counters.counterparties ?? 0)} icon={Users} />
        <KpiCard label="Договоры" value={String(data.counters.contracts ?? 0)} icon={FileSignature} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Invoices by status */}
        <Card>
          <CardHeader>
            <CardTitle>Счета по статусам</CardTitle>
            <CardDescription>Сводка по выпущенным счетам</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.invoices.byStatus.length === 0 ? (
              <div className="text-sm text-muted-foreground">Счетов пока нет</div>
            ) : (
              data.invoices.byStatus.map((s) => (
                <div key={s.status} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <Badge variant={statusVariant(s.status)}>{statusLabel(s.status)}</Badge>
                    <span className="text-muted-foreground">{s.count}</span>
                  </div>
                  <div className="font-medium">{formatAmount(s.total, { withCurrency: true })}</div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Top counterparties */}
        <Card>
          <CardHeader>
            <CardTitle>Топ контрагентов</CardTitle>
            <CardDescription>По обороту (все счета)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.topCounterparties.length === 0 ? (
              <div className="text-sm text-muted-foreground">Нет данных</div>
            ) : (
              data.topCounterparties.map((c) => (
                <div key={c.counterpartyId} className="flex items-center justify-between text-sm">
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{c.name}</div>
                    <div className="text-xs text-muted-foreground">ИНН {c.inn} • {c.count} счетов</div>
                  </div>
                  <div className="font-medium ml-2">{formatAmount(c.total, { withCurrency: true })}</div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Alerts */}
      {(data.overdueInvoices.length > 0 || data.contracts.expired.length > 0 || data.contracts.expiringSoon.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-500" />
              Требует внимания
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.overdueInvoices.length > 0 && (
              <div>
                <div className="text-sm font-medium mb-1">Просроченные счета</div>
                <ul className="text-sm space-y-0.5">
                  {data.overdueInvoices.map((i) => (
                    <li key={i.id} className="flex justify-between">
                      <span className="text-muted-foreground">{i.number} — {i.counterparty.name}</span>
                      <span className="font-medium">{formatAmount(i.total)} ₽ • до {formatDate(i.dueDate)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {data.contracts.expired.length > 0 && (
              <div>
                <div className="text-sm font-medium mb-1">Договоры с истёкшим сроком</div>
                <ul className="text-sm space-y-0.5">
                  {data.contracts.expired.map((c) => (
                    <li key={c.id} className="text-muted-foreground">
                      {c.number} — {c.counterparty.name} (истёк {formatDate(c.expiryDate)})
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {data.contracts.expiringSoon.length > 0 && (
              <div>
                <div className="text-sm font-medium mb-1">Договоры, истекающие в ближайшие 30 дней</div>
                <ul className="text-sm space-y-0.5">
                  {data.contracts.expiringSoon.map((c) => (
                    <li key={c.id} className="text-muted-foreground">
                      {c.number} — {c.counterparty.name} (до {formatDate(c.expiryDate)})
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Doc-type counters */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <DocCounter label="Организации" value={data.counters.organizations ?? 0} icon={Building2} />
        <DocCounter label="Счетов" value={data.counters.invoices ?? 0} icon={Receipt} />
        <DocCounter label="Актов" value={data.counters.acts ?? 0} icon={Package} />
        <DocCounter label="УПД" value={data.counters.upds ?? 0} icon={Package} />
        <DocCounter label="ТОРГ-12" value={data.counters.waybills ?? 0} icon={Package} />
      </div>

      {/* Калькулятор УСН-НДС (реформа 2026) */}
      <VatCalculator />
    </div>
  );
}

function KpiCard({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Wallet }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-xl font-bold mt-1">{value}</div>
          </div>
          <Icon className="h-5 w-5 text-muted-foreground" />
        </div>
      </CardContent>
    </Card>
  );
}

function DocCounter({ label, value, icon: Icon }: { label: string; value: number; icon: typeof Wallet }) {
  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-3">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="font-semibold">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function statusLabel(s: string): string {
  return ({
    DRAFT: "Черновик", SENT: "Выставлен", PARTIALLY_PAID: "Частично оплачен",
    PAID: "Оплачен", CANCELLED: "Аннулирован", OVERDUE: "Просрочен",
  } as Record<string, string>)[s] ?? s;
}
function statusVariant(s: string): "default" | "secondary" | "destructive" | "success" | "warning" | "outline" {
  if (s === "PAID") return "success";
  if (s === "OVERDUE" || s === "CANCELLED") return "destructive";
  if (s === "SENT" || s === "PARTIALLY_PAID") return "warning";
  return "secondary";
}
