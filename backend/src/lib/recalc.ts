import Decimal from "decimal.js";

export interface ItemInput {
  quantity: number | string | Decimal;
  price: number | string | Decimal;
  vatRate: number | string | Decimal;
}

export interface ItemAmounts {
  subtotal: Decimal; // без НДС
  vatAmount: Decimal;
  total: Decimal; // с НДС
}

const ZERO = new Decimal(0);
const HUNDRED = new Decimal(100);

// Округление до 2 знаков (банковское — half-even)
function r2(d: Decimal): Decimal {
  return d.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
}

/**
 * Расчёт сумм по позиции.
 * vatIncluded=true  → цена УЖЕ включает НДС, выделяем НДС из цены
 * vatIncluded=false → цена БЕЗ НДС, НДС добавляется сверху
 */
export function calcItem(item: ItemInput, vatIncluded: boolean): ItemAmounts {
  const qty = new Decimal(item.quantity);
  const price = new Decimal(item.price);
  const rate = new Decimal(item.vatRate);

  let subtotal: Decimal;
  let vatAmount: Decimal;
  let total: Decimal;

  if (vatIncluded) {
    total = r2(qty.mul(price));
    // НДС = total * rate / (100 + rate)
    if (rate.isZero()) {
      vatAmount = ZERO;
    } else {
      vatAmount = r2(total.mul(rate).div(HUNDRED.plus(rate)));
    }
    subtotal = r2(total.minus(vatAmount));
  } else {
    subtotal = r2(qty.mul(price));
    vatAmount = rate.isZero() ? ZERO : r2(subtotal.mul(rate).div(HUNDRED));
    total = r2(subtotal.plus(vatAmount));
  }

  return { subtotal, vatAmount, total };
}

export interface DocTotals {
  subtotal: Decimal;
  vatAmount: Decimal;
  total: Decimal;
}

export function sumDocument(items: ItemAmounts[]): DocTotals {
  return items.reduce(
    (acc, it) => ({
      subtotal: r2(acc.subtotal.plus(it.subtotal)),
      vatAmount: r2(acc.vatAmount.plus(it.vatAmount)),
      total: r2(acc.total.plus(it.total)),
    }),
    { subtotal: ZERO, vatAmount: ZERO, total: ZERO },
  );
}

export function decToStr(d: Decimal): string {
  return r2(d).toFixed(2);
}
