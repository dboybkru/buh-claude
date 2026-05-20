import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Building2, Users, Package, FileSignature,
  Receipt, FileCheck, FileText, Truck, LogOut, User as UserIcon, Wallet, BookCheck, Bot,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface NavGroup {
  title: string;
  items: Array<{ to: string; label: string; icon: typeof LayoutDashboard }>;
}

const NAV: NavGroup[] = [
  {
    title: "Главное",
    items: [{ to: "/", label: "Дашборд", icon: LayoutDashboard }],
  },
  {
    title: "Документы",
    items: [
      { to: "/invoices", label: "Счета", icon: Receipt },
      { to: "/acts", label: "Акты", icon: FileCheck },
      { to: "/upds", label: "УПД", icon: FileText },
      { to: "/waybills", label: "ТОРГ-12", icon: Truck },
    ],
  },
  {
    title: "Финансы",
    items: [
      { to: "/payments", label: "Платежи", icon: Wallet },
      { to: "/reconciliations", label: "Акты сверки", icon: BookCheck },
    ],
  },
  {
    title: "Помощник",
    items: [
      { to: "/ai", label: "AI чат", icon: Bot },
    ],
  },
  {
    title: "Справочники",
    items: [
      { to: "/organizations", label: "Мои организации", icon: Building2 },
      { to: "/counterparties", label: "Контрагенты", icon: Users },
      { to: "/nomenclature", label: "Номенклатура", icon: Package },
      { to: "/contracts", label: "Договоры", icon: FileSignature },
    ],
  },
];

export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="grid min-h-screen grid-cols-[260px_1fr] bg-muted/30">
      <aside className="border-r bg-card flex flex-col">
        <div className="px-5 py-5 border-b">
          <Link to="/" className="block">
            <div className="text-lg font-bold">BuhClaude</div>
            <div className="text-xs text-muted-foreground">Документооборот и учёт</div>
          </Link>
        </div>
        <nav className="flex-1 overflow-y-auto py-3">
          {NAV.map((group) => (
            <div key={group.title} className="mb-4 px-3">
              <div className="px-2 mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.title}
              </div>
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.to === "/"}
                      className={({ isActive }) =>
                        cn(
                          "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                          isActive
                            ? "bg-primary text-primary-foreground"
                            : "hover:bg-accent hover:text-accent-foreground",
                        )
                      }
                    >
                      <item.icon className="h-4 w-4" />
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="border-t p-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="w-full justify-start gap-2 h-auto py-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                  <UserIcon className="h-4 w-4" />
                </div>
                <div className="flex-1 text-left overflow-hidden">
                  <div className="text-sm font-medium truncate">{user?.fullName ?? "—"}</div>
                  <div className="text-xs text-muted-foreground truncate">{user?.email}</div>
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>{user?.email}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} className="text-destructive">
                <LogOut className="mr-2 h-4 w-4" />
                Выйти
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
      <main className="overflow-auto">
        <div className="container max-w-6xl px-6 py-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
