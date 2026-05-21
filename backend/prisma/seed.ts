// Seed-скрипт BuhClaude. Создаёт демо-данные для одного тестового пользователя.
// Идемпотентен: при повторном запуске удаляет связанные данные тестового юзера и пересоздаёт.

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

const TEST_EMAIL = "test@buhclaude.local";
const TEST_PASSWORD = "superpass1";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface ItemSpec {
  name: string;
  unit: string;
  unitCode: string;
  quantity: number;
  price: number;
  vatRate: number;
}

function calcItem(it: ItemSpec, vatIncluded: boolean) {
  const subRaw = it.quantity * it.price;
  if (vatIncluded) {
    const total = round2(subRaw);
    const vat = it.vatRate === 0 ? 0 : round2((total * it.vatRate) / (100 + it.vatRate));
    return { subtotal: round2(total - vat), vatAmount: vat, total };
  }
  const subtotal = round2(subRaw);
  const vat = it.vatRate === 0 ? 0 : round2((subtotal * it.vatRate) / 100);
  return { subtotal, vatAmount: vat, total: round2(subtotal + vat) };
}

function totals(items: Array<{ subtotal: number; vatAmount: number; total: number }>) {
  return items.reduce(
    (a, x) => ({
      subtotal: round2(a.subtotal + x.subtotal),
      vatAmount: round2(a.vatAmount + x.vatAmount),
      total: round2(a.total + x.total),
    }),
    { subtotal: 0, vatAmount: 0, total: 0 },
  );
}

