/* eslint-disable no-console */
// Sprint 5.1: print-check
// Генерирует PDF и HTML preview всех 6 типов документов из in-memory stress-fixture
// в tmp/print-check/. БД не нужна, БД не трогает. Используется как ручной smoke
// для проверки печатных форм глазами.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import React from "react";

import { renderPdfStream } from "../src/pdf/render.js";
import { InvoicePdf } from "../src/pdf/templates/InvoicePdf.js";
import { ActPdf } from "../src/pdf/templates/ActPdf.js";
import { UpdPdf } from "../src/pdf/templates/UpdPdf.js";
import { WaybillPdf } from "../src/pdf/templates/WaybillPdf.js";
import { ContractPdf } from "../src/pdf/templates/ContractPdf.js";
import { ReconciliationPdf } from "../src/pdf/templates/ReconciliationPdf.js";
import { previewInvoice, previewAct, previewUpd, previewWaybill, previewContract, previewReconciliation } from "../src/lib/html-preview.js";
import { extractPrintSettings, defaultVatLabel } from "../src/lib/print-settings.js";
import type { PartyInfo, SellerAssets, PrintFlags } from "../src/pdf/templates/common.js";
import { renderContract } from "../src/lib/contract-template.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..", "..");
const OUT_DIR = path.join(REPO_ROOT, "tmp", "print-check");
const ASSET_DIR = path.join(OUT_DIR, "assets");

/* ----------------------------- mini-PNG helpers ----------------------------- */
// Минимальный валидный PNG-генератор (без сторонних библиотек).
// Создаёт 1×1 PNG нужного цвета — react-pdf принимает любой валидный PNG.

import zlib from "node:zlib";

