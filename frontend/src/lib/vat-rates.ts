// Ставки НДС РФ — актуальны на 2026 год (ФЗ от 28.11.2025 № 425-ФЗ).
// Дублирует backend/src/lib/vat-rates.ts, поскольку фронту нужны те же справочники.

export type VatMode = "EXEMPT" | "USN_5" | "USN_7" | "GENERAL";

export interface VatRateOption {
  value: number;
  label: string;
  description?: string;
}

export const VAT_RATES_GENERAL: VatRateOption[] = [
  { value: 22, label: "22%", description: "Базовая ставка с 01.01.2026" },
  { value: 10, label: "10%", description: "Соц. товары, лекарства, периодика" },
  { value: 0, label: "0%", description: "Экспорт, международные перевозки" },
];

export const VAT_RATES_USN_5: VatRateOption[] = [
  { value: 5, label: "5%", description: "УСН-НДС, доход 20-250 млн ₽, без вычетов" },
  { value: 0, label: "0%", description: "Экспорт" },
];

export const VAT_RATES_USN_7: VatRateOption[] = [
  { value: 7, label: "7%", description: "УСН-НДС, доход 250-490,5 млн ₽, без вычетов" },
  { value: 0, label: "0%", description: "Экспорт" },
];

export function availableVatRates(mode: VatMode): VatRateOption[] {
  switch (mode) {
    case "GENERAL": return VAT_RATES_GENERAL;
    case "USN_5":   return VAT_RATES_USN_5;
    case "USN_7":   return VAT_RATES_USN_7;
    case "EXEMPT":  return [];
  }
}

export function defaultVatRate(mode: VatMode): number {
  switch (mode) {
    case "GENERAL": return 22;
    case "USN_5":   return 5;
    case "USN_7":   return 7;
    case "EXEMPT":  return 0;
  }
}

export const VAT_MODE_LABELS: Record<VatMode, { short: string; description: string }> = {
  GENERAL: {
    short: "Общий режим",
    description: "ОСН или УСН с выбором 22%/10%/0% — с правом вычета входящего НДС",
  },
  USN_5: {
    short: "УСН-НДС 5%",
    description: "Упрощёнка, доход 20-250 млн ₽ — без права вычета",
  },
  USN_7: {
    short: "УСН-НДС 7%",
    description: "Упрощёнка, доход 250-490,5 млн ₽ — без права вычета",
  },
  EXEMPT: {
    short: "Без НДС",
    description: "Освобождение: УСН до 20 млн, НПД, ПСН, АУСН",
  },
};

export interface VatRecommendation {
  mode: VatMode;
  explanation: string;
}

/** Рекомендация режима НДС для УСН по годовому доходу (2026). */
export function recommendVatModeForUsn(annualIncome: number): VatRecommendation {
  if (annualIncome <= 20_000_000) {
    return {
      mode: "EXEMPT",
      explanation: "Доход ≤ 20 млн ₽ — освобождение от НДС, самый простой вариант.",
    };
  }
  if (annualIncome <= 250_000_000) {
    return {
      mode: "USN_5",
      explanation:
        "Доход 20-250 млн ₽: пониженная ставка 5% обычно выгодна. Минус — нельзя принять входящий НДС к вычету. Если у поставщиков много НДС, считайте через 22%.",
    };
  }
  if (annualIncome <= 490_500_000) {
    return {
      mode: "USN_7",
      explanation:
        "Доход 250-490,5 млн ₽: пониженная ставка 7%. Без права вычета — оцените долю поставок с НДС.",
    };
  }
  return {
    mode: "GENERAL",
    explanation:
      "Доход > 490,5 млн ₽ — право на УСН утрачено. ОСН со ставкой НДС 22% (или 10% по социальным товарам).",
  };
}
