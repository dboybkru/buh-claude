// HTML-предпросмотр печатных форм. Не дубль PDF — отдельный путь, который
// возвращает чистый, лёгкий HTML, удобный для просмотра в браузере перед
// скачиванием PDF. Изображения логотипа/печати/подписи отдаются через
// тот же /api/v1/files эндпойнт (поэтому нужны куки/JWT — модалка фронта это
// учитывает: использует Authorization-токен через fetch и подставляет blob).

import { extractPrintSettings, defaultVatLabel, type OrgPrintFields } from "./print-settings.js";
import { amountToWords } from "../pdf/lib/amount-to-words.js";
import type { DocumentKind } from "./print-warnings.js";

function esc(s: unknown): string {
  if (s == null) return "";
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function fmtMoney(n: unknown): string {
  if (n == null) return "";
  const num = Number(String(n));
  if (!isFinite(num)) return "";
  return num.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₽";
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("ru-RU");
}

function fmtDateLong(d: Date | string | null | undefined): string {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  const months = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  return `«${dt.getDate()}» ${months[dt.getMonth()]} ${dt.getFullYear()} г.`;
}

interface Party {
  name?: string | null;
  fullName?: string | null;
  inn?: string | null;
  kpp?: string | null;
  legalAddress?: string | null;
  bankAccounts?: Array<{ bankName: string; bik: string; account: string; corrAccount: string; isDefault: boolean }> | null;
}

interface Item {
  sortOrder: number;
  name: string;
  unit: string;
  quantity: unknown;
  price: unknown;
  vatRate: unknown;
  subtotal: unknown;
  vatAmount: unknown;
  total: unknown;
}

interface Org extends Party, Partial<OrgPrintFields> {
  logo?: string | null;
  stamp?: string | null;
  signature?: string | null;
  directorName?: string | null;
  directorPosition?: string | null;
  chiefAccountant?: string | null;
  accountantPosition?: string | null;
  entrepreneurName?: string | null;
  vatMode?: string | null;
  type?: string | null;
}

function imageTag(path: string | null | undefined, alt: string, w = 120): string {
  if (!path) return "";
  return `<img src="/api/v1/files/${esc(path)}" alt="${esc(alt)}" style="max-width:${w}px;max-height:${w}px;object-fit:contain;"/>`;
}

function commonStyles(): string {
  return `
    body { font-family: "PT Sans", system-ui, sans-serif; color: #111; margin: 24px; font-size: 13px; }
    h1 { font-size: 18px; text-align: center; margin: 4px 0; }
    .subtitle { text-align: center; color: #555; margin-bottom: 12px; }
    .hbox { display: flex; gap: 16px; align-items: flex-start; }
    .grow { flex: 1; }
    .party { border: 1px solid #ccc; border-radius: 4px; padding: 8px 10px; margin-bottom: 6px; }
    .party h3 { font-size: 11px; color: #666; text-transform: uppercase; margin: 0 0 4px 0; letter-spacing: .05em; }
    .party .name { font-weight: 600; }
    .muted { color: #555; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; margin: 8px 0; }
    th, td { border: 1px solid #444; padding: 4px 6px; font-size: 12px; }
    th { background: #eee; text-align: center; }
    td.r { text-align: right; }
    td.c { text-align: center; }
    .totals { width: 50%; margin-left: auto; }
    .totals td { border: none; padding: 2px 6px; }
    .totals .label { text-align: right; }
    .totals .value { text-align: right; font-weight: 600; }
    .sign-block { display: flex; justify-content: space-between; margin-top: 28px; gap: 24px; }
    .sign-col { flex: 1; }
    .sign-line { border-bottom: 1px solid #444; margin-top: 24px; height: 1px; position: relative; }
    .sign-line .stamp { position: absolute; right: 0; bottom: 0; opacity: .85; }
    .sign-line .sig { position: absolute; left: 16px; bottom: -2px; opacity: .9; }
    .sign-name { text-align: center; font-size: 11px; color: #555; margin-top: 4px; }
    .header-strip { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
    .header-strip .logo { width: 80px; }
    .header-strip .seller-block { flex: 1; }
    .footer { font-size: 11px; color: #777; margin-top: 16px; border-top: 1px dashed #ccc; padding-top: 8px; }
    .preview-banner { background: #fff8c4; padding: 8px 12px; border-radius: 4px; margin-bottom: 12px; font-size: 12px; color: #5a4a00; }
  `;
}

function partyHtml(title: string, p: Party, opts?: { showBank?: boolean }): string {
  const showBank = opts?.showBank ?? false;
  const acc = (p.bankAccounts ?? []).find((a) => a.isDefault) ?? (p.bankAccounts ?? [])[0];
  return `
  <div class="party">
    <h3>${esc(title)}</h3>
    <div class="name">${esc(p.fullName ?? p.name ?? "")}</div>
    <div class="muted">ИНН ${esc(p.inn ?? "")}${p.kpp ? ", КПП " + esc(p.kpp) : ""}${p.legalAddress ? ", " + esc(p.legalAddress) : ""}</div>
    ${showBank && acc ? `<div class="muted">${esc(acc.bankName)}, БИК ${esc(acc.bik)}, р/с ${esc(acc.account)}, к/с ${esc(acc.corrAccount)}</div>` : ""}
  </div>`;
}

function itemsTableHtml(items: Item[]): string {
  const rows = items
    .map(
      (it, idx) => `
    <tr>
      <td class="c">${esc(it.sortOrder ?? idx + 1)}</td>
      <td>${esc(it.name)}</td>
      <td class="c">${esc(it.unit)}</td>
      <td class="r">${esc(it.quantity)}</td>
      <td class="r">${fmtMoney(it.price)}</td>
      <td class="r">${fmtMoney(it.subtotal)}</td>
      <td class="c">${esc(it.vatRate)}%</td>
      <td class="r">${fmtMoney(it.vatAmount)}</td>
      <td class="r">${fmtMoney(it.total)}</td>
    </tr>`,
    )
    .join("");
  return `
  <table>
    <thead>
      <tr>
        <th style="width:30px;">№</th>
        <th>Наименование</th>
        <th style="width:40px;">Ед.</th>
        <th style="width:60px;">Кол-во</th>
        <th style="width:90px;">Цена</th>
        <th style="width:110px;">Сумма без НДС</th>
        <th style="width:60px;">НДС %</th>
        <th style="width:100px;">Сумма НДС</th>
        <th style="width:110px;">Всего с НДС</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function totalsHtml(subtotal: unknown, vatAmount: unknown, total: unknown, vatLabel?: string | null): string {
  return `
  <table class="totals">
    <tr><td class="label">Итого без НДС:</td><td class="value">${fmtMoney(subtotal)}</td></tr>
    <tr><td class="label">${esc(vatLabel ?? "В том числе НДС")}:</td><td class="value">${fmtMoney(vatAmount)}</td></tr>
    <tr><td class="label">Всего к оплате:</td><td class="value">${fmtMoney(total)}</td></tr>
  </table>`;
}

function signaturesHtml(
  org: Org,
  showStamp: boolean,
  showSig: boolean,
  showAcc: boolean,
  leftLabel = "Руководитель",
  rightLabel = "Главный бухгалтер",
  rightName?: string | null,
  leftName?: string | null,
): string {
  const ldir = leftName ?? org.directorName ?? org.entrepreneurName ?? "";
  const ldirPos = org.directorPosition ?? (org.type === "IP" ? "ИП" : "Руководитель");
  const rname = rightName ?? org.chiefAccountant ?? "";
  return `
  <div class="sign-block">
    <div class="sign-col">
      <div class="muted">${esc(leftLabel)}${ldirPos ? " (" + esc(ldirPos) + ")" : ""}</div>
      <div class="sign-line">
        ${showSig ? `<span class="sig">${imageTag(org.signature, "подпись", 120)}</span>` : ""}
        ${showStamp ? `<span class="stamp">${imageTag(org.stamp, "печать", 100)}</span>` : ""}
      </div>
      <div class="sign-name">${esc(ldir || "(подпись, расшифровка)")}</div>
    </div>
    ${showAcc ? `
    <div class="sign-col">
      <div class="muted">${esc(rightLabel)}</div>
      <div class="sign-line"></div>
      <div class="sign-name">${esc(rname || "(подпись, расшифровка)")}</div>
    </div>` : ""}
  </div>`;
}

function headerStrip(org: Org, showLogo: boolean, showBank: boolean): string {
  const acc = (org.bankAccounts ?? []).find((a) => a.isDefault) ?? (org.bankAccounts ?? [])[0];
  return `
  <div class="header-strip">
    ${showLogo ? `<div class="logo">${imageTag(org.logo, "логотип", 80)}</div>` : ""}
    <div class="seller-block">
      <div class="name" style="font-weight:600;">${esc(org.fullName ?? org.name ?? "")}</div>
      <div class="muted">ИНН ${esc(org.inn ?? "")}${org.kpp ? ", КПП " + esc(org.kpp) : ""}${org.legalAddress ? " • " + esc(org.legalAddress) : ""}</div>
      ${showBank && acc ? `<div class="muted">${esc(acc.bankName)}, БИК ${esc(acc.bik)}, р/с ${esc(acc.account)}</div>` : ""}
    </div>
  </div>`;
}

export interface PreviewInvoiceInput {
  number: string;
  date: Date | string;
  dueDate?: Date | string | null;
  paymentPurpose?: string | null;
  notes?: string | null;
  subtotal: unknown;
  vatAmount: unknown;
  total: unknown;
  organization: Org;
  counterparty: Party;
  items: Item[];
}

export interface PreviewActInput {
  number: string;
  date: Date | string;
  periodStart?: Date | string | null;
  periodEnd?: Date | string | null;
  subtotal: unknown;
  vatAmount: unknown;
  total: unknown;
  organization: Org;
  counterparty: Party;
  items: Item[];
  sellerSignatory?: string | null;
  buyerSignatory?: string | null;
}

export interface PreviewUpdInput {
  number: string;
  date: Date | string;
  functionType: string;
  subtotal: unknown;
  vatAmount: unknown;
  total: unknown;
  organization: Org;
  counterparty: Party;
  items: Item[];
  shipmentDate?: Date | string | null;
  shipmentAddress?: string | null;
  sellerSignatory?: string | null;
  buyerSignatory?: string | null;
}

export interface PreviewWaybillInput {
  number: string;
  date: Date | string;
  operationType: string;
  subtotal: unknown;
  vatAmount: unknown;
  total: unknown;
  organization: Org;
  counterparty: Party;
  items: Item[];
  shippedBy?: string | null;
  receivedBy?: string | null;
}

export interface PreviewReconciliationInput {
  number: string;
  date: Date | string;
  periodFrom: Date | string;
  periodTo: Date | string;
  openingBalance: number;
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
  lines: Array<{ date: string; description: string; debit: number; credit: number }>;
  organization: Org;
  counterparty: Party;
}

export interface PreviewContractInput {
  number: string;
  date: Date | string;
  amount?: unknown;
  organization: Org;
  counterparty: Party;
  /** Уже отрендеренный текст шаблона (с подстановкой переменных). */
  body: string;
}

function wrapDoc(title: string, content: string): string {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${commonStyles()}</style></head><body>${content}</body></html>`;
}

export function previewInvoice(p: PreviewInvoiceInput): string {
  const s = extractPrintSettings(p.organization);
  const vatLabel = defaultVatLabel(p.organization.vatMode ?? null, s.defaultVatText);
  const content = `
    <div class="preview-banner">Предпросмотр печатной формы. Юридическую силу имеет только подписанный документ.</div>
    ${headerStrip(p.organization, s.showLogo, s.showBankDetails)}
    <h1>Счёт на оплату № ${esc(p.number)} от ${esc(fmtDateLong(p.date))}</h1>
    ${p.dueDate ? `<div class="subtitle">Срок оплаты: ${esc(fmtDate(p.dueDate))}</div>` : ""}
    <div class="hbox">
      <div class="grow">${partyHtml("Поставщик", p.organization, { showBank: s.showBankDetails })}</div>
      <div class="grow">${partyHtml("Покупатель", p.counterparty)}</div>
    </div>
    ${p.paymentPurpose ? `<div class="muted"><b>Назначение платежа:</b> ${esc(p.paymentPurpose)}</div>` : ""}
    ${s.defaultPaymentTerms ? `<div class="muted"><b>Условия оплаты:</b> ${esc(s.defaultPaymentTerms)}</div>` : ""}
    ${itemsTableHtml(p.items)}
    ${totalsHtml(p.subtotal, p.vatAmount, p.total, vatLabel)}
    <div class="muted" style="margin-top:6px;">Сумма прописью: <b>${esc(amountToWords(Number(String(p.total))))}</b></div>
    ${signaturesHtml(p.organization, s.showStamp, s.showSignature, s.showAccountantSignature)}
    ${s.invoiceNote ? `<div class="muted" style="margin-top:8px;">${esc(s.invoiceNote)}</div>` : ""}
    ${p.notes ? `<div class="muted" style="margin-top:6px;">Примечание: ${esc(p.notes)}</div>` : ""}
    ${s.defaultFooterText ? `<div class="footer">${esc(s.defaultFooterText)}</div>` : ""}
    ${s.showQrCode ? `<div class="muted" style="margin-top:8px;">QR-код для оплаты — TODO (MVP).</div>` : ""}
  `;
  return wrapDoc(`Счёт ${p.number}`, content);
}

export function previewAct(p: PreviewActInput): string {
  const s = extractPrintSettings(p.organization);
  const vatLabel = defaultVatLabel(p.organization.vatMode ?? null, s.defaultVatText);
  const content = `
    <div class="preview-banner">Предпросмотр печатной формы. Юридическую силу имеет только подписанный документ.</div>
    ${headerStrip(p.organization, s.showLogo, false)}
    <h1>Акт № ${esc(p.number)} от ${esc(fmtDateLong(p.date))}</h1>
    <div class="subtitle">оказанных услуг / выполненных работ</div>
    <div class="hbox">
      <div class="grow">${partyHtml("Исполнитель", p.organization)}</div>
      <div class="grow">${partyHtml("Заказчик", p.counterparty)}</div>
    </div>
    ${p.periodStart || p.periodEnd ? `<div class="muted">Период: ${esc(fmtDate(p.periodStart))} — ${esc(fmtDate(p.periodEnd))}</div>` : ""}
    <p class="muted">В соответствии с настоящим Актом Исполнитель передал, а Заказчик принял следующие работы (услуги):</p>
    ${itemsTableHtml(p.items)}
    ${totalsHtml(p.subtotal, p.vatAmount, p.total, vatLabel)}
    <div class="muted" style="margin-top:6px;">Сумма прописью: <b>${esc(amountToWords(Number(String(p.total))))}</b></div>
    <p class="muted">Работы (услуги) выполнены полностью и в срок. Заказчик претензий по объёму, качеству и срокам не имеет.</p>
    ${signaturesHtml(p.organization, s.showStamp, s.showSignature, false, "От Исполнителя", "От Заказчика", p.buyerSignatory, p.sellerSignatory)}
    ${s.actNote ? `<div class="muted" style="margin-top:8px;">${esc(s.actNote)}</div>` : ""}
    ${s.defaultFooterText ? `<div class="footer">${esc(s.defaultFooterText)}</div>` : ""}
  `;
  return wrapDoc(`Акт ${p.number}`, content);
}

export function previewUpd(p: PreviewUpdInput): string {
  const s = extractPrintSettings(p.organization);
  const vatLabel = defaultVatLabel(p.organization.vatMode ?? null, s.defaultVatText);
  const statusLabel = p.functionType === "FULL"
    ? "Статус 1 (счёт-фактура + передаточный документ)"
    : "Статус 2 (только передаточный документ)";
  const content = `
    <div class="preview-banner">Предпросмотр печатной формы. УПД отображается в упрощённом виде, без строгого соответствия гос. форме.</div>
    ${headerStrip(p.organization, s.showLogo, false)}
    <div class="muted" style="text-align:right;"><b>${esc(statusLabel)}</b></div>
    <h1>УПД № ${esc(p.number)} от ${esc(fmtDateLong(p.date))}</h1>
    <div class="hbox">
      <div class="grow">${partyHtml("Продавец (грузоотправитель)", p.organization)}</div>
      <div class="grow">${partyHtml("Покупатель (грузополучатель)", p.counterparty)}</div>
    </div>
    ${p.shipmentDate ? `<div class="muted">Дата отгрузки: ${esc(fmtDate(p.shipmentDate))}</div>` : ""}
    ${p.shipmentAddress ? `<div class="muted">Адрес доставки: ${esc(p.shipmentAddress)}</div>` : ""}
    ${itemsTableHtml(p.items)}
    ${totalsHtml(p.subtotal, p.vatAmount, p.total, vatLabel)}
    <div class="muted" style="margin-top:6px;">Сумма прописью: <b>${esc(amountToWords(Number(String(p.total))))}</b></div>
    ${signaturesHtml(p.organization, s.showStamp, s.showSignature, false, "Руководитель организации (продавец)", "Покупатель", p.buyerSignatory, p.sellerSignatory)}
    ${s.updNote ? `<div class="muted" style="margin-top:8px;">${esc(s.updNote)}</div>` : ""}
    <div class="footer">Форма соответствует приказу ФНС России от 19.12.2018 № ММВ-7-15/820@ (упрощённый MVP).</div>
  `;
  return wrapDoc(`УПД ${p.number}`, content);
}

export function previewWaybill(p: PreviewWaybillInput): string {
  const s = extractPrintSettings(p.organization);
  const vatLabel = defaultVatLabel(p.organization.vatMode ?? null, s.defaultVatText);
  const content = `
    <div class="preview-banner">Предпросмотр печатной формы ТОРГ-12 (упрощённый MVP).</div>
    ${headerStrip(p.organization, s.showLogo, false)}
    <h1>Товарная накладная № ${esc(p.number)} от ${esc(fmtDateLong(p.date))}</h1>
    <div class="hbox">
      <div class="grow">${partyHtml("Грузоотправитель", p.organization)}</div>
      <div class="grow">${partyHtml("Грузополучатель", p.counterparty)}</div>
    </div>
    ${itemsTableHtml(p.items)}
    ${totalsHtml(p.subtotal, p.vatAmount, p.total, vatLabel)}
    <div class="muted" style="margin-top:6px;">Всего отпущено на сумму: <b>${esc(amountToWords(Number(String(p.total))))}</b></div>
    ${signaturesHtml(p.organization, s.showStamp, s.showSignature, false, "Отпуск груза произвёл", "Груз получил", p.receivedBy, p.shippedBy)}
    ${s.waybillNote ? `<div class="muted" style="margin-top:8px;">${esc(s.waybillNote)}</div>` : ""}
    <div class="footer">Форма утверждена постановлением Госкомстата России от 25.12.1998 № 132 (упрощённый MVP).</div>
  `;
  return wrapDoc(`Накладная ${p.number}`, content);
}

export function previewReconciliation(p: PreviewReconciliationInput): string {
  const s = extractPrintSettings(p.organization);
  const closingPositive = p.closingBalance >= 0;
  const rows = p.lines.map((line) => `
    <tr>
      <td class="c">${esc(fmtDate(line.date))}</td>
      <td>${esc(line.description)}</td>
      <td class="r">${line.debit > 0 ? fmtMoney(line.debit) : ""}</td>
      <td class="r">${line.credit > 0 ? fmtMoney(line.credit) : ""}</td>
    </tr>`).join("");

  const content = `
    <div class="preview-banner">Предпросмотр акта сверки.</div>
    ${headerStrip(p.organization, s.showLogo, false)}
    <h1>Акт сверки взаимных расчётов № ${esc(p.number)}</h1>
    <div class="subtitle">от ${esc(fmtDateLong(p.date))} за период ${esc(fmtDate(p.periodFrom))} — ${esc(fmtDate(p.periodTo))}</div>
    <div class="hbox">
      <div class="grow">${partyHtml("Организация (наша)", p.organization)}</div>
      <div class="grow">${partyHtml("Контрагент", p.counterparty)}</div>
    </div>
    <table>
      <thead><tr><th style="width:90px;">Дата</th><th>Документ / основание</th><th style="width:120px;">Дебет</th><th style="width:120px;">Кредит</th></tr></thead>
      <tbody>
        <tr><td class="c">${esc(fmtDate(p.periodFrom))}</td><td>Сальдо на начало периода</td>
          <td class="r">${p.openingBalance > 0 ? fmtMoney(p.openingBalance) : ""}</td>
          <td class="r">${p.openingBalance < 0 ? fmtMoney(-p.openingBalance) : ""}</td>
        </tr>
        ${rows}
        <tr style="background:#f5f5f5;"><td></td><td><b>Обороты за период</b></td>
          <td class="r"><b>${fmtMoney(p.totalDebit)}</b></td>
          <td class="r"><b>${fmtMoney(p.totalCredit)}</b></td>
        </tr>
        <tr style="background:#e8e8e8;"><td class="c">${esc(fmtDate(p.periodTo))}</td><td><b>Сальдо на конец периода</b></td>
          <td class="r"><b>${closingPositive ? fmtMoney(p.closingBalance) : ""}</b></td>
          <td class="r"><b>${!closingPositive ? fmtMoney(-p.closingBalance) : ""}</b></td>
        </tr>
      </tbody>
    </table>
    ${signaturesHtml(p.organization, s.showStamp, s.showSignature, false, `От ${p.organization.name ?? "организации"}`, `От ${p.counterparty.name ?? "контрагента"}`)}
    ${s.reconciliationNote ? `<div class="muted" style="margin-top:8px;">${esc(s.reconciliationNote)}</div>` : ""}
    ${s.defaultFooterText ? `<div class="footer">${esc(s.defaultFooterText)}</div>` : ""}
  `;
  return wrapDoc(`Акт сверки ${p.number}`, content);
}

export function previewContract(p: PreviewContractInput): string {
  const s = extractPrintSettings(p.organization);
  // body — заранее отрендеренный текст шаблона. Превращаем переводы строк в <p>.
  const paragraphs = p.body
    .split(/\n{2,}/)
    .map((para) => `<p>${esc(para).replaceAll("\n", "<br/>")}</p>`)
    .join("");
  const content = `
    <div class="preview-banner">Предпросмотр договора. Юридическую силу имеет только подписанный документ.</div>
    ${headerStrip(p.organization, s.showLogo, false)}
    <h1>Договор № ${esc(p.number)} от ${esc(fmtDateLong(p.date))}</h1>
    <div style="font-size:13px; line-height:1.6;">${paragraphs}</div>
    ${signaturesHtml(p.organization, s.showStamp, s.showSignature, false, `От ${p.organization.name ?? "организации"}`, `От ${p.counterparty.name ?? "контрагента"}`)}
    ${s.defaultFooterText ? `<div class="footer">${esc(s.defaultFooterText)}</div>` : ""}
  `;
  return wrapDoc(`Договор ${p.number}`, content);
}

export type PreviewInput =
  | { kind: "invoice"; data: PreviewInvoiceInput }
  | { kind: "act"; data: PreviewActInput }
  | { kind: "upd"; data: PreviewUpdInput }
  | { kind: "waybill"; data: PreviewWaybillInput }
  | { kind: "reconciliation"; data: PreviewReconciliationInput }
  | { kind: "contract"; data: PreviewContractInput };

export function renderPreview(input: PreviewInput): string {
  switch (input.kind) {
    case "invoice": return previewInvoice(input.data);
    case "act": return previewAct(input.data);
    case "upd": return previewUpd(input.data);
    case "waybill": return previewWaybill(input.data);
    case "reconciliation": return previewReconciliation(input.data);
    case "contract": return previewContract(input.data);
  }
}

export type { DocumentKind };
