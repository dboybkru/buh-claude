import { z } from "zod";

// Регулярки только проверяют формат (длину и цифры). Контрольные суммы — в lib/checksums.ts.
export const innRegex = /^\d{10}(\d{2})?$/; // 10 (юрлицо) или 12 (ИП)
export const kppRegex = /^\d{9}$/;
export const ogrnRegex = /^\d{13}(\d{2})?$/; // 13 (ОГРН) или 15 (ОГРНИП)
export const bikRegex = /^04\d{7}$/;
export const accountRegex = /^\d{20}$/;

// Контрольные суммы ИНН (ФНС). Возвращает true для валидных 10/12-значных ИНН.
export function isValidInn(inn: string): boolean {
  if (!innRegex.test(inn)) return false;
  const digits = inn.split("").map((c) => Number(c));
  if (digits.length === 10) {
    const w = [2, 4, 10, 3, 5, 9, 4, 6, 8, 0];
    const sum = w.reduce((s, wi, i) => s + wi * (digits[i] ?? 0), 0);
    return (sum % 11) % 10 === (digits[9] ?? -1);
  }
  const w11 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8, 0];
  const w12 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8, 0];
  const c11 = (w11.reduce((s, wi, i) => s + wi * (digits[i] ?? 0), 0) % 11) % 10;
  const c12 = (w12.reduce((s, wi, i) => s + wi * (digits[i] ?? 0), 0) % 11) % 10;
  return c11 === (digits[10] ?? -1) && c12 === (digits[11] ?? -2);
}

export function isValidOgrn(ogrn: string): boolean {
  if (!ogrnRegex.test(ogrn)) return false;
  if (ogrn.length === 13) {
    const n = BigInt(ogrn.slice(0, 12));
    const check = Number(n % 11n) % 10;
    return check === Number(ogrn.charAt(12));
  }
  const n = BigInt(ogrn.slice(0, 14));
  const check = Number(n % 13n) % 10;
  return check === Number(ogrn.charAt(14));
}

// zod-кастомные схемы
export const innSchema = z.string().refine(isValidInn, "Неверная контрольная сумма ИНН");
export const kppSchema = z.string().regex(kppRegex, "КПП должен содержать 9 цифр");
export const ogrnSchema = z.string().refine(isValidOgrn, "Неверная контрольная сумма ОГРН");
export const bikSchema = z.string().regex(bikRegex, "БИК должен быть 9 цифр, начинаться с 04");
export const accountSchema = z.string().regex(accountRegex, "Счёт должен содержать 20 цифр");

// Пагинация: ?page=1&pageSize=20&q=... | ?sort=field:asc
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  q: z.string().optional(),
  sort: z.string().optional(),
});
export type PaginationQuery = z.infer<typeof paginationSchema>;

export function parseSort(sort: string | undefined, allowed: string[], fallback: Record<string, "asc" | "desc">) {
  if (!sort) return fallback;
  const parts = sort.split(":");
  const field = parts[0];
  const dirRaw = parts[1];
  const dir: "asc" | "desc" = dirRaw === "desc" ? "desc" : "asc";
  if (!field || !allowed.includes(field)) return fallback;
  return { [field]: dir } as Record<string, "asc" | "desc">;
}

export function paginate<T>(items: T[], total: number, page: number, pageSize: number) {
  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
