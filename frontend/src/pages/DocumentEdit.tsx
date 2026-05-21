import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Eye, FileCheck, FileDown, FileText, Receipt, Trash2, Truck } from "lucide-react";

import { api } from "@/lib/api";
import { handleApiError } from "@/lib/errors";
import { fetchAuthorizedBlob, triggerDownload } from "@/lib/download";
import { PdfPreviewDialog } from "@/components/PdfPreviewDialog";
import { HtmlPreviewDialog } from "@/components/HtmlPreviewDialog";
import { PrintWarnings, PrintWarningsBadge } from "@/components/PrintWarnings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { FormField } from "@/pages/Organizations";
import { ItemsEditor, recalcAll, blankItem, type ItemRow } from "@/components/ItemsEditor";
import { formatAmount } from "@/lib/format";
import { DOCS, type DocKind, statusLabel, isLocked } from "@/lib/documents-config";
import { availableVatRates, defaultVatRate, VAT_MODE_LABELS, type VatMode } from "@/lib/vat-rates";
import { PaymentDialog } from "@/pages/Payments";
import { Plus, Wallet } from "lucide-react";

interface OrgOpt { id: string; name: string; inn: string; vatMode: VatMode; bankAccounts?: Array<{ id: string; bankName: string; bik: string; isDefault: boolean }> }
interface CpOpt { id: string; name: string; inn: string }
interface ContractOpt { id: string; number: string; organizationId: string; counterpartyId: string; date: string }

interface SourceContract { id: string; number: string; organizationId: string; counterpartyId: string }
interface SourceInvoiceItem { name: string; unit: string; unitCode: string; quantity: string; price: string; vatRate: string }
interface SourceInvoice {
  id: string;
  number: string;
  organizationId: string;
  counterpartyId: string;
  contractId: string | null;
  vatRate: string;
  vatIncluded: boolean;
  items: SourceInvoiceItem[];
}

interface DocumentFull {
  id: string;
  organizationId: string;
  counterpartyId: string;
  contractId: string | null;
  invoiceId?: string | null;
  bankAccountId?: string | null;
  number: string;
  date: string;
  status: string;
  currency: string;
  vatRate: string;
  vatIncluded: boolean;
  subtotal: string;
  vatAmount: string;
  total: string;
  notes: string | null;
  items: Array<{ id: string; sortOrder: number; name: string; unit: string; unitCode: string; quantity: string; price: string; vatRate: string; subtotal: string; vatAmount: string; total: string }>;
  // type-specific
  dueDate?: string | null;
  paymentPurpose?: string | null;
  paidAt?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  sellerSignatory?: string | null;
  buyerSignatory?: string | null;
  functionType?: string;
  shipmentDate?: string | null;
  shipmentAddress?: string | null;
  customsDecl?: string | null;
  paymentDocRef?: string | null;
  operationType?: string;
  shippedBy?: string | null;
  receivedBy?: string | null;
  fileUrl?: string | null;
}

interface State {
  organizationId: string;
  counterpartyId: string;
  contractId: string;
  bankAccountId: string;
  invoiceId: string;
  number: string;
  date: string;
  status: string;
  vatRate: string;
  vatIncluded: boolean;
  notes: string;
  // invoice
  dueDate: string;
  paymentPurpose: string;
  // act
  periodStart: string;
  periodEnd: string;
  sellerSignatory: string;
  buyerSignatory: string;
  // upd
  functionType: string;
  shipmentDate: string;
  shipmentAddress: string;
  customsDecl: string;
  paymentDocRef: string;
  // waybill
  operationType: string;
  shippedBy: string;
  receivedBy: string;
}

function initState(kind: DocKind): State {
  return {
    organizationId: "", counterpartyId: "", contractId: "", bankAccountId: "", invoiceId: "",
    number: "", date: new Date().toISOString().slice(0, 10),
    status: "DRAFT", vatRate: "22", vatIncluded: DOCS[kind].defaultVatIncluded, notes: "",
    dueDate: "", paymentPurpose: "",
    periodStart: "", periodEnd: "", sellerSignatory: "", buyerSignatory: "",
    functionType: "FULL", shipmentDate: "", shipmentAddress: "", customsDecl: "", paymentDocRef: "",
    operationType: "SALE", shippedBy: "", receivedBy: "",
  };
}