async function main() {
  console.log("🌱 Seeding BuhClaude…");

  // 1. Чистим существующего тестового юзера (каскад уберёт всё связанное)
  await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
  console.log("  • очищены данные предыдущего seed");

  // 2. Тестовый пользователь
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 12);
  const user = await prisma.user.create({
    data: {
      email: TEST_EMAIL,
      passwordHash,
      fullName: "Иван Иванов",
      role: "USER",
    },
  });
  console.log(`  • пользователь ${user.email}`);

  // 3. Организация (ООО Альфа) с банковским счётом
  const org = await prisma.organization.create({
    data: {
      userId: user.id,
      type: "OOO",
      name: "ООО «Альфа»",
      fullName: `Общество с ограниченной ответственностью "Альфа"`,
      inn: "7707083893", // настоящий ИНН Сбербанка для проверки контрольной суммы
      kpp: "770701001",
      ogrn: "1027700132195", // настоящий ОГРН Сбербанка
      directorName: "Иванов Иван Иванович",
      directorPosition: "Генеральный директор",
      chiefAccountant: "Петрова Мария Сергеевна",
      accountantPosition: "Главный бухгалтер",
      basedOn: "Устава",
      email: "info@alfa.example",
      phone: "+7 (495) 123-45-67",
      website: "https://alfa.example",
      legalAddress: "117997, г. Москва, ул. Вавилова, д. 19",
      postalAddress: "117997, г. Москва, а/я 19",
      vatMode: "GENERAL",
      taxSystem: "OSN",
      isDefault: true,
      printShowLogo: true,
      printShowStamp: true,
      printShowSignature: true,
      printShowAccountantSignature: true,
      printShowBankDetails: true,
      printDefaultPaymentTerms: "Оплата в течение 14 банковских дней с момента выставления счёта.",
      printDefaultFooterText: "ООО «Альфа» — ОГРН 1027700132195, ИНН 7707083893. www.alfa.example",
      printInvoiceNote: "Счёт действителен в течение 5 банковских дней.",
      bankAccounts: {
        create: [
          {
            bankName: "ПАО Сбербанк",
            bik: "044525225",
            account: "40702810900000000001",
            corrAccount: "30101810400000000225",
            isDefault: true,
          },
          {
            bankName: "АО «Тинькофф Банк»",
            bik: "044525974",
            account: "40702810910000000123",
            corrAccount: "30101810145250000974",
            isDefault: false,
          },
        ],
      },
    },
    include: { bankAccounts: true },
  });
  console.log(`  • организация ${org.name} с ${org.bankAccounts.length} счетами`);

  // 4. Контрагенты
  const beta = await prisma.counterparty.create({
    data: {
      userId: user.id,
      type: "OOO",
      inn: "7728168971",
      kpp: "772801001",
      name: "ООО «Бета»",
      fullName: `Общество с ограниченной ответственностью "Бета"`,
      legalAddress: "117997, г. Москва, Ленинский проспект, д. 5, оф. 12",
      managementName: "Сидоров Алексей Петрович",
      managementPos: "Директор",
      email: "info@beta.example",
      phone: "+7 (495) 987-65-43",
      isActive: true,
    },
  });

  const gamma = await prisma.counterparty.create({
    data: {
      userId: user.id,
      type: "IP",
      inn: "500100732259",
      name: "ИП Кузнецов А.И.",
      fullName: "Индивидуальный предприниматель Кузнецов Андрей Игоревич",
      legalAddress: "143000, Московская обл., г. Одинцово, ул. Свободы, д. 21",
      managementName: "Кузнецов Андрей Игоревич",
      managementPos: "Индивидуальный предприниматель",
      isActive: true,
    },
  });
  console.log(`  • контрагенты: ${beta.name}, ${gamma.name}`);

  // 5. Номенклатура
  const nomen = await prisma.nomenclature.createMany({
    data: [
      {
        userId: user.id,
        code: "USL-001",
        name: "Консалтинговые услуги",
        fullName: "Консультационные услуги по бухгалтерскому учёту и налогообложению",
        unitMeasure: "ч",
        unitCode: "356",
        type: "USLUGA",
        vatRate: 22,
        price: 5000,
      },
      {
        userId: user.id,
        code: "USL-002",
        name: "Разработка отчётности",
        fullName: "Разработка и сдача бухгалтерской и налоговой отчётности",
        unitMeasure: "шт",
        unitCode: "796",
        type: "RABOTA",
        vatRate: 22,
        price: 12000,
      },
      {
        userId: user.id,
        code: "TVR-001",
        name: "Канцелярский набор",
        fullName: 'Набор канцелярский "Офис-стандарт", артикул KS-100',
        unitMeasure: "шт",
        unitCode: "796",
        type: "TOVAR",
        vatRate: 22,
        price: 1500,
      },
      {
        userId: user.id,
        code: "TVR-002",
        name: "Бумага офисная А4",
        fullName: "Бумага офисная А4, 80 г/м², 500 листов",
        unitMeasure: "пач",
        unitCode: "728",
        type: "TOVAR",
        vatRate: 22,
        price: 350,
      },
    ],
  });
  console.log(`  • номенклатура: ${nomen.count} позиций`);

  // 6. Шаблон договора + Договор
  const baseTemplateContent = `г. Москва\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t{{contract.date}}

{{organization.fullName}}, именуемое в дальнейшем «Исполнитель», в лице {{directorPosition}} {{directorName}}, действующего на основании {{basedOn}}, с одной стороны, и {{counterparty.fullName}}, именуемое в дальнейшем «Заказчик», в лице {{counterparty.managementName}}, с другой стороны, заключили настоящий договор о нижеследующем.

1. ПРЕДМЕТ ДОГОВОРА

1.1. Исполнитель обязуется оказать Заказчику услуги: {{contract.subject}}.
1.2. Срок оказания услуг — в соответствии с приложением №1.

2. СТОИМОСТЬ И ПОРЯДОК РАСЧЁТОВ

2.1. Стоимость услуг по настоящему договору составляет {{contract.amount}} {{contract.currency}}.
2.2. Оплата производится в течение 14 банковских дней с момента подписания акта оказанных услуг.

3. РЕКВИЗИТЫ СТОРОН

Исполнитель: {{organization.fullName}}, ИНН {{organization.inn}}, КПП {{organization.kpp}}, ОГРН {{organization.ogrn}}, адрес: {{organization.legalAddress}}.
Заказчик: {{counterparty.fullName}}, ИНН {{counterparty.inn}}, адрес: {{counterparty.legalAddress}}.`;

  const baseTemplate = await prisma.contractTemplate.create({
    data: {
      userId: user.id,
      organizationId: org.id,
      name: "Договор оказания услуг (базовый)",
      description: "Универсальный шаблон договора на оказание услуг с полем «предмет договора»",
      content: baseTemplateContent,
      isDefault: true,
      variables: [
        "contract.date", "contract.subject", "contract.amount", "contract.currency",
        "organization.fullName", "organization.inn", "organization.kpp", "organization.ogrn", "organization.legalAddress",
        "directorPosition", "directorName", "basedOn",
        "counterparty.fullName", "counterparty.inn", "counterparty.legalAddress", "counterparty.managementName",
      ],
    },
  });
  console.log(`  • шаблон договора «${baseTemplate.name}»`);

  const contract = await prisma.contract.create({
    data: {
      userId: user.id,
      organizationId: org.id,
      counterpartyId: beta.id,
      templateId: baseTemplate.id,
      number: "Д-001/2026",
      date: new Date("2026-01-15"),
      expiryDate: new Date("2026-12-31"),
      subject: "Оказание консультационных услуг по бухгалтерскому учёту",
      amount: 1200000,
      currency: "RUB",
      status: "ACTIVE",
      autoRenew: false,
    },
  });
  console.log(`  • договор ${contract.number}`);

  // 7. Счётчик номеров и документы
  const year = 2026;

  // Счёт 1 — оплачен
  const invoiceItems1 = [
    { name: "Консалтинговые услуги (январь)", unit: "ч", unitCode: "356", quantity: 10, price: 5000, vatRate: 22 },
    { name: "Разработка квартальной отчётности", unit: "шт", unitCode: "796", quantity: 1, price: 12000, vatRate: 22 },
  ];
  const invoice1Calc = invoiceItems1.map((it) => ({ ...it, ...calcItem(it, true) }));
  const invoice1T = totals(invoice1Calc);
  const invoice1 = await prisma.invoice.create({
    data: {
      userId: user.id,
      organizationId: org.id,
      counterpartyId: beta.id,
      contractId: contract.id,
      bankAccountId: org.bankAccounts[0]!.id,
      number: `СЧ-0001/${year}`,
      date: new Date("2026-01-31"),
      dueDate: new Date("2026-02-15"),
      currency: "RUB",
      status: "PAID",
      paidAt: new Date("2026-02-10"),
      vatRate: 22,
      vatIncluded: true,
      subtotal: invoice1T.subtotal,
      vatAmount: invoice1T.vatAmount,
      total: invoice1T.total,
      paymentPurpose: "Оплата по счёту за консалтинговые услуги за январь 2026 г., НДС включён",
      items: {
        create: invoice1Calc.map((it, i) => ({
          userId: user.id,
          documentType: "INVOICE",
          sortOrder: i + 1,
          name: it.name,
          unit: it.unit,
          unitCode: it.unitCode,
          quantity: it.quantity,
          price: it.price,
          vatRate: it.vatRate,
          subtotal: it.subtotal,
          vatAmount: it.vatAmount,
          total: it.total,
        })),
      },
    },
  });

  // Счёт 2 — выставлен, не оплачен
  const invoiceItems2 = [
    { name: "Консалтинговые услуги (февраль)", unit: "ч", unitCode: "356", quantity: 15, price: 5000, vatRate: 22 },
  ];
  const invoice2Calc = invoiceItems2.map((it) => ({ ...it, ...calcItem(it, true) }));
  const invoice2T = totals(invoice2Calc);
  const invoice2 = await prisma.invoice.create({
    data: {
      userId: user.id,
      organizationId: org.id,
      counterpartyId: beta.id,
      contractId: contract.id,
      bankAccountId: org.bankAccounts[0]!.id,
      number: `СЧ-0002/${year}`,
      date: new Date("2026-02-28"),
      dueDate: new Date("2026-03-15"),
      currency: "RUB",
      status: "SENT",
      vatRate: 22,
      vatIncluded: true,
      subtotal: invoice2T.subtotal,
      vatAmount: invoice2T.vatAmount,
      total: invoice2T.total,
      paymentPurpose: "Оплата по счёту за консалтинговые услуги за февраль 2026 г., НДС включён",
      items: {
        create: invoice2Calc.map((it, i) => ({
          userId: user.id,
          documentType: "INVOICE",
          sortOrder: i + 1,
          name: it.name,
          unit: it.unit,
          unitCode: it.unitCode,
          quantity: it.quantity,
          price: it.price,
          vatRate: it.vatRate,
          subtotal: it.subtotal,
          vatAmount: it.vatAmount,
          total: it.total,
        })),
      },
    },
  });
  console.log(`  • счета: ${invoice1.number} (PAID), ${invoice2.number} (SENT)`);

  // Акт — подписанный, к первому счёту
  const actCalc = invoice1Calc;
  const actT = invoice1T;
  const act = await prisma.act.create({
    data: {
      userId: user.id,
      organizationId: org.id,
      counterpartyId: beta.id,
      contractId: contract.id,
      invoiceId: invoice1.id,
      number: `АКТ-0001/${year}`,
      date: new Date("2026-01-31"),
      periodStart: new Date("2026-01-01"),
      periodEnd: new Date("2026-01-31"),
      currency: "RUB",
      status: "SIGNED",
      vatRate: 22,
      vatIncluded: true,
      subtotal: actT.subtotal,
      vatAmount: actT.vatAmount,
      total: actT.total,
      sellerSignatory: "Иванов И.И.",
      buyerSignatory: "Сидоров А.П.",
      items: {
        create: actCalc.map((it, i) => ({
          userId: user.id,
          documentType: "ACT",
          sortOrder: i + 1,
          name: it.name,
          unit: it.unit,
          unitCode: it.unitCode,
          quantity: it.quantity,
          price: it.price,
          vatRate: it.vatRate,
          subtotal: it.subtotal,
          vatAmount: it.vatAmount,
          total: it.total,
        })),
      },
    },
  });

  // УПД — отгрузка товаров ИП
  const updItems = [
    { name: "Канцелярский набор", unit: "шт", unitCode: "796", quantity: 20, price: 1500, vatRate: 22 },
    { name: "Бумага офисная А4", unit: "пач", unitCode: "728", quantity: 50, price: 350, vatRate: 22 },
  ];
  const updCalc = updItems.map((it) => ({ ...it, ...calcItem(it, false) }));
  const updT = totals(updCalc);
  const upd = await prisma.updDocument.create({
    data: {
      userId: user.id,
      organizationId: org.id,
      counterpartyId: gamma.id,
      number: `УПД-0001/${year}`,
      date: new Date("2026-02-15"),
      functionType: "FULL",
      currency: "RUB",
      status: "SIGNED",
      vatRate: 22,
      vatIncluded: false,
      subtotal: updT.subtotal,
      vatAmount: updT.vatAmount,
      total: updT.total,
      shipmentDate: new Date("2026-02-15"),
      shipmentAddress: "143000, Московская обл., г. Одинцово, ул. Свободы, д. 21",
      sellerSignatory: "Иванов И.И.",
      buyerSignatory: "Кузнецов А.И.",
      items: {
        create: updCalc.map((it, i) => ({
          userId: user.id,
          documentType: "UPD",
          sortOrder: i + 1,
          name: it.name,
          unit: it.unit,
          unitCode: it.unitCode,
          quantity: it.quantity,
          price: it.price,
          vatRate: it.vatRate,
          subtotal: it.subtotal,
          vatAmount: it.vatAmount,
          total: it.total,
        })),
      },
    },
  });

  // ТОРГ-12 — отгрузка ООО Бета
  const wbItems = [
    { name: "Канцелярский набор", unit: "шт", unitCode: "796", quantity: 5, price: 1500, vatRate: 22 },
    { name: "Бумага офисная А4", unit: "пач", unitCode: "728", quantity: 10, price: 350, vatRate: 22 },
  ];
  const wbCalc = wbItems.map((it) => ({ ...it, ...calcItem(it, true) }));
  const wbT = totals(wbCalc);
  const waybill = await prisma.waybill.create({
    data: {
      userId: user.id,
      organizationId: org.id,
      counterpartyId: beta.id,
      number: `ТН-0001/${year}`,
      date: new Date("2026-02-20"),
      operationType: "SALE",
      currency: "RUB",
      status: "SIGNED",
      vatRate: 22,
      vatIncluded: true,
      subtotal: wbT.subtotal,
      vatAmount: wbT.vatAmount,
      total: wbT.total,
      shippedBy: "Кладовщик Морозов И.С.",
      receivedBy: "Менеджер Сидоров А.П.",
      items: {
        create: wbCalc.map((it, i) => ({
          userId: user.id,
          documentType: "WAYBILL",
          sortOrder: i + 1,
          name: it.name,
          unit: it.unit,
          unitCode: it.unitCode,
          quantity: it.quantity,
          price: it.price,
          vatRate: it.vatRate,
          subtotal: it.subtotal,
          vatAmount: it.vatAmount,
          total: it.total,
        })),
      },
    },
  });

  // 8. Счётчики автонумерации
  await prisma.documentNumbering.createMany({
    data: [
      { userId: user.id, organizationId: org.id, docType: "INVOICE", year, lastNumber: 2, prefix: "СЧ-" },
      { userId: user.id, organizationId: org.id, docType: "ACT", year, lastNumber: 1, prefix: "АКТ-" },
      { userId: user.id, organizationId: org.id, docType: "UPD", year, lastNumber: 1, prefix: "УПД-" },
      { userId: user.id, organizationId: org.id, docType: "WAYBILL", year, lastNumber: 1, prefix: "ТН-" },
    ],
  });

  console.log(`  • документы: ${act.number}, ${upd.number}, ${waybill.number}`);
  console.log("");
  console.log("✅ Seed выполнен успешно.");
  console.log("");
  console.log("Доступ к системе:");
  console.log(`  Email:  ${TEST_EMAIL}`);
  console.log(`  Пароль: ${TEST_PASSWORD}`);
  console.log("");
}

main()
  .catch((e) => {
    console.error("❌ Seed упал:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
