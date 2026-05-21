import { BrowserRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { AuthProvider } from "@/lib/auth-context";
import { ThemeProvider } from "@/lib/theme";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppShell } from "@/components/AppShell";
import { LoginPage } from "@/pages/Login";
import { RegisterPage } from "@/pages/Register";
import { DashboardPage } from "@/pages/Dashboard";
import { OrganizationsPage } from "@/pages/Organizations";
import { CounterpartiesPage } from "@/pages/Counterparties";
import { CounterpartyDetailPage } from "@/pages/CounterpartyDetail";
import { NomenclaturePage } from "@/pages/Nomenclature";
import { ContractsPage } from "@/pages/Contracts";
import { DocumentsListPage } from "@/pages/DocumentsList";
import { DocumentEditPage } from "@/pages/DocumentEdit";
import { PaymentsPage } from "@/pages/Payments";
import { ReconciliationsPage } from "@/pages/Reconciliations";
import { AiSettingsPage } from "@/pages/AiSettings";
import { AiChatPage } from "@/pages/AiChat";
import { ImportPage } from "@/pages/Import";
import { Placeholder } from "@/pages/Placeholder";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
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

                <Route path="/payments" element={<PaymentsPage />} />
                <Route path="/reconciliations" element={<ReconciliationsPage />} />

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
        </BrowserRouter>
        <Toaster richColors closeButton position="top-right" />
      </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
