import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider, useTheme } from "@/lib/theme";

// Заглушка для axios: блокируем все сетевые запросы, чтобы страницы не падали из-за их отсутствия.
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      get: vi.fn().mockImplementation((url: string) => {
        if (url === "/auth/me") return Promise.resolve({ data: { user: { id: "u1", email: "test@example.com", fullName: "Test", role: "USER", isActive: true, createdAt: "2026-01-01T00:00:00Z" } } });
        if (url.startsWith("/dashboard")) return Promise.resolve({ data: { counters: {}, invoices: { byStatus: [] }, revenue: { year: 0, month: 0, byMonth: [] }, topCounterparties: [], contracts: { expiringSoon: [], expired: [] }, overdueInvoices: [], topDebtors: [], upcomingPayments: [] } });
        if (url === "/ai/settings") return Promise.resolve({ data: { provider: "openai", apiKey: "", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", temperature: 0.2, maxTokens: 2000, enabled: true, configured: false } });
        return Promise.resolve({ data: { items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 } });
      }),
      post: vi.fn().mockResolvedValue({ data: {} }),
      put: vi.fn().mockResolvedValue({ data: {} }),
      patch: vi.fn().mockResolvedValue({ data: {} }),
      delete: vi.fn().mockResolvedValue({ data: {} }),
    },
    getToken: () => "test-token",
    setToken: vi.fn(),
    extractApiError: () => ({ error: "Unknown" }),
  };
});

// Заглушка для AuthContext — авторизованный пользователь
vi.mock("@/lib/auth-context", () => {
  return {
    AuthProvider: ({ children }: { children: React.ReactNode }) => children,
    useAuth: () => ({
      user: { id: "u1", email: "test@example.com", fullName: "Test User", role: "USER" as const, isActive: true, createdAt: "2026-01-01T00:00:00Z" },
      loading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    }),
  };
});

