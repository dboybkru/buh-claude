import { useState } from "react";
import { Calculator } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { formatAmount } from "@/lib/format";
import { recommendVatModeForUsn, VAT_MODE_LABELS } from "@/lib/vat-rates";

/**
 * Виджет: ввод годового дохода → подсказка какой режим НДС выгоднее на УСН (реформа 2026).
 * Шкала: до 20 млн ₽ — освобождение, 20-250 млн — 5%, 250-490,5 млн — 7%, выше — ОСН с 22%.
 */
export function VatCalculator() {
  const [income, setIncome] = useState<string>("");
  const num = parseFloat(income.replace(/[\s,]/g, "")) || 0;
  const rec = num > 0 ? recommendVatModeForUsn(num) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Calculator className="h-4 w-4" />
          Калькулятор НДС для УСН (2026)
        </CardTitle>
        <CardDescription>Подбор режима НДС по годовому доходу — реформа 2026 (ФЗ № 425-ФЗ).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Ожидаемый годовой доход, ₽</Label>
          <Input
            type="number"
            min="0"
            step="100000"
            value={income}
            onChange={(e) => setIncome(e.target.value)}
            placeholder="например, 45000000"
          />
        </div>

        {rec ? (
          <div className="rounded-md border p-3 bg-muted/30 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Рекомендуемый режим:</span>
              <Badge variant="default">{VAT_MODE_LABELS[rec.mode].short}</Badge>
            </div>
            <div className="text-sm">{rec.explanation}</div>
            <div className="text-xs text-muted-foreground mt-2">
              При доходе {formatAmount(num, { withCurrency: true })}
            </div>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">
            Введите ожидаемую годовую выручку, чтобы получить рекомендацию.
          </div>
        )}

        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground">Шкала режимов</summary>
          <ul className="mt-2 space-y-0.5 pl-4">
            <li>• ≤ 20 млн ₽ — освобождение от НДС</li>
            <li>• 20-250 млн ₽ — ставка 5% (без вычетов)</li>
            <li>• 250-490,5 млн ₽ — ставка 7% (без вычетов)</li>
            <li>• &gt; 490,5 млн ₽ — переход на ОСН (22% / 10% / 0%)</li>
          </ul>
        </details>
      </CardContent>
    </Card>
  );
}