function crc32(buf: Buffer): number {
  let c: number;
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (table[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** Создаёт PNG нужного размера с заливкой указанного цвета (rgba). */
function makePng(width: number, height: number, rgba: [number, number, number, number]): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;       // bit depth
  ihdr[9] = 6;       // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const ihdrChunk = chunk("IHDR", ihdr);

  // Raw image: filter byte 0 + rgba per pixel per row
  const rowLength = 1 + width * 4;
  const raw = Buffer.alloc(rowLength * height);
  for (let y = 0; y < height; y++) {
    raw[y * rowLength] = 0;
    for (let x = 0; x < width; x++) {
      const base = y * rowLength + 1 + x * 4;
      raw[base] = rgba[0];
      raw[base + 1] = rgba[1];
      raw[base + 2] = rgba[2];
      raw[base + 3] = rgba[3];
    }
  }
  const compressed = zlib.deflateSync(raw);
  const idatChunk = chunk("IDAT", compressed);
  const iendChunk = chunk("IEND", Buffer.alloc(0));
  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

/* ----------------------------- fixtures ----------------------------- */

const SELLER: PartyInfo = {
  name: "ООО «Альфа-Технология-Сервис»",
  fullName: "Общество с ограниченной ответственностью «Альфа-Технология-Сервис производственно-коммерческое предприятие»",
  inn: "7707083893",
  kpp: "770701001",
  legalAddress: "117997, г. Москва, Юго-Западный административный округ, ул. Вавилова, дом 19, корпус 2, помещение III, комната 7",
  bankName: "ПАО «Сбербанк России» (Московский головной банк, доп.офис №9038/01234)",
  bik: "044525225",
  account: "40702810900000000001",
  corrAccount: "30101810400000000225",
};

const BUYER: PartyInfo = {
  name: "ООО «Бета»",
  fullName: "Общество с ограниченной ответственностью «Бета-Промышленные-Решения-Восточной-Сибири»",
  inn: "7728168971",
  kpp: "772801001",
  legalAddress: "664047, Иркутская обл., г. Иркутск, ул. Декабрьских Событий, дом 78А, офис 412",
};

const FLAGS: PrintFlags = {
  showLogo: true,
  showStamp: true,
  showSignature: true,
  showAccountantSignature: true,
  showBankDetails: true,
};

// Заполняется ниже после генерации PNG
const ASSETS: SellerAssets = { logoPath: null, stampPath: null, signaturePath: null };

function manyItems() {
  return Array.from({ length: 17 }, (_, i) => {
    const idx = i + 1;
    const qty = (idx % 4) + 1;
    const price = 1500 + idx * 137;
    const subtotal = qty * price;
    const vatRate = 22;
    const vatAmount = Math.round((subtotal * vatRate) / 122 * 100) / 100;
    return {
      sortOrder: idx,
      name: `Услуга №${idx} — комплексное консультационное сопровождение раздела бухгалтерского учёта с особыми условиями и расширенным SLA для ${BUYER.name}`,
      unit: idx % 3 === 0 ? "ч" : "шт",
      quantity: qty,
      price,
      vatRate,
      subtotal: subtotal - vatAmount,
      vatAmount,
      total: subtotal,
    };
  });
}

function oneItem() {
  return [{
    sortOrder: 1,
    name: "Консультация",
    unit: "ч",
    quantity: 1,
    price: 5000,
    vatRate: 22,
    subtotal: 4098.36,
    vatAmount: 901.64,
    total: 5000,
  }];
}

function noVatItems() {
  return [
    { sortOrder: 1, name: "Услуга по освобождённому от НДС виду деятельности (НК РФ ст. 149)", unit: "шт", quantity: 1, price: 25000, vatRate: 0, subtotal: 25000, vatAmount: 0, total: 25000 },
    { sortOrder: 2, name: "Дополнительный комплект документов", unit: "шт", quantity: 3, price: 1500, vatRate: 0, subtotal: 4500, vatAmount: 0, total: 4500 },
  ];
}

function mixedRates() {
  return [
    { sortOrder: 1, name: "Товар по ставке 22%", unit: "шт", quantity: 2, price: 1000, vatRate: 22, subtotal: 1639.34, vatAmount: 360.66, total: 2000 },
    { sortOrder: 2, name: "Детское питание (НДС 10% — НК РФ ст. 164)", unit: "шт", quantity: 5, price: 500, vatRate: 10, subtotal: 2272.73, vatAmount: 227.27, total: 2500 },
    { sortOrder: 3, name: "Экспортная поставка (ставка 0%)", unit: "шт", quantity: 1, price: 10000, vatRate: 0, subtotal: 10000, vatAmount: 0, total: 10000 },
  ];
}

function sumTotals(items: Array<{ subtotal: number; vatAmount: number; total: number }>) {
  return items.reduce(
    (a, x) => ({ subtotal: a.subtotal + x.subtotal, vatAmount: a.vatAmount + x.vatAmount, total: a.total + x.total }),
    { subtotal: 0, vatAmount: 0, total: 0 },
  );
}

/* ----------------------------- runner ----------------------------- */

async function writePdf(name: string, element: React.ReactElement): Promise<void> {
  const stream = await renderPdfStream(element);
  const chunks: Buffer[] = [];
  for await (const c of stream as AsyncIterable<Buffer>) chunks.push(c);
  const outPath = path.join(OUT_DIR, name);
  await fs.writeFile(outPath, Buffer.concat(chunks));
  const stat = await fs.stat(outPath);
  console.log(`  ✓ ${name}  (${(stat.size / 1024).toFixed(1)} KB)`);
}

async function writeHtml(name: string, html: string): Promise<void> {
  const outPath = path.join(OUT_DIR, name);
  await fs.writeFile(outPath, html, "utf8");
  console.log(`  ✓ ${name}  (${(html.length / 1024).toFixed(1)} KB)`);
}

/** Используется в HTML preview — заменяем /api/v1/files/<path> на data:image/png;base64,... */
function inlineImages(html: string, mapping: Record<string, string>): string {
  let out = html;
  for (const [filePath, dataUri] of Object.entries(mapping)) {
    out = out.replaceAll(`/api/v1/files/${filePath}`, dataUri);
  }
  return out;
}

async function main(): Promise<void> {
  console.log("→ print-check: stress-rendering print forms");

  await fs.mkdir(ASSET_DIR, { recursive: true });

  // 1. Mini-PNG для логотипа / печати / подписи
  const logo = makePng(120, 60, [33, 90, 200, 255]);
  const stamp = makePng(160, 160, [180, 30, 30, 200]);
  const sig = makePng(200, 60, [20, 20, 20, 255]);

  const logoPath = path.join(ASSET_DIR, "logo.png");
  const stampPath = path.join(ASSET_DIR, "stamp.png");
  const sigPath = path.join(ASSET_DIR, "signature.png");
  await fs.writeFile(logoPath, logo);
  await fs.writeFile(stampPath, stamp);
  await fs.writeFile(sigPath, sig);
  // @react-pdf 4.x в node-среде принимает только URL и data-URI — встраиваем base64.
  ASSETS.logoPath = `data:image/png;base64,${logo.toString("base64")}`;
  ASSETS.stampPath = `data:image/png;base64,${stamp.toString("base64")}`;
  ASSETS.signaturePath = `data:image/png;base64,${sig.toString("base64")}`;
  void pathToFileURL;

  // Inline-маппинг для HTML preview (превращаем /api/v1/files/x в data: URL)
  const inlineMap: Record<string, string> = {
    "demo/logo.png": `data:image/png;base64,${logo.toString("base64")}`,
    "demo/stamp.png": `data:image/png;base64,${stamp.toString("base64")}`,
    "demo/signature.png": `data:image/png;base64,${sig.toString("base64")}`,
  };

  // Для HTML preview организация имеет относительные пути; путь подставляется в `/api/v1/files/<x>`.
  const orgHtmlForPreview = {
    name: SELLER.name,
    fullName: SELLER.fullName,
    inn: SELLER.inn,
    kpp: SELLER.kpp,
    legalAddress: SELLER.legalAddress,
    bankAccounts: [{ bankName: SELLER.bankName!, bik: SELLER.bik!, account: SELLER.account!, corrAccount: SELLER.corrAccount!, isDefault: true }],
    logo: "demo/logo.png",
    stamp: "demo/stamp.png",
    signature: "demo/signature.png",
    directorName: "Иванов Иван Иванович",
    directorPosition: "Генеральный директор",
    chiefAccountant: "Петрова Мария Сергеевна",
    accountantPosition: "Главный бухгалтер",
    vatMode: "GENERAL",
    type: "OOO",
    printShowLogo: true,
    printShowStamp: true,
    printShowSignature: true,
    printShowAccountantSignature: true,
    printShowBankDetails: true,
    printShowQrCode: false,
    printDefaultPaymentTerms: "Оплата в течение 14 банковских дней с момента получения счёта. При просрочке начисляется пеня 0,1% за каждый день просрочки.",
    printDefaultFooterText: "Документ сформирован в системе BuhClaude. Без подписи и печати юридической силы не имеет. © 2026 ООО «Альфа-Технология-Сервис».",
    printInvoiceNote: "При оплате просим указывать номер и дату счёта в назначении платежа.",
  };

  const settings = extractPrintSettings(orgHtmlForPreview);
  const vatLabel = defaultVatLabel("GENERAL", settings.defaultVatText);

  /* ---------- Invoice: 1 позиция ---------- */
  {
    const items = oneItem();
    const t = sumTotals(items);
    await writePdf("invoice-one-page.pdf", React.createElement(InvoicePdf, {
      number: "СЧ-0001/2026",
      date: "2026-05-21",
      dueDate: "2026-06-04",
      paymentPurpose: "Оплата по счёту СЧ-0001/2026 от 21.05.2026 за консультационные услуги. В т.ч. НДС 22%.",
      notes: null,
      subtotal: t.subtotal, vatAmount: t.vatAmount, total: t.total,
      seller: SELLER, buyer: BUYER, items,
      signatoryDirector: "Иванов И.И.",
      signatoryAccountant: "Петрова М.С.",
      flags: FLAGS, assets: ASSETS, vatLabel,
      defaultPaymentTerms: settings.defaultPaymentTerms,
      defaultFooterText: settings.defaultFooterText,
      invoiceNote: settings.invoiceNote,
      showQrCode: false,
    }));
    const html = previewInvoice({
      number: "СЧ-0001/2026", date: "2026-05-21", dueDate: "2026-06-04",
      paymentPurpose: "Оплата по счёту СЧ-0001/2026 от 21.05.2026", notes: null,
      subtotal: t.subtotal, vatAmount: t.vatAmount, total: t.total,
      organization: orgHtmlForPreview as any, counterparty: BUYER as any, items: items as any,
    });
    await writeHtml("invoice-preview.html", inlineImages(html, inlineMap));
  }

  /* ---------- Invoice: 17 позиций (multi-page) ---------- */
  {
    const items = manyItems();
    const t = sumTotals(items);
    await writePdf("invoice-many-items.pdf", React.createElement(InvoicePdf, {
      number: "СЧ-0002/2026",
      date: "2026-05-21",
      dueDate: "2026-06-15",
      paymentPurpose: "Оплата по счёту СЧ-0002/2026 за услуги мая 2026 г.",
      notes: "Цены действительны до 31.12.2026. По акции — скидка 5% при оплате в течение 3 дней.",
      subtotal: t.subtotal, vatAmount: t.vatAmount, total: t.total,
      seller: SELLER, buyer: BUYER, items,
      signatoryDirector: "Иванов И.И.",
      signatoryAccountant: "Петрова М.С.",
      flags: FLAGS, assets: ASSETS, vatLabel,
      defaultPaymentTerms: settings.defaultPaymentTerms,
      defaultFooterText: settings.defaultFooterText,
      invoiceNote: settings.invoiceNote,
    }));
  }

  /* ---------- Invoice: без НДС ---------- */
  {
    const items = noVatItems();
    const t = sumTotals(items);
    const orgExempt = { ...orgHtmlForPreview, vatMode: "EXEMPT" };
    await writePdf("invoice-no-vat.pdf", React.createElement(InvoicePdf, {
      number: "СЧ-0003/2026",
      date: "2026-05-21",
      dueDate: "2026-06-04",
      paymentPurpose: "Оплата по счёту № СЧ-0003/2026. Без НДС.",
      notes: null,
      subtotal: t.subtotal, vatAmount: 0, total: t.total,
      seller: SELLER, buyer: BUYER, items,
      signatoryDirector: "Иванов И.И.",
      flags: FLAGS, assets: ASSETS,
      vatLabel: defaultVatLabel("EXEMPT", null),
      defaultPaymentTerms: settings.defaultPaymentTerms,
      defaultFooterText: settings.defaultFooterText,
    }));
    void orgExempt;
  }

  /* ---------- Act ---------- */
  {
    const items = mixedRates();
    const t = sumTotals(items);
    await writePdf("act.pdf", React.createElement(ActPdf, {
      number: "АКТ-0001/2026",
      date: "2026-05-21",
      periodStart: "2026-05-01",
      periodEnd: "2026-05-31",
      subtotal: t.subtotal, vatAmount: t.vatAmount, total: t.total,
      seller: SELLER, buyer: BUYER, items,
      sellerSignatory: "Иванов И.И.",
      buyerSignatory: "Сидоров А.П.",
      notes: "Услуги оказаны в полном объёме. Подписано через ЭДО.",
      flags: FLAGS, assets: ASSETS, vatLabel,
      defaultFooterText: settings.defaultFooterText,
      actNote: settings.actNote,
    }));
  }

  /* ---------- UPD ---------- */
  {
    const items = manyItems().slice(0, 5);
    const t = sumTotals(items);
    await writePdf("upd.pdf", React.createElement(UpdPdf, {
      number: "УПД-0001/2026",
      date: "2026-05-21",
      functionType: "FULL",
      subtotal: t.subtotal, vatAmount: t.vatAmount, total: t.total,
      seller: SELLER, buyer: BUYER, items,
      shipmentDate: "2026-05-22",
      shipmentAddress: "664047, Иркутская обл., г. Иркутск, ул. Декабрьских Событий, дом 78А, склад №3",
      customsDecl: null, paymentDocRef: "К п/п №125 от 20.05.2026",
      sellerSignatory: "Иванов И.И.", buyerSignatory: "Сидоров А.П.",
      notes: null,
      flags: FLAGS, assets: ASSETS, vatLabel,
      defaultFooterText: settings.defaultFooterText,
      updNote: settings.updNote,
    }));
  }

  /* ---------- Waybill ---------- */
  {
    const items = manyItems().slice(0, 4);
    const t = sumTotals(items);
    await writePdf("waybill.pdf", React.createElement(WaybillPdf, {
      number: "ТН-0001/2026",
      date: "2026-05-21",
      operationType: "SALE",
      subtotal: t.subtotal, vatAmount: t.vatAmount, total: t.total,
      seller: SELLER, buyer: BUYER, items,
      shippedBy: "Морозов И.С. (зав. складом)",
      receivedBy: "Сидоров А.П. (менеджер по закупкам)",
      notes: null,
      flags: FLAGS, assets: ASSETS, vatLabel,
      defaultFooterText: settings.defaultFooterText,
      waybillNote: settings.waybillNote,
    }));
  }

  /* ---------- Contract (длинный текст) ---------- */
  const longTemplate = `г. Москва\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t{{contract.date}}

{{organization.fullName}}, именуемое в дальнейшем «Исполнитель», в лице {{directorPosition}} {{directorName}}, действующего на основании {{basedOn}}, с одной стороны, и {{counterparty.fullName}}, именуемое в дальнейшем «Заказчик», в лице руководителя, действующего на основании Устава, с другой стороны, заключили настоящий договор о нижеследующем.

1. ПРЕДМЕТ ДОГОВОРА

1.1. Исполнитель обязуется оказать Заказчику услуги: {{contract.subject}}.
1.2. Срок оказания услуг определяется в дополнительных соглашениях.
1.3. Услуги оказываются на территории Российской Федерации. По соглашению сторон отдельные этапы могут выполняться удалённо.

2. СТОИМОСТЬ УСЛУГ И ПОРЯДОК РАСЧЁТОВ

2.1. Общая стоимость услуг составляет {{contract.amount}} {{contract.currency}}, в том числе НДС по действующей ставке.
2.2. Оплата производится в течение 14 банковских дней с момента подписания соответствующего акта оказанных услуг.
2.3. Расчёты осуществляются в безналичном порядке. Обязательства Заказчика по оплате считаются исполненными с момента поступления денежных средств на расчётный счёт Исполнителя.

3. ПРАВА И ОБЯЗАННОСТИ СТОРОН

3.1. Исполнитель обязуется качественно и в срок оказывать услуги, предусмотренные настоящим Договором.
3.2. Заказчик обязуется своевременно предоставлять необходимую информацию и документы для оказания услуг.
3.3. Исполнитель имеет право привлекать третьих лиц для оказания услуг по настоящему Договору.

4. ОТВЕТСТВЕННОСТЬ СТОРОН

4.1. За неисполнение или ненадлежащее исполнение обязательств стороны несут ответственность в соответствии с действующим законодательством Российской Федерации.
4.2. При нарушении сроков оплаты Заказчик уплачивает пеню в размере 0,1% от просроченной суммы за каждый день просрочки.

5. РЕКВИЗИТЫ СТОРОН

Исполнитель: {{organization.fullName}}, ИНН {{organization.inn}}, КПП {{organization.kpp}}, ОГРН {{organization.ogrn}}, адрес: {{organization.legalAddress}}, телефон: {{organization.phone}}, email: {{organization.email}}.

Заказчик: {{counterparty.fullName}}, ИНН {{counterparty.inn}}, КПП {{counterparty.kpp}}, адрес: {{counterparty.legalAddress}}, руководитель: {{counterparty.managementName}}.`;

  const rendered = renderContract(longTemplate, {
    organization: {
      fullName: SELLER.fullName!, name: SELLER.name, inn: SELLER.inn, kpp: SELLER.kpp,
      ogrn: "1027700132195", legalAddress: SELLER.legalAddress,
      phone: "+7 (495) 123-45-67", email: "info@alfa-tech.example",
      directorName: "Иванов Иван Иванович", directorPosition: "Генеральный директор",
      basedOn: "Устава",
    },
    counterparty: {
      name: BUYER.name, fullName: BUYER.fullName, inn: BUYER.inn, kpp: BUYER.kpp,
      legalAddress: BUYER.legalAddress, managementName: "Сидоров Алексей Петрович",
    },
    contract: { number: "Д-001/2026", date: "2026-05-21", amount: 1200000, currency: "RUB", subject: "Оказание консультационных услуг по бухгалтерскому учёту и налогообложению" },
  });

  await writePdf("contract.pdf", React.createElement(ContractPdf, {
    number: "Д-001/2026", date: "2026-05-21",
    seller: SELLER, buyer: BUYER,
    body: rendered.text,
    flags: FLAGS, assets: ASSETS,
    defaultFooterText: settings.defaultFooterText,
  }));

  const contractHtml = previewContract({
    number: "Д-001/2026", date: "2026-05-21", amount: 1200000,
    organization: orgHtmlForPreview as any, counterparty: BUYER as any,
    body: rendered.text,
  });
  await writeHtml("contract-preview.html", inlineImages(contractHtml, inlineMap));

  /* ---------- Reconciliation ---------- */
  {
    const lines = Array.from({ length: 14 }, (_, i) => {
      const day = 1 + i * 2;
      const isInvoice = i % 3 !== 0;
      const debit = isInvoice ? 50000 + i * 1234 : 0;
      const credit = !isInvoice ? 40000 + i * 1000 : 0;
      return {
        date: `2026-${String(((day - 1) % 5) + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        description: isInvoice
          ? `Счёт СЧ-${String(i + 1).padStart(4, "0")}/2026 от 0${i + 1}.05.2026 на сумму ${debit} ₽`
          : `Платёжное поручение №${100 + i} от 0${i + 1}.05.2026 на сумму ${credit} ₽`,
        debit, credit,
      };
    });
    const totalDebit = lines.reduce((a, l) => a + l.debit, 0);
    const totalCredit = lines.reduce((a, l) => a + l.credit, 0);
    await writePdf("reconciliation.pdf", React.createElement(ReconciliationPdf, {
      number: "АС-001/2026", date: "2026-05-31",
      periodFrom: "2026-01-01", periodTo: "2026-05-31",
      seller: SELLER, buyer: BUYER,
      openingBalance: 0,
      totalDebit, totalCredit,
      closingBalance: totalDebit - totalCredit,
      lines,
      notes: null,
      flags: FLAGS, assets: ASSETS,
      defaultFooterText: settings.defaultFooterText,
      reconciliationNote: settings.reconciliationNote,
    }));
  }

  console.log("");
  console.log(`Done. See ${path.relative(process.cwd(), OUT_DIR)}/`);
}

main().catch((err) => {
  console.error("✗ print:check failed:", err);
  process.exit(1);
});

// Используем previewContract внешне (импорт выше)
function previewContractFn(input: Parameters<typeof previewContract>[0]) {
  return previewContract(input);
}
void previewContractFn;
void previewAct;
void previewUpd;
void previewWaybill;
void previewReconciliation;
