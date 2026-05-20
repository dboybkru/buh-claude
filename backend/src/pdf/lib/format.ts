// Форматирование для документов РФ: дата дд.мм.гггг, сумма "1 234 567,89"
// (неразрывный пробел в качестве разделителя тысяч, запятая — десятичная).

const NBSP = " ";

const RU_MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatDate(d: Date | string | null | undefined): string {
  if (d == null) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "";
  return `${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}.${date.getFullYear()}`;
}

export function formatDateLong(d: Date | string | null | undefined): string {
  if (d == null) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "";
  return `«${pad2(date.getDate())}» ${RU_MONTHS[date.getMonth()]} ${date.getFullYear()} г.`;
}

export function formatAmount(n: number | string | null | undefined, opts?: { withCurrency?: boolean }): string {
  if (n == null) return "";
  const num = typeof n === "string" ? parseFloat(n) : n;
  if (isNaN(num)) return "";
  const [intPart, fracPart = "00"] = num.toFixed(2).split(".");
  const intGrouped = (intPart ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return opts?.withCurrency ? `${intGrouped},${fracPart} ₽` : `${intGrouped},${fracPart}`;
}

export function formatQuantity(n: number | string | null | undefined): string {
  if (n == null) return "";
  const num = typeof n === "string" ? parseFloat(n) : n;
  if (isNaN(num)) return "";
  // Без хвостовых нулей: 3.000 → "3", 2.500 → "2,5"
  return num
    .toFixed(3)
    .replace(/\.?0+$/, "")
    .replace(".", ",");
}
