// Форматирование значений в UI (повторяет логику backend/src/pdf/lib/format.ts).

const NBSP = " ";

export function formatAmount(value: number | string | null | undefined, opts?: { withCurrency?: boolean }): string {
  if (value == null || value === "") return "";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (!isFinite(num)) return "";
  const [intPart, fracPart = "00"] = num.toFixed(2).split(".");
  const intGrouped = (intPart ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return opts?.withCurrency ? `${intGrouped},${fracPart} ₽` : `${intGrouped},${fracPart}`;
}

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
