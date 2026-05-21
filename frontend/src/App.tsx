import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { Loader2 } from "lucide-react";
import { AuthProvider } from "@/lib/auth-context";
import { ThemeProvider } from "@/lib/theme";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppShell } from "@/components/AppShell";
import { ErrorBoundary } from "@/components/ErrorBoundary";
// Login/Register нужны сразу (форма входа) → не lazy.
import { LoginPage } from "@/pages/Login";
import { RegisterPage } from "@/pages/Register";

// Sprint 7: остальные страницы — лениво (code splitting). Suspense fallback
// показывает спиннер пока chunk загружается. Тяжёлые модули (AI, DocumentEdit
// с react-pdf preview) уходят в отдельные бандлы и не блокируют initial load.
const DashboardPage = lazy(() => import("@/pages/Dashboard").then((m) => ({ default: m.DashboardPage })));
const OrganizationsPage = lazy(() => import("@/pages/Organizations").then((m) => ({ default: m.OrganizationsPage })));
const CounterpartiesPage = lazy(() => import("@/pages/Counterparties").then((m) => ({ default: m.CounterpartiesPage })));
const CounterpartyDetailPage = lazy(() => import("@/pages/CounterpartyDetail").then((m) => ({ default: m.CounterpartyDetailPage })));
const NomenclaturePage = lazy(() => import("@/pages/Nomenclature").then((m) => ({ default: m.NomenclaturePage })));
const ContractsPage = lazy(() => import("@/pages/Contracts").then((m) => ({ default: m.ContractsPage })));
const ContractTemplatesPage = lazy(() => import("@/pages/ContractTemplates").then((m) => ({ default: m.ContractTemplatesPage })));
const DocumentsListPage = lazy(() => import("@/pages/DocumentsList").then((m) => ({ default: m.DocumentsListPage })));
const DocumentEditPage = lazy(() => import("@/pages/DocumentEdit").then((m) => ({ default: m.DocumentEditPage })));
const PaymentsPage = lazy(() => import("@/pages/Payments").then((m) => ({ default: m.PaymentsPage })));
const ReconciliationsPage = lazy(() => import("@/pages/Reconciliations").then((m) => ({ default: m.ReconciliationsPage })));
const AiSettingsPage = lazy(() => import("@/pages/AiSettings").then((m) => ({ default: m.AiSettingsPage })));
const AiChatPage = lazy(() => import("@/pages/AiChat").then((m) => ({ default: m.AiChatPage })));
const ImportPage = lazy(() => import("@/pages/Import").then((m) => ({ default: m.ImportPage })));
const BankImportPage = lazy(() => import("@/pages/BankImport").then((m) => ({ default: m.BankImportPage })));
const Placeholder = lazy(() => import("@/pages/Placeholder").then((m) => ({ default: m.Placeholder })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
});

function RouteFallback() {
  return (
    <div className="flex items-center justify-center min-h-[200px] text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin mr-2" /> Загрузка...
    </div>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthProvider>
            <BrowserRouter>
              <Suspense fallback={<RouteFallback />}>
                <Routes>
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/register" element={<RegisterPage />} />
                  <Route element={<ProtectedRoute />}>
                    <Route element={<AppShell />}>
                      <Route path="/" element={<DashboardPage />} />

                      <Route path="/organizations" element={<OrganizationsPage />} />
                      <Route path="/counterparties" element={<CounterpartiesPage />} />
                      <Route path="/counterparties/:id" element={<CounterpartyDetailPage />} />
                      <Route path="/nomenclature" element={<NomenclaturePage />} />
                      <Route path="/contracts" element={<ContractsPage />} />
                      <Route path="/contract-templates" element={<ContractTemplatesPage />} />

                      <Route path="/payments" element={<PaymentsPage />} />
                      <Route path="/reconciliations" element={<ReconciliationsPage />} />
                      <Route path="/bank-import" element={<BankImportPage />} />

                      <Route path="/ai" element={<AiChatPage />} />
                      <Route path="/ai/settings" element={<AiSettingsPage />} />

                      <Route path="/import" element={<ImportPage />} />

                      <Route path="/invoices" element={<DocumentsListPage kind="invoices" />} />
                      <Route path="/invoices/:id" element={<DocumentEditPage kind="invoices" />} />
                      <Route path="/acts" element={<DocumentsListPage kind="acts" />} />
                      <Route path="/acts/:id" element={<DocumentEditPage kind="acts" />} />
                      <Route path="/upds" element={<DocumentsListPage kind="upds" />} />
                      <Route path="/upds/:id" element={<DocumentEditPage kind="upds" />} />
                      <Route path="/waybills" element={<DocumentsListPage kind="waybills" />} />
                      <Route path="/waybills/:id" element={<DocumentEditPage kind="waybills" />} />
                    </Route>
                  </Route>
                  <Route path="*" element={<Placeholder title="404" description="Страница не найдена" />} />
                </Routes>
              </Suspense>
            </BrowserRouter>
            <Toaster richColors closeButton position="top-right" />
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
