import { BrowserRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { AuthProvider } from "@/lib/auth-context";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppShell } from "@/components/AppShell";
import { LoginPage } from "@/pages/Login";
import { RegisterPage } from "@/pages/Register";
import { DashboardPage } from "@/pages/Dashboard";
import { Placeholder } from "@/pages/Placeholder";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<AppShell />}>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/invoices" element={<Placeholder title="Счета" />} />
                <Route path="/acts" element={<Placeholder title="Акты" />} />
                <Route path="/upds" element={<Placeholder title="УПД" />} />
                <Route path="/waybills" element={<Placeholder title="ТОРГ-12" />} />
                <Route path="/organizations" element={<Placeholder title="Мои организации" />} />
                <Route path="/counterparties" element={<Placeholder title="Контрагенты" />} />
                <Route path="/nomenclature" element={<Placeholder title="Номенклатура" />} />
                <Route path="/contracts" element={<Placeholder title="Договоры" />} />
              </Route>
            </Route>
            <Route path="*" element={<Placeholder title="404" description="Страница не найдена" />} />
          </Routes>
        </BrowserRouter>
        <Toaster richColors closeButton position="top-right" />
      </AuthProvider>
    </QueryClientProvider>
  );
}
