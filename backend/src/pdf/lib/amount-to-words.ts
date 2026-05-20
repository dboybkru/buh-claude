// Преобразование числа в сумму прописью на русском.
// Пример: 12345.67 → "Двенадцать тысяч триста сорок пять рублей 67 копеек"
//         150.00 → "Сто пятьдесят рублей 00 копеек"

const UNITS_M: readonly string[] = [
  "", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять",
];
const UNITS_F: readonly string[] = [
  "", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять",
];
const TEENS: readonly string[] = [
  "десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать",
  "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать",
];
const TENS: readonly string[] = [
  "", "", "двадцать", "тридцать", "сорок", "пятьдесят",
  "шестьдесят", "семьдесят", "восемьдесят", "девяносто",
];
const HUNDREDS: readonly string[] = [
  "", "сто", "двести", "триста", "четыреста", "пятьсот",
  "шестьсот", "семьсот", "восемьсот", "девятьсот",
];

type Gender = "m" | "f";

function tripletToWords(n: number, gender: Gender): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const u = n % 10;

  if (h > 0) parts.push(HUNDREDS[h] ?? "");
  if (t === 1) {
    parts.push(TEENS[u] ?? "");
  } else {
    if (t >= 2) parts.push(TENS[t] ?? "");
    if (u > 0) parts.push(gender === "f" ? UNITS_F[u] ?? "" : UNITS_M[u] ?? "");
  }
  return parts.filter(Boolean).join(" ");
}

// Окончание для существительного по правилам русского языка:
// формы: 1 — "рубль", 2-4 — "рубля", 5-20 — "рублей".
function plural(n: number, forms: [string, string, string]): string {
  const last = n % 100;
  const lastDigit = n % 10;
  if (last >= 11 && last <= 19) return forms[2];
  if (lastDigit === 1) return forms[0];
  if (lastDigit >= 2 && lastDigit <= 4) return forms[1];
  return forms[2];
}

const RUBLES_FORMS: [string, string, string] = ["рубль", "рубля", "рублей"];
const KOPECKS_FORMS: [string, string, string] = ["копейка", "копейки", "копеек"];

interface ScaleStep {
  label: [string, string, string];
  gender: Gender;
}
const SCALE: readonly ScaleStep[] = [
  { label: ["", "", ""], gender: "m" }, // единицы (рубли/копейки задаются отдельно)
  { label: ["тысяча", "тысячи", "тысяч"], gender: "f" },
  { label: ["миллион", "миллиона", "миллионов"], gender: "m" },
  { label: ["миллиард", "миллиарда", "миллиардов"], gender: "m" },
  { label: ["триллион", "триллиона", "триллионов"], gender: "m" },
];

function intToWords(n: number, gender: Gender): string {
  if (n === 0) return "ноль";
  const groups: number[] = [];
  let x = n;
  while (x > 0) {
    groups.push(x % 1000);
    x = Math.floor(x / 1000);
  }
  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i] ?? 0;
    if (g === 0) continue;
    const step = SCALE[i];
    if (!step) continue;
    const useGender = i === 0 ? gender : step.gender;
    const words = tripletToWords(g, useGender);
    parts.push(words);
    if (i > 0) parts.push(plural(g, step.label));
  }
  return parts.filter(Boolean).join(" ");
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function amountToWords(amount: number | string): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (!isFinite(num) || num < 0) return "";
  const rubles = Math.floor(num);
  const kopecks = Math.round((num - rubles) * 100);
  const rubWords = capitalize(intToWords(rubles, "m"));
  const kopStr = String(kopecks).padStart(2, "0");
  return `${rubWords} ${plural(rubles, RUBLES_FORMS)} ${kopStr} ${plural(kopecks, KOPECKS_FORMS)}`;
}
