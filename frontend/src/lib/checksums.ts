// Контрольные суммы реквизитов РФ (порт с backend/src/lib/validators.ts).
// Используется в zod-схемах форм для проверки до отправки на сервер.

export const innRegex = /^\d{10}(\d{2})?$/;
export const kppRegex = /^\d{9}$/;
export const ogrnRegex = /^\d{13}(\d{2})?$/;
export const bikRegex = /^04\d{7}$/;
export const accountRegex = /^\d{20}$/;

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

export function isValidKpp(kpp: string): boolean {
  return kppRegex.test(kpp);
}

export function isValidBik(bik: string): boolean {
  return bikRegex.test(bik);
}

export function isValidAccount(account: string): boolean {
  return accountRegex.test(account);
}