function renderPage(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <ThemeProvider>
        <MemoryRouter>{ui}</MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe("Smoke: страницы рендерятся", () => {
  beforeEach(() => { localStorage.clear(); });

  it("LoginPage", async () => {
    const { LoginPage } = await import("@/pages/Login");
    renderPage(<LoginPage />);
    // Может быть редирект на Navigate (если user уже залогинен) — это тоже валидный рендер
    expect(document.body).toBeTruthy();
  });

  it("DashboardPage", async () => {
    const { DashboardPage } = await import("@/pages/Dashboard");
    renderPage(<DashboardPage />);
    // Дашборд показывает "Загрузка..." пока useQuery в pending — текст должен быть на экране
    expect(screen.getByText(/Загрузка/)).toBeTruthy();
  });

  it("DocumentsListPage (invoices)", async () => {
    const { DocumentsListPage } = await import("@/pages/DocumentsList");
    renderPage(<DocumentsListPage kind="invoices" />);
    expect(screen.getByText("Счета на оплату")).toBeTruthy();
  });

  it("DocumentsListPage (acts)", async () => {
    const { DocumentsListPage } = await import("@/pages/DocumentsList");
    renderPage(<DocumentsListPage kind="acts" />);
    expect(screen.getByText("Акты выполненных работ")).toBeTruthy();
  });

  it("PaymentsPage", async () => {
    const { PaymentsPage } = await import("@/pages/Payments");
    renderPage(<PaymentsPage />);
    expect(screen.getByText("Платежи")).toBeTruthy();
  });

  it("ReconciliationsPage", async () => {
    const { ReconciliationsPage } = await import("@/pages/Reconciliations");
    renderPage(<ReconciliationsPage />);
    expect(screen.getByText("Акты сверки")).toBeTruthy();
  });

  it("AiSettingsPage (Sprint 6A+6.1)", async () => {
    const { AiSettingsPage } = await import("@/pages/AiSettings");
    renderPage(<AiSettingsPage />);
    // В заголовке либо "AI Ассистент — настройки", либо "Загрузка..."
    expect(document.body.textContent).toMatch(/AI Ассистент|Загрузка/);
    // Sprint 6.1 — safety-баннер "AI не выполняет действия без вашего подтверждения"
    expect(document.body.textContent).toMatch(/без вашего подтверждения|Загрузка/);
  });

  it("AiChatPage (Sprint 6A+6B+6.1+6C+6.2)", async () => {
    const { AiChatPage } = await import("@/pages/AiChat");
    renderPage(<AiChatPage />);
    expect(screen.getByText("AI Ассистент")).toBeTruthy();
    // Все 7 поддерживаемых action types в quick-prompts
    expect(document.body.textContent).toMatch(/Создай контрагента/);
    expect(document.body.textContent).toMatch(/Создай счёт/);
    expect(document.body.textContent).toMatch(/Создай акт/);
    expect(document.body.textContent).toMatch(/Создай договор/);
    expect(document.body.textContent).toMatch(/Покажи должников/);
    // Sprint 6C — платежи и распределение
    expect(document.body.textContent).toMatch(/входящий платёж/);
    expect(document.body.textContent).toMatch(/Распредели платёж/);
    // Sprint 6.1 — блок «История AI-действий» рендерится (даже пустой)
    expect(document.body.textContent).toMatch(/История AI-действий/);
    // Sprint 6.2 — кнопка «Обновить» истории, описание про скрытие payload
    expect(document.body.textContent).toMatch(/Обновить/);
    expect(document.body.textContent).toMatch(/Payload action не отображается/);
  });

  it("ImportPage", async () => {
    const { ImportPage } = await import("@/pages/Import");
    renderPage(<ImportPage />);
    expect(screen.getByText("Импорт данных")).toBeTruthy();
  });

  it("ContractTemplatesPage", async () => {
    const { ContractTemplatesPage } = await import("@/pages/ContractTemplates");
    renderPage(<ContractTemplatesPage />);
    expect(screen.getByText("Шаблоны договоров")).toBeTruthy();
  });

  it("OrganizationsPage", async () => {
    const { OrganizationsPage } = await import("@/pages/Organizations");
    renderPage(<OrganizationsPage />);
    expect(screen.getByText("Мои организации")).toBeTruthy();
  });

  it("MembersPage (Sprint 9) — рендерится без orgId-параметра", async () => {
    const { MembersPage } = await import("@/pages/Members");
    renderPage(<MembersPage />);
    // Без orgId компонент рано выходит — главное, не падает.
    expect(document.body).toBeTruthy();
  });

  it("PrintWarnings component", async () => {
    const { PrintWarnings } = await import("@/components/PrintWarnings");
    renderPage(<PrintWarnings url="/invoices/x/print-warnings" />);
    // По умолчанию api mock возвращает пустые items → warnings нет → компонент не рендерит.
    // Это успешный кейс — главное, что не падает на throw.
    expect(document.body).toBeTruthy();
  });

  it("ErrorBoundary показывает fallback при падении ребёнка (Sprint 7)", async () => {
    const { ErrorBoundary } = await import("@/components/ErrorBoundary");
    // Заглушаем console.error чтобы тест не шумел
    const origError = console.error;
    console.error = () => {};
    try {
      const Bomb = () => {
        throw new Error("test-bomb");
      };
      renderPage(
        <ErrorBoundary>
          <Bomb />
        </ErrorBoundary>,
      );
      expect(screen.getByText(/Что-то пошло не так/)).toBeTruthy();
      expect(document.body.textContent).toMatch(/Перезагрузить/);
    } finally {
      console.error = origError;
    }
  });

  it("PrintWarningsBadge не падает при пустом ответе", async () => {
    const { PrintWarningsBadge } = await import("@/components/PrintWarnings");
    renderPage(<PrintWarningsBadge url="/invoices/x/print-warnings" />);
    expect(document.body).toBeTruthy();
  });

  it("HtmlPreviewDialog рендерится (закрытый) без падения", async () => {
    const { HtmlPreviewDialog } = await import("@/components/HtmlPreviewDialog");
    renderPage(
      <HtmlPreviewDialog
        open={false}
        onClose={() => {}}
        previewUrl="/api/v1/invoices/x/preview"
        pdfUrl="/api/v1/invoices/x/pdf"
        fallbackName="x.pdf"
        title="Тест"
      />,
    );
    expect(document.body).toBeTruthy();
  });

  it("BankImportPage", async () => {
    const { BankImportPage } = await import("@/pages/BankImport");
    renderPage(<BankImportPage />);
    // Заголовок страницы + форма загрузки (организация, файл) должны быть видны
    expect(screen.getByText("Импорт банковской выписки")).toBeTruthy();
    expect(screen.getByText("Загрузить выписку (CSV или XLSX)")).toBeTruthy();
    // Кнопка "Предпросмотр" disabled пока файл/организация не выбраны — рендер не падает
    const buttons = screen.getAllByRole("button");
    const previewBtn = buttons.find((b) => /Предпросмотр/.test(b.textContent ?? ""));
    expect(previewBtn).toBeTruthy();
    expect((previewBtn as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("Smoke: тёмная тема", () => {
  it("переключение темы добавляет/убирает класс .dark на <html>", () => {
    function Probe() {
      const { theme, toggle } = useTheme();
      return <button onClick={toggle} data-testid="toggle">{theme}</button>;
    }
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    const btn = screen.getByTestId("toggle");
    const initial = btn.textContent;
    fireEvent.click(btn);
    expect(btn.textContent).not.toBe(initial);
    const root = document.documentElement;
    if (btn.textContent === "dark") expect(root.classList.contains("dark")).toBe(true);
    else expect(root.classList.contains("dark")).toBe(false);
  });
});
