// Ставки НДС РФ — актуальны на 2026 год (ФЗ от 28.11.2025 № 425-ФЗ).

export type VatMode = "EXEMPT" | "USN_5" | "USN_7" | "GENERAL";

export interface VatRateOption {
  value: number;
  label: string;
  description?: string;
}

/** Все возможные ставки НДС. Используется в зависимости от vatMode. */
export const VAT_RATES_GENERAL: VatRateOption[] = [
  { value: 22, label: "22%", description: "Базовая ставка с 01.01.2026 (НК РФ ст. 164)" },
  { value: 10, label: "10%", description: "Соц. товары, лекарства, периодика (НК РФ ст. 164)" },
  { value: 0, label: "0%", description: "Экспорт, международные перевозки" },
];

export const VAT_RATES_USN_5: VatRateOption[] = [
  { value: 5, label: "5%", description: "УСН-НДС, доход 20-250 млн руб., без права вычета" },
  { value: 0, label: "0%", description: "Экспорт" },
];

export const VAT_RATES_USN_7: VatRateOption[] = [
  { value: 7, label: "7%", description: "УСН-НДС, доход 250-490,5 млн руб., без права вычета" },
  { value: 0, label: "0%", description: "Экспорт" },
];

export const VAT_RATES_EXEMPT: VatRateOption[] = [];

/** Доступные ставки НДС в зависимости от режима НДС организации. */
export function availableVatRates(mode: VatMode): VatRateOption[] {
  switch (mode) {
    case "GENERAL": return VAT_RATES_GENERAL;
    case "USN_5":   return VAT_RATES_USN_5;
    case "USN_7":   return VAT_RATES_USN_7;
    case "EXEMPT":  return VAT_RATES_EXEMPT;
  }
}

/** Ставка по умолчанию для режима. */
export function defaultVatRate(mode: VatMode): number {
  switch (mode) {
    case "GENERAL": return 22;
    case "USN_5":   return 5;
    case "USN_7":   return 7;
    case "EXEMPT":  return 0;
  }
}

/** Допустима ли ставка для режима. */
export function isValidVatRate(mode: VatMode, rate: number): boolean {
  if (mode === "EXEMPT") return rate === 0;
  return availableVatRates(mode).some((r) => r.value === rate);
}

export const VAT_MODE_LABELS: Record<VatMode, { short: string; description: string }> = {
  GENERAL: {
    short: "Общий режим",
    description: "ОСН или УСН с выбором ставки 22%/10%/0% — есть право на вычет входящего НДС",
  },
  USN_5: {
    short: "УСН-НДС 5%",
    description: "Упрощёнка с пониженной ставкой 5% (доход 20-250 млн руб.) — без права вычета",
  },
  USN_7: {
    short: "УСН-НДС 7%",
    description: "Упрощёнка с пониженной ставкой 7% (доход 250-490,5 млн руб.) — без права вычета",
  },
  EXEMPT: {
    short: "Без НДС",
    description: "Освобождён от НДС: УСН до 20 млн, НПД, ПСН, АУСН",
  },
};

/**
 * Рекомендация по режиму НДС на УСН исходя из годового дохода (2026).
 * Возвращает рекомендуемый режим + краткое объяснение.
 */
export function recommendVatModeForUsn(annualIncome: number): { mode: VatMode; explanation: string } {
  if (annualIncome <= 20_000_000) {
    return {
      mode: "EXEMPT",
      explanation: "Доход ≤ 20 млн руб. — освобождение от НДС. Самый простой вариант.",
    };
  }
  if (annualIncome <= 250_000_000) {
    return {
      mode: "USN_5",
      explanation:
        "При доходе 20-250 млн обычно выгодна пониженная ставка 5%. Минус: нельзя принимать входящий НДС к вычету. Если поставщики выставляют НДС и его много — посчитайте через 22%.",
    };
  }
  if (annualIncome <= 490_500_000) {
    return {
      mode: "USN_7",
      explanation:
        "При доходе 250-490,5 млн пониженная ставка 7%. Без права вычета — оцените долю поставок с НДС, иногда 22% выгоднее.",
    };
  }
  return {
    mode: "GENERAL",
    explanation:
      "При доходе > 490,5 млн право на УСН утрачено. Применяется ОСН со ставкой НДС 22% (или 10% по социальным товарам).",
  };
}
