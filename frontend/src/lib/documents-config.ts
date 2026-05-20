// Конфигурация per тип документа: путь API, человеческие названия, варианты статусов.

export type DocKind = "invoices" | "acts" | "upds" | "waybills";

export const DOCS: Record<DocKind, {
  apiPath: string;
  routePath: string;
  titleSingular: string;
  titlePlural: string;
  numberPrefix: string;
  statuses: Array<{ value: string; label: string; variant: "default" | "secondary" | "destructive" | "success" | "warning" | "outline" }>;
  defaultVatIncluded: boolean;
  /** Можно ли менять status назад на DRAFT через PATCH */
  lockedStatuses: string[];
}> = {
  invoices: {
    apiPath: "/invoices",
    routePath: "/invoices",
    titleSingular: "Счёт",
    titlePlural: "Счета на оплату",
    numberPrefix: "СЧ-",
    statuses: [
      { value: "DRAFT", label: "Черновик", variant: "secondary" },
      { value: "SENT", label: "Выставлен", variant: "warning" },
      { value: "PARTIALLY_PAID", label: "Частично оплачен", variant: "warning" },
      { value: "PAID", label: "Оплачен", variant: "success" },
      { value: "OVERDUE", label: "Просрочен", variant: "destructive" },
      { value: "CANCELLED", label: "Аннулирован", variant: "destructive" },
    ],
    defaultVatIncluded: true,
    lockedStatuses: ["PAID", "CANCELLED"],
  },
  acts: {
    apiPath: "/acts",
    routePath: "/acts",
    titleSingular: "Акт",
    titlePlural: "Акты выполненных работ",
    numberPrefix: "АКТ-",
    statuses: [
      { value: "DRAFT", label: "Черновик", variant: "secondary" },
      { value: "SENT", label: "Отправлен", variant: "warning" },
      { value: "ACCEPTED", label: "Принят", variant: "success" },
      { value: "REJECTED", label: "Отклонён", variant: "destructive" },
      { value: "SIGNED", label: "Подписан", variant: "success" },
      { value: "PAID", label: "Оплачен", variant: "success" },
      { value: "CANCELLED", label: "Аннулирован", variant: "destructive" },
    ],
    defaultVatIncluded: true,
    lockedStatuses: ["SIGNED", "ACCEPTED", "PAID", "CANCELLED"],
  },
  upds: {
    apiPath: "/upds",
    routePath: "/upds",
    titleSingular: "УПД",
    titlePlural: "Универсальные передаточные документы",
    numberPrefix: "УПД-",
    statuses: [
      { value: "DRAFT", label: "Черновик", variant: "secondary" },
      { value: "SENT", label: "Отправлен", variant: "warning" },
      { value: "ACCEPTED", label: "Принят", variant: "success" },
      { value: "SIGNED", label: "Подписан", variant: "success" },
      { value: "REJECTED", label: "Отклонён", variant: "destructive" },
      { value: "CANCELLED", label: "Аннулирован", variant: "destructive" },
    ],
    defaultVatIncluded: false,
    lockedStatuses: ["SIGNED", "ACCEPTED", "PAID", "CANCELLED"],
  },
  waybills: {
    apiPath: "/waybills",
    routePath: "/waybills",
    titleSingular: "ТОРГ-12",
    titlePlural: "Товарные накладные",
    numberPrefix: "ТН-",
    statuses: [
      { value: "DRAFT", label: "Черновик", variant: "secondary" },
      { value: "SENT", label: "Отправлен", variant: "warning" },
      { value: "ACCEPTED", label: "Принят", variant: "success" },
      { value: "SIGNED", label: "Подписан", variant: "success" },
      { value: "CANCELLED", label: "Аннулирован", variant: "destructive" },
    ],
    defaultVatIncluded: true,
    lockedStatuses: ["SIGNED", "ACCEPTED", "PAID", "CANCELLED"],
  },
};

export function statusLabel(kind: DocKind, status: string): string {
  return DOCS[kind].statuses.find((s) => s.value === status)?.label ?? status;
}

export function statusVariant(kind: DocKind, status: string) {
  return DOCS[kind].statuses.find((s) => s.value === status)?.variant ?? "secondary";
}

export function isLocked(kind: DocKind, status: string): boolean {
  return DOCS[kind].lockedStatuses.includes(status);
}
