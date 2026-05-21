// Шаблоны договоров: извлечение переменных и подстановка значений.
// Синтаксис: {{path.to.value}}. Незаполненные переменные остаются в тексте
// и возвращаются как warnings (для подсветки в UI).

export interface RenderResult {
  text: string;
  /** Переменные, которые встретились в шаблоне. */
  variables: string[];
  /** Переменные, для которых не было значения (null/undefined/пусто). */
  missing: string[];
  /** Переменные, которые встретились, но НЕ описаны в whitelist (опечатки). */
  unknown: string[];
}

const VAR_REGEX = /\{\{\s*([a-zA-Z][a-zA-Z0-9_.]*)\s*\}\}/g;

/** Whitelist допустимых переменных (для подсказки в UI и валидации). */
export const TEMPLATE_VARIABLES: ReadonlyArray<{ key: string; description: string }> = [
  { key: "organization.fullName",   description: "Полное наименование организации" },
  { key: "organization.shortName",  description: "Краткое наименование организации" },
  { key: "organization.name",       description: "Алиас краткого наименования" },
  { key: "organization.inn",        description: "ИНН организации" },
  { key: "organization.kpp",        description: "КПП организации" },
  { key: "organization.ogrn",       description: "ОГРН/ОГРНИП организации" },
  { key: "organization.legalAddress",  description: "Юридический адрес" },
  { key: "organization.actualAddress", description: "Фактический адрес" },
  { key: "organization.postalAddress", description: "Почтовый адрес" },
  { key: "organization.phone",      description: "Телефон" },
  { key: "organization.email",      description: "Email" },
  { key: "organization.website",    description: "Сайт" },
  { key: "counterparty.name",       description: "Краткое наименование контрагента" },
  { key: "counterparty.fullName",   description: "Полное наименование контрагента" },
  { key: "counterparty.inn",        description: "ИНН контрагента" },
  { key: "counterparty.kpp",        description: "КПП контрагента" },
  { key: "counterparty.legalAddress", description: "Адрес контрагента" },
  { key: "counterparty.managementName", description: "ФИО руководителя контрагента" },
  { key: "contract.number",         description: "Номер договора" },
  { key: "contract.date",           description: "Дата договора" },
  { key: "contract.amount",         description: "Сумма договора" },
  { key: "contract.currency",       description: "Валюта договора" },
  { key: "contract.subject",        description: "Предмет договора" },
  { key: "directorName",            description: "ФИО руководителя организации" },
  { key: "directorPosition",        description: "Должность руководителя" },
  { key: "basedOn",                 description: "На основании чего действует руководитель" },
];

const KNOWN_KEYS = new Set(TEMPLATE_VARIABLES.map((v) => v.key));

function get(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, part) => {
    if (acc == null || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[part];
  }, obj);
}

function toStringValue(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() === "" ? null : v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "да" : "нет";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  // Prisma Decimal и подобные
  return String(v);
}

/** Извлекает список переменных из шаблона. */
export function extractVariables(text: string): string[] {
  const seen = new Set<string>();
  for (const m of text.matchAll(VAR_REGEX)) {
    if (m[1]) seen.add(m[1]);
  }
  return [...seen];
}

/** Подставляет значения. Незаполненные → остаются как {{key}} и попадают в missing. */
export function renderTemplate(text: string, context: Record<string, unknown>): RenderResult {
  const variables = extractVariables(text);
  const missing: string[] = [];
  const unknown: string[] = [];
  const rendered = text.replace(VAR_REGEX, (_match, key: string) => {
    if (!KNOWN_KEYS.has(key)) {
      if (!unknown.includes(key)) unknown.push(key);
    }
    const value = toStringValue(get(context, key));
    if (value == null) {
      if (!missing.includes(key)) missing.push(key);
      return `{{${key}}}`;
    }
    return value;
  });
  return { text: rendered, variables, missing, unknown };
}

export interface ContractRenderInput {
  organization: {
    fullName: string;
    name: string;
    inn: string;
    kpp?: string | null;
    ogrn?: string | null;
    legalAddress?: string | null;
    actualAddress?: string | null;
    postalAddress?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    directorName?: string | null;
    directorPosition?: string | null;
    entrepreneurName?: string | null;
    basedOn?: string | null;
  };
  counterparty: {
    name: string;
    fullName?: string | null;
    inn: string;
    kpp?: string | null;
    legalAddress?: string | null;
    managementName?: string | null;
  };
  contract: {
    number: string;
    date: Date | string;
    amount?: unknown;
    currency?: string | null;
    subject?: string | null;
  };
}

/** Удобная обёртка: строит плоский контекст из реквизитов и рендерит. */
export function renderContract(template: string, input: ContractRenderInput): RenderResult {
  const ctx: Record<string, unknown> = {
    organization: {
      fullName:      input.organization.fullName,
      shortName:     input.organization.name,
      name:          input.organization.name,
      inn:           input.organization.inn,
      kpp:           input.organization.kpp,
      ogrn:          input.organization.ogrn,
      legalAddress:  input.organization.legalAddress,
      actualAddress: input.organization.actualAddress,
      postalAddress: input.organization.postalAddress,
      phone:         input.organization.phone,
      email:         input.organization.email,
      website:       input.organization.website,
    },
    counterparty: {
      name:           input.counterparty.name,
      fullName:       input.counterparty.fullName,
      inn:            input.counterparty.inn,
      kpp:            input.counterparty.kpp,
      legalAddress:   input.counterparty.legalAddress,
      managementName: input.counterparty.managementName,
    },
    contract: {
      number:   input.contract.number,
      date:     input.contract.date,
      amount:   input.contract.amount,
      currency: input.contract.currency ?? "RUB",
      subject:  input.contract.subject,
    },
    directorName:     input.organization.directorName ?? input.organization.entrepreneurName,
    directorPosition: input.organization.directorPosition,
    basedOn:          input.organization.basedOn,
  };
  return renderTemplate(template, ctx);
}