export function DocumentEditPage({ kind }: { kind: DocKind }) {
  const cfg = DOCS[kind];
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new" || !id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const fromContractId = searchParams.get("fromContract");
  const fromInvoiceId = searchParams.get("fromInvoice");

  const orgs = useQuery({ queryKey: ["orgs-opts"], queryFn: async () => (await api.get<{ items: OrgOpt[] }>("/organizations", { params: { pageSize: 200 } })).data.items });
  const cps = useQuery({ queryKey: ["cps-opts"], queryFn: async () => (await api.get<{ items: CpOpt[] }>("/counterparties", { params: { pageSize: 200 } })).data.items });
  const contracts = useQuery({ queryKey: ["contracts-opts"], queryFn: async () => (await api.get<{ items: ContractOpt[] }>("/contracts", { params: { pageSize: 200 } })).data.items });

  const existing = useQuery({
    queryKey: [kind, id],
    queryFn: async () => (await api.get<DocumentFull>(`${cfg.apiPath}/${id}`)).data,
    enabled: !isNew,
  });

  // Pre-fill для нового документа: ?fromContract=ID или ?fromInvoice=ID
  const sourceContract = useQuery({
    queryKey: ["contracts", fromContractId],
    queryFn: async () => (await api.get<SourceContract>(`/contracts/${fromContractId}`)).data,
    enabled: isNew && !!fromContractId,
  });
  const sourceInvoice = useQuery({
    queryKey: ["invoices", fromInvoiceId, "as-source"],
    queryFn: async () => (await api.get<SourceInvoice>(`/invoices/${fromInvoiceId}`)).data,
    enabled: isNew && !!fromInvoiceId,
  });

  const [state, setState] = useState<State>(() => initState(kind));
  const [items, setItems] = useState<ItemRow[]>([blankItem()]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [htmlPreviewOpen, setHtmlPreviewOpen] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);

  // Платежи по счёту (только для invoices)
  const paymentsByInvoice = useQuery({
    queryKey: ["invoice-payments", id],
    queryFn: async () => (await api.get<{ total: number; paid: number; balance: number; allocations: Array<{ id: string; amount: number; payment: { id: string; date: string; method: string; reference: string | null; amount: number; counterparty?: { id: string; name: string } | null } }> }>(`/payments/by-invoice/${id}`)).data,
    enabled: !isNew && kind === "invoices",
  });

  // Pre-fill из договора (новый счёт «На основании договора»)
  useEffect(() => {
    if (!isNew || !sourceContract.data) return;
    const c = sourceContract.data;
    setState((prev) => ({
      ...prev,
      organizationId: c.organizationId,
      counterpartyId: c.counterpartyId,
      contractId: c.id,
    }));
  }, [isNew, sourceContract.data]);

  // Pre-fill из счёта (новый акт/УПД/ТОРГ-12 «На основании счёта»)
  useEffect(() => {
    if (!isNew || !sourceInvoice.data) return;
    const inv = sourceInvoice.data;
    setState((prev) => ({
      ...prev,
      organizationId: inv.organizationId,
      counterpartyId: inv.counterpartyId,
      contractId: inv.contractId ?? "",
      invoiceId: inv.id,
      vatRate: inv.vatRate,
      vatIncluded: inv.vatIncluded,
    }));
    // Копируем позиции из счёта (без пересчёта — recalc сделает сам)
    setItems(
      inv.items.map((it) => ({
        name: it.name,
        unit: it.unit,
        unitCode: it.unitCode,
        quantity: it.quantity,
        price: it.price,
        vatRate: it.vatRate,
        subtotal: 0,
        vatAmount: 0,
        total: 0,
      })),
    );
  }, [isNew, sourceInvoice.data]);

  useEffect(() => {
    if (!isNew && existing.data) {
      const d = existing.data;
      setState({
        organizationId: d.organizationId,
        counterpartyId: d.counterpartyId,
        contractId: d.contractId ?? "",
        bankAccountId: d.bankAccountId ?? "",
        invoiceId: d.invoiceId ?? "",
        number: d.number,
        date: d.date.slice(0, 10),
        status: d.status,
        vatRate: String(d.vatRate),
        vatIncluded: d.vatIncluded,
        notes: d.notes ?? "",
        dueDate: d.dueDate ? d.dueDate.slice(0, 10) : "",
        paymentPurpose: d.paymentPurpose ?? "",
        periodStart: d.periodStart ? d.periodStart.slice(0, 10) : "",
        periodEnd: d.periodEnd ? d.periodEnd.slice(0, 10) : "",
        sellerSignatory: d.sellerSignatory ?? "",
        buyerSignatory: d.buyerSignatory ?? "",
        functionType: d.functionType ?? "FULL",
        shipmentDate: d.shipmentDate ? d.shipmentDate.slice(0, 10) : "",
        shipmentAddress: d.shipmentAddress ?? "",
        customsDecl: d.customsDecl ?? "",
        paymentDocRef: d.paymentDocRef ?? "",
        operationType: d.operationType ?? "SALE",
        shippedBy: d.shippedBy ?? "",
        receivedBy: d.receivedBy ?? "",
      });
      setItems(d.items.map((it) => ({
        name: it.name, unit: it.unit, unitCode: it.unitCode,
        quantity: it.quantity, price: it.price, vatRate: it.vatRate,
        subtotal: parseFloat(it.subtotal), vatAmount: parseFloat(it.vatAmount), total: parseFloat(it.total),
      })));
    }
  }, [isNew, existing.data]);

  const locked = !isNew && existing.data ? isLocked(kind, existing.data.status) : false;

  // Пересчёт при изменении vatIncluded
  const totals = useMemo(() => recalcAll(items, state.vatIncluded), [items, state.vatIncluded]);

  function setField<K extends keyof State>(k: K, v: State[K]) {
    setState((prev) => ({ ...prev, [k]: v }));
  }

  async function save() {
    const payload = buildPayload(kind, state, items);
    try {
      if (isNew) {
        const r = await api.post<{ id: string }>(cfg.apiPath, payload);
        toast.success(`${cfg.titleSingular} создан`);
        qc.invalidateQueries({ queryKey: [kind] });
        navigate(`${cfg.routePath}/${r.data.id}`, { replace: true });
      } else {
        await api.patch(`${cfg.apiPath}/${id}`, payload);
        toast.success("Сохранено");
        qc.invalidateQueries({ queryKey: [kind] });
        qc.invalidateQueries({ queryKey: [kind, id] });
      }
    } catch (err) { handleApiError(err); }
  }

  async function deleteDoc() {
    if (!confirm(`Удалить ${cfg.titleSingular.toLowerCase()} ${state.number}?`)) return;
    try {
      await api.delete(`${cfg.apiPath}/${id}`);
      toast.success("Удалено");
      qc.invalidateQueries({ queryKey: [kind] });
      navigate(cfg.routePath);
    } catch (err) { handleApiError(err); }
  }

  async function downloadPdf() {
    try {
      const { blob, filename } = await fetchAuthorizedBlob(`/api/v1${cfg.apiPath}/${id}/pdf`, `${kind}.pdf`);
      triggerDownload(blob, filename);
    } catch (err) {
      handleApiError(err, "Не удалось скачать PDF");
    }
  }

  const orgOptions = orgs.data ?? [];
  const cpOptions = cps.data ?? [];
  const selectedOrg = orgOptions.find((o) => o.id === state.organizationId);
  const orgVatMode: VatMode = selectedOrg?.vatMode ?? "GENERAL";
  const allowedVatRates = availableVatRates(orgVatMode);

  // При смене организации с другим vatMode — переключаем ставку на дефолт нового режима
  useEffect(() => {
    if (!selectedOrg) return;
    const current = parseFloat(state.vatRate);
    const validValues = orgVatMode === "EXEMPT" ? [0] : allowedVatRates.map((r) => r.value);
    if (!validValues.includes(current)) {
      setField("vatRate", String(defaultVatRate(orgVatMode)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrg?.id, orgVatMode]);
  const contractOptions = useMemo(() => {
    if (!contracts.data) return [];
    return contracts.data.filter((c) =>
      (!state.organizationId || c.organizationId === state.organizationId) &&
      (!state.counterpartyId || c.counterpartyId === state.counterpartyId),
    );
  }, [contracts.data, state.organizationId, state.counterpartyId]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate(cfg.routePath)}><ArrowLeft className="h-4 w-4" /></Button>
          <div>
            <h1 className="text-2xl font-bold">
              {isNew ? `Новый ${cfg.titleSingular.toLowerCase()}` : `${cfg.titleSingular} ${state.number}`}
            </h1>
            {!isNew && locked ? (
              <div className="text-xs text-muted-foreground mt-1">
                <Badge variant="warning">{statusLabel(kind, state.status)}</Badge>
                <span className="ml-2">— документ заблокирован, редактирование запрещено</span>
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          {!isNew && kind === "invoices" ? (
            <>
              <Button variant="secondary" onClick={() => navigate(`/acts/new?fromInvoice=${id}`)} aria-label="Создать акт на основании">
                <FileCheck className="h-4 w-4" /> Акт
              </Button>
              <Button variant="secondary" onClick={() => navigate(`/upds/new?fromInvoice=${id}`)} aria-label="Создать УПД на основании">
                <FileText className="h-4 w-4" /> УПД
              </Button>
              <Button variant="secondary" onClick={() => navigate(`/waybills/new?fromInvoice=${id}`)} aria-label="Создать ТОРГ-12 на основании">
                <Truck className="h-4 w-4" /> ТОРГ-12
              </Button>
            </>
          ) : null}
          {!isNew ? (
            <>
              <div className="relative inline-flex">
                <Button variant="outline" onClick={() => setHtmlPreviewOpen(true)} aria-label="Превью HTML">
                  <Eye className="h-4 w-4" /> Превью
                </Button>
                <span className="absolute -top-2 -right-2">
                  <PrintWarningsBadge url={`${cfg.apiPath}/${id}/print-warnings`} />
                </span>
              </div>
              <Button variant="outline" onClick={() => setPreviewOpen(true)} aria-label="Превью PDF">
                <FileText className="h-4 w-4" /> Превью PDF
              </Button>
              <Button variant="outline" onClick={downloadPdf} aria-label="Скачать PDF">
                <FileDown className="h-4 w-4" /> Скачать PDF
              </Button>
              <Button variant="outline" onClick={deleteDoc} disabled={locked} aria-label="Удалить документ">
                <Trash2 className="h-4 w-4" /> Удалить
              </Button>
            </>
          ) : null}
          <Button onClick={save} disabled={locked}>Сохранить</Button>
        </div>
      </div>

      {/* Backlink: показываем "На основании ..." */}
      {(state.invoiceId || (kind === "invoices" && state.contractId)) ? (
        <Card>
          <CardContent className="py-3 text-sm flex items-center gap-2 flex-wrap">
            <Receipt className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">На основании:</span>
            {state.contractId ? (
              <Badge variant="outline" className="cursor-pointer" onClick={() => navigate("/contracts")}>
                Договор {contracts.data?.find((c) => c.id === state.contractId)?.number ?? "..."}
              </Badge>
            ) : null}
            {state.invoiceId ? (
              <Badge variant="outline">
                <Link to={`/invoices/${state.invoiceId}`} className="hover:underline">
                  Счёт {existing.data?.invoiceId ? "..." : ""}
                </Link>
              </Badge>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader><CardTitle className="text-base">Шапка документа</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Организация (наша)">
              <Select value={state.organizationId} onValueChange={(v) => setField("organizationId", v)} disabled={locked}>
                <SelectTrigger><SelectValue placeholder="Выберите..." /></SelectTrigger>
                <SelectContent>{orgOptions.map((o) => <SelectItem key={o.id} value={o.id}>{o.name} ({o.inn})</SelectItem>)}</SelectContent>
              </Select>
            </FormField>
            <FormField label="Контрагент">
              <Select value={state.counterpartyId} onValueChange={(v) => setField("counterpartyId", v)} disabled={locked}>
                <SelectTrigger><SelectValue placeholder="Выберите..." /></SelectTrigger>
                <SelectContent>{cpOptions.map((c) => <SelectItem key={c.id} value={c.id}>{c.name} ({c.inn})</SelectItem>)}</SelectContent>
              </Select>
            </FormField>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <FormField label="Договор (опционально)">
              <Select value={state.contractId || "none"} onValueChange={(v) => setField("contractId", v === "none" ? "" : v)} disabled={locked}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— без договора —</SelectItem>
                  {contractOptions.map((c) => <SelectItem key={c.id} value={c.id}>{c.number}</SelectItem>)}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Номер">
              <Input value={state.number} onChange={(e) => setField("number", e.target.value)} placeholder={`автоматически (${cfg.numberPrefix}NNNN/${new Date().getFullYear()})`} disabled={locked} />
            </FormField>
            <FormField label="Дата">
              <Input type="date" value={state.date} onChange={(e) => setField("date", e.target.value)} disabled={locked} />
            </FormField>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <FormField label="Ставка НДС, %">
              {orgVatMode === "EXEMPT" ? (
                <Input value="без НДС" disabled />
              ) : (
                <Select value={state.vatRate} onValueChange={(v) => setField("vatRate", v)} disabled={locked}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {allowedVatRates.map((r) => (
                      <SelectItem key={r.value} value={String(r.value)}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {selectedOrg ? (
                <div className="text-xs text-muted-foreground mt-1">
                  Режим организации: {VAT_MODE_LABELS[orgVatMode].short}
                </div>
              ) : null}
            </FormField>
            <FormField label="НДС">
              <Select value={state.vatIncluded ? "in" : "out"} onValueChange={(v) => setField("vatIncluded", v === "in")} disabled={locked}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="in">в т.ч. (включён)</SelectItem>
                  <SelectItem value="out">сверху</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Статус">
              <Select value={state.status} onValueChange={(v) => setField("status", v)} disabled={locked && state.status === existing.data?.status}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{cfg.statuses.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
            </FormField>
          </div>

          {/* Тип-специфичные поля */}
          {kind === "invoices" ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Срок оплаты">
                  <Input type="date" value={state.dueDate} onChange={(e) => setField("dueDate", e.target.value)} disabled={locked} />
                </FormField>
                <FormField label="Расчётный счёт">
                  <Select value={state.bankAccountId || "none"} onValueChange={(v) => setField("bankAccountId", v === "none" ? "" : v)} disabled={locked}>
                    <SelectTrigger><SelectValue placeholder="по умолчанию" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— по умолчанию —</SelectItem>
                      {(orgOptions.find((o) => o.id === state.organizationId)?.bankAccounts ?? []).map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.bankName} ({a.bik})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              </div>
              <FormField label="Назначение платежа">
                <Textarea value={state.paymentPurpose} onChange={(e) => setField("paymentPurpose", e.target.value)} rows={2} disabled={locked} />
              </FormField>
            </>
          ) : null}

          {kind === "acts" ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Начало периода"><Input type="date" value={state.periodStart} onChange={(e) => setField("periodStart", e.target.value)} disabled={locked} /></FormField>
                <FormField label="Конец периода"><Input type="date" value={state.periodEnd} onChange={(e) => setField("periodEnd", e.target.value)} disabled={locked} /></FormField>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Подпись Исполнителя (ФИО)"><Input value={state.sellerSignatory} onChange={(e) => setField("sellerSignatory", e.target.value)} disabled={locked} /></FormField>
                <FormField label="Подпись Заказчика (ФИО)"><Input value={state.buyerSignatory} onChange={(e) => setField("buyerSignatory", e.target.value)} disabled={locked} /></FormField>
              </div>
            </>
          ) : null}

          {kind === "upds" ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Тип УПД">
                  <Select value={state.functionType} onValueChange={(v) => setField("functionType", v)} disabled={locked}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FULL">Статус 1 (СЧФ + ДОП)</SelectItem>
                      <SelectItem value="TRANSFER_ONLY">Статус 2 (только ДОП)</SelectItem>
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField label="Дата отгрузки"><Input type="date" value={state.shipmentDate} onChange={(e) => setField("shipmentDate", e.target.value)} disabled={locked} /></FormField>
              </div>
              <FormField label="Адрес грузополучателя"><Input value={state.shipmentAddress} onChange={(e) => setField("shipmentAddress", e.target.value)} disabled={locked} /></FormField>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Номер ГТД (для импорта)"><Input value={state.customsDecl} onChange={(e) => setField("customsDecl", e.target.value)} disabled={locked} /></FormField>
                <FormField label="К п/п (при предоплате)"><Input value={state.paymentDocRef} onChange={(e) => setField("paymentDocRef", e.target.value)} disabled={locked} /></FormField>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Подпись Продавца (ФИО)"><Input value={state.sellerSignatory} onChange={(e) => setField("sellerSignatory", e.target.value)} disabled={locked} /></FormField>
                <FormField label="Подпись Покупателя (ФИО)"><Input value={state.buyerSignatory} onChange={(e) => setField("buyerSignatory", e.target.value)} disabled={locked} /></FormField>
              </div>
            </>
          ) : null}

          {kind === "waybills" ? (
            <>
              <FormField label="Тип операции">
                <Select value={state.operationType} onValueChange={(v) => setField("operationType", v)} disabled={locked}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SALE">Отгрузка покупателю</SelectItem>
                    <SelectItem value="PURCHASE">Приём от поставщика</SelectItem>
                    <SelectItem value="RETURN">Возврат</SelectItem>
                    <SelectItem value="TRANSFER">Внутреннее перемещение</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Отпуск груза произвёл"><Input value={state.shippedBy} onChange={(e) => setField("shippedBy", e.target.value)} disabled={locked} /></FormField>
                <FormField label="Груз получил"><Input value={state.receivedBy} onChange={(e) => setField("receivedBy", e.target.value)} disabled={locked} /></FormField>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      {!isNew ? (
        <PrintWarnings
          url={`${cfg.apiPath}/${id}/print-warnings`}
          organizationId={state.organizationId}
          documentRoute={`${cfg.routePath}/${id}`}
        />
      ) : null}

      <Card>
        <CardContent className="pt-6">
          <ItemsEditor items={totals.items} vatIncluded={state.vatIncluded} onChange={setItems} disabled={locked} />
          <Separator className="my-4" />
          <div className="space-y-1 ml-auto max-w-md text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Итого без НДС:</span><span className="font-mono">{formatAmount(totals.subtotal)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">НДС:</span><span className="font-mono">{formatAmount(totals.vatAmount)}</span></div>
            <div className="flex justify-between text-base font-semibold"><span>Всего к оплате:</span><span className="font-mono">{formatAmount(totals.total, { withCurrency: true })}</span></div>
          </div>
        </CardContent>
      </Card>

      {/* Платежи по счёту (только для invoices, существующий документ) */}
      {!isNew && kind === "invoices" && paymentsByInvoice.data ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base flex items-center gap-2">
              <Wallet className="h-4 w-4" /> Платежи
            </CardTitle>
            <Button size="sm" variant="outline" onClick={() => setPaymentDialogOpen(true)} disabled={paymentsByInvoice.data.balance <= 0.005}>
              <Plus className="h-4 w-4" /> Внести оплату
            </Button>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3 mb-4 text-sm">
              <div>
                <div className="text-muted-foreground">Сумма счёта</div>
                <div className="font-mono font-medium">{formatAmount(paymentsByInvoice.data.total, { withCurrency: true })}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Оплачено</div>
                <div className="font-mono font-medium text-emerald-700">{formatAmount(paymentsByInvoice.data.paid, { withCurrency: true })}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Остаток</div>
                <div className={`font-mono font-medium ${paymentsByInvoice.data.balance > 0.005 ? "text-amber-700" : "text-emerald-700"}`}>
                  {formatAmount(paymentsByInvoice.data.balance, { withCurrency: true })}
                </div>
              </div>
            </div>
            {paymentsByInvoice.data.allocations.length > 0 ? (
              <div className="space-y-1 text-sm">
                {paymentsByInvoice.data.allocations.map((a) => (
                  <div key={a.id} className="flex justify-between border-b py-1 last:border-0">
                    <div>
                      <span className="text-muted-foreground">{a.payment.date.slice(0, 10)}</span>
                      <span className="ml-2">{a.payment.reference ?? "—"}</span>
                    </div>
                    <span className="font-mono">{formatAmount(a.amount)} ₽</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">Платежей по этому счёту пока нет.</div>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="pt-6">
          <FormField label="Примечания">
            <Textarea value={state.notes} onChange={(e) => setField("notes", e.target.value)} rows={2} disabled={locked} />
          </FormField>
        </CardContent>
      </Card>

      {!isNew && kind === "invoices" && paymentDialogOpen ? (
        <PaymentDialog
          payment={null}
          presetInvoiceId={id}
          onClose={() => setPaymentDialogOpen(false)}
          onSaved={() => {
            setPaymentDialogOpen(false);
            qc.invalidateQueries({ queryKey: ["invoice-payments", id] });
            qc.invalidateQueries({ queryKey: [kind, id] });
            qc.invalidateQueries({ queryKey: [kind] });
          }}
        />
      ) : null}

      {!isNew ? (
        <>
          <PdfPreviewDialog
            open={previewOpen}
            onClose={() => setPreviewOpen(false)}
            url={`/api/v1${cfg.apiPath}/${id}/pdf`}
            fallbackName={`${cfg.titleSingular}-${state.number}.pdf`}
            title={`${cfg.titleSingular} ${state.number}`}
          />
          <HtmlPreviewDialog
            open={htmlPreviewOpen}
            onClose={() => setHtmlPreviewOpen(false)}
            previewUrl={`/api/v1${cfg.apiPath}/${id}/preview`}
            pdfUrl={`/api/v1${cfg.apiPath}/${id}/pdf`}
            warningsUrl={`${cfg.apiPath}/${id}/print-warnings`}
            organizationId={state.organizationId}
            documentRoute={`${cfg.routePath}/${id}`}
            fallbackName={`${cfg.titleSingular}-${state.number}.pdf`}
            title={`${cfg.titleSingular} ${state.number} — предпросмотр`}
          />
        </>
      ) : null}
    </div>
  );
}

function buildPayload(kind: DocKind, s: State, items: ItemRow[]) {
  const itemsPayload = items.map((it, idx) => ({
    sortOrder: idx + 1,
    name: it.name,
    unit: it.unit,
    unitCode: it.unitCode,
    quantity: Number(it.quantity),
    price: Number(it.price),
    vatRate: Number(it.vatRate),
  }));

  const base = {
    organizationId: s.organizationId,
    counterpartyId: s.counterpartyId,
    contractId: s.contractId || null,
    number: s.number || undefined,
    date: s.date,
    status: s.status,
    vatRate: Number(s.vatRate),
    vatIncluded: s.vatIncluded,
    notes: s.notes || null,
    items: itemsPayload,
  };
  if (kind === "invoices") {
    return {
      ...base,
      bankAccountId: s.bankAccountId || null,
      dueDate: s.dueDate || null,
      paymentPurpose: s.paymentPurpose || null,
    };
  }
  if (kind === "acts") {
    return {
      ...base,
      invoiceId: s.invoiceId || null,
      periodStart: s.periodStart || null,
      periodEnd: s.periodEnd || null,
      sellerSignatory: s.sellerSignatory || null,
      buyerSignatory: s.buyerSignatory || null,
    };
  }
  if (kind === "upds") {
    return {
      ...base,
      invoiceId: s.invoiceId || null,
      functionType: s.functionType,
      shipmentDate: s.shipmentDate || null,
      shipmentAddress: s.shipmentAddress || null,
      customsDecl: s.customsDecl || null,
      paymentDocRef: s.paymentDocRef || null,
      sellerSignatory: s.sellerSignatory || null,
      buyerSignatory: s.buyerSignatory || null,
    };
  }
  return {
    ...base,
    invoiceId: s.invoiceId || null,
    operationType: s.operationType,
    shippedBy: s.shippedBy || null,
    receivedBy: s.receivedBy || null,
  };
}
