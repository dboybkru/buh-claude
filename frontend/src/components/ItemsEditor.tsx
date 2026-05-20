import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatAmount } from "@/lib/format";

export interface ItemRow {
  name: string;
  unit: string;
  unitCode: string;
  quantity: string;
  price: string;
  vatRate: string;
  // вычисляемые
  subtotal: number;
  vatAmount: number;
  total: number;
}

export function blankItem(): ItemRow {
  return { name: "", unit: "шт", unitCode: "796", quantity: "1", price: "0", vatRate: "20", subtotal: 0, vatAmount: 0, total: 0 };
}

function recalc(row: ItemRow, vatIncluded: boolean): ItemRow {
  const qty = parseFloat(row.quantity || "0");
  const price = parseFloat(row.price || "0");
  const rate = parseFloat(row.vatRate || "0");
  if (!isFinite(qty) || !isFinite(price)) {
    return { ...row, subtotal: 0, vatAmount: 0, total: 0 };
  }
  let subtotal: number, vat: number, total: number;
  if (vatIncluded) {
    total = round2(qty * price);
    vat = rate === 0 ? 0 : round2((total * rate) / (100 + rate));
    subtotal = round2(total - vat);
  } else {
    subtotal = round2(qty * price);
    vat = rate === 0 ? 0 : round2((subtotal * rate) / 100);
    total = round2(subtotal + vat);
  }
  return { ...row, subtotal, vatAmount: vat, total };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function recalcAll(items: ItemRow[], vatIncluded: boolean): { items: ItemRow[]; subtotal: number; vatAmount: number; total: number } {
  const recalculated = items.map((it) => recalc(it, vatIncluded));
  const subtotal = round2(recalculated.reduce((s, x) => s + x.subtotal, 0));
  const vatAmount = round2(recalculated.reduce((s, x) => s + x.vatAmount, 0));
  const total = round2(recalculated.reduce((s, x) => s + x.total, 0));
  return { items: recalculated, subtotal, vatAmount, total };
}

interface Props {
  items: ItemRow[];
  vatIncluded: boolean;
  onChange: (items: ItemRow[]) => void;
  disabled?: boolean;
}

export function ItemsEditor({ items, vatIncluded, onChange, disabled }: Props) {
  function update(i: number, patch: Partial<ItemRow>) {
    const next = [...items];
    const current = next[i];
    if (!current) return;
    next[i] = recalc({ ...current, ...patch }, vatIncluded);
    onChange(next);
  }
  function add() {
    onChange([...items, recalc(blankItem(), vatIncluded)]);
  }
  function remove(i: number) {
    onChange(items.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Позиции</h3>
        <Button type="button" variant="outline" size="sm" onClick={add} disabled={disabled}>
          <Plus className="h-4 w-4" /> Добавить позицию
        </Button>
      </div>
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">#</TableHead>
              <TableHead>Наименование</TableHead>
              <TableHead className="w-20">Ед.</TableHead>
              <TableHead className="w-24">Кол-во</TableHead>
              <TableHead className="w-28">Цена</TableHead>
              <TableHead className="w-20">НДС %</TableHead>
              <TableHead className="w-28 text-right">Без НДС</TableHead>
              <TableHead className="w-28 text-right">Всего</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-4">
                  Позиций пока нет. Добавьте первую.
                </TableCell>
              </TableRow>
            ) : (
              items.map((it, i) => (
                <TableRow key={i}>
                  <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                  <TableCell>
                    <Input value={it.name} onChange={(e) => update(i, { name: e.target.value })} disabled={disabled} />
                  </TableCell>
                  <TableCell>
                    <Input value={it.unit} onChange={(e) => update(i, { unit: e.target.value })} disabled={disabled} className="h-9" />
                  </TableCell>
                  <TableCell>
                    <Input type="number" step="0.001" value={it.quantity} onChange={(e) => update(i, { quantity: e.target.value })} disabled={disabled} className="h-9 text-right" />
                  </TableCell>
                  <TableCell>
                    <Input type="number" step="0.01" value={it.price} onChange={(e) => update(i, { price: e.target.value })} disabled={disabled} className="h-9 text-right" />
                  </TableCell>
                  <TableCell>
                    <Input type="number" step="0.01" value={it.vatRate} onChange={(e) => update(i, { vatRate: e.target.value })} disabled={disabled} className="h-9 text-right" />
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">{formatAmount(it.subtotal)}</TableCell>
                  <TableCell className="text-right font-mono text-sm font-medium">{formatAmount(it.total)}</TableCell>
                  <TableCell>
                    <Button type="button" variant="ghost" size="icon" onClick={() => remove(i)} disabled={disabled}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
