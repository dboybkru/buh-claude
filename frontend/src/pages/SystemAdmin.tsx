// Sprint 10 — System Admin (platform admin only).
//
// Tabs: DaData / AI / SMTP / App. Each tab is a controlled form fed by GET
// /api/v1/admin/system/settings. Secret fields render empty by default with
// a "ключ сохранён ••••abcd" hint when secretPresent[k] is true; submitting
// empty keeps the existing secret, non-empty rotates it.
//
// Visible only when useAuth().user?.role === "ADMIN" — otherwise the page
// rejects with a 403-style note and a link back to dashboard.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Settings, Database, Bot, Mail, Globe, CheckCircle2, XCircle } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { api, extractApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

type Category = "DADATA" | "AI" | "SMTP" | "APP";

interface SerialisedSetting {
  category: Category;
  enabled: boolean;
  config: Record<string, unknown>;
  secretPresent: Record<string, boolean>;
  secretMasked: Record<string, string>;
  updatedAt: string | null;
}

interface TestResult {
  ok: boolean;
  message?: string;
  details?: unknown;
}

const TABS: Array<{ key: Category; label: string; icon: typeof Database }> = [
  { key: "DADATA", label: "DaData", icon: Database },
  { key: "AI", label: "AI Provider", icon: Bot },
  { key: "SMTP", label: "SMTP", icon: Mail },
  { key: "APP", label: "App", icon: Globe },
];

export function SystemAdminPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [active, setActive] = useState<Category>("DADATA");

  if (!isAdmin) {
    return (
      <div className="max-w-xl mx-auto py-12 text-center">
        <Settings className="h-10 w-10 mx-auto mb-4 text-muted-foreground" />
        <h1 className="text-xl font-semibold mb-2">Доступ запрещён</h1>
        <p className="text-sm text-muted-foreground mb-4">
          Системные настройки видит только платформенный администратор.
        </p>
        <Link to="/" className="text-sm underline">← Вернуться на дашборд</Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Settings className="h-6 w-6" /> Системные настройки
        </h1>
        <p className="text-sm text-muted-foreground">
          Подключение внешних сервисов. Видно только пользователям с глобальной ролью ADMIN.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActive(t.key)}
            className={
              "px-4 py-2 text-sm border-b-2 -mb-px flex items-center gap-2 " +
              (active === t.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground")
            }
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {active === "DADATA" && <DadataPanel />}
      {active === "AI" && <AiPanel />}
      {active === "SMTP" && <SmtpPanel />}
      {active === "APP" && <AppPanel />}
    </div>
  );
}

/* ============================================================== */

function useSetting(category: Category) {
  return useQuery<SerialisedSetting>({
    queryKey: ["admin-system-setting", category],
    queryFn: async () => (await api.get<SerialisedSetting>(`/admin/system/settings/${category.toLowerCase()}`)).data,
  });
}

function SecretHint({ present, masked }: { present?: boolean; masked?: string }) {
  if (!present) return <span className="text-xs text-muted-foreground">ещё не задано</span>;
  return (
    <span className="text-xs text-muted-foreground">
      ключ сохранён: <code className="font-mono">{masked || "••••"}</code> · введите новое значение, чтобы заменить
    </span>
  );
}

function TestBadge({ result }: { result: TestResult | null }) {
  if (!result) return null;
  return (
    <div className={"flex items-center gap-2 text-sm " + (result.ok ? "text-green-600" : "text-destructive")}>
      {result.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
      <span>{result.message ?? (result.ok ? "OK" : "Ошибка")}</span>
    </div>
  );
}

/* ============================== DADATA ============================== */

function DadataPanel() {
  const qc = useQueryClient();
  const settingQ = useSetting("DADATA");
  const [enabled, setEnabled] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [secret, setSecret] = useState("");
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  useEffect(() => {
    if (!settingQ.data) return;
    setEnabled(settingQ.data.enabled);
    setBaseUrl(String(settingQ.data.config.baseUrl ?? ""));
  }, [settingQ.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { enabled, baseUrl };
      if (token) body.token = token;
      if (secret) body.secret = secret;
      return (await api.put<SerialisedSetting>("/admin/system/settings/dadata", body)).data;
    },
    onSuccess: () => {
      toast.success("Настройки DaData сохранены");
      setToken("");
      setSecret("");
      qc.invalidateQueries({ queryKey: ["admin-system-setting", "DADATA"] });
    },
    onError: (err) => toast.error(extractApiError(err).message),
  });

  const testMutation = useMutation({
    mutationFn: async () => (await api.post<TestResult>("/admin/system/test/dadata")).data,
    onSuccess: (r) => setTestResult(r),
    onError: (err) => setTestResult({ ok: false, message: extractApiError(err).message }),
  });

  if (settingQ.isLoading) return <Loader2 className="h-5 w-5 animate-spin" />;
  if (settingQ.error) return <div className="text-destructive">{extractApiError(settingQ.error).message}</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Database className="h-4 w-4" /> DaData
          <Badge variant={enabled ? "default" : "outline"}>{enabled ? "включено" : "выключено"}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Включить DaData
        </label>
        <div>
          <Label htmlFor="dd-baseUrl">Base URL</Label>
          <Input id="dd-baseUrl" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://suggestions.dadata.ru/suggestions/api/4_1/rs" />
        </div>
        <div>
          <Label htmlFor="dd-token">API token</Label>
          <Input id="dd-token" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="••••" />
          <SecretHint present={settingQ.data?.secretPresent.token} masked={settingQ.data?.secretMasked.token} />
        </div>
        <div>
          <Label htmlFor="dd-secret">Secret key (для standardization API, опционально)</Label>
          <Input id="dd-secret" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="••••" />
          <SecretHint present={settingQ.data?.secretPresent.secret} masked={settingQ.data?.secretMasked.secret} />
        </div>
        <Separator />
        <div className="flex flex-wrap gap-2 items-center">
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Сохранить
          </Button>
          <Button variant="outline" onClick={() => testMutation.mutate()} disabled={testMutation.isPending}>
            {testMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Проверить подключение
          </Button>
          <TestBadge result={testResult} />
        </div>
      </CardContent>
    </Card>
  );
}

/* ============================== AI ============================== */

function AiPanel() {
  const qc = useQueryClient();
  const settingQ = useSetting("AI");
  const [enabled, setEnabled] = useState(false);
  const [providerName, setProviderName] = useState("openai");
  const [baseUrl, setBaseUrl] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [modelsEndpoint, setModelsEndpoint] = useState("");
  const [timeoutMs, setTimeoutMs] = useState(60_000);
  const [apiKey, setApiKey] = useState("");
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  useEffect(() => {
    if (!settingQ.data) return;
    setEnabled(settingQ.data.enabled);
    setProviderName(String(settingQ.data.config.providerName ?? "openai"));
    setBaseUrl(String(settingQ.data.config.baseUrl ?? ""));
    setDefaultModel(String(settingQ.data.config.defaultModel ?? ""));
    setModelsEndpoint(String(settingQ.data.config.modelsEndpoint ?? ""));
    setTimeoutMs(Number(settingQ.data.config.timeoutMs ?? 60_000));
  }, [settingQ.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { enabled, providerName, baseUrl, defaultModel, modelsEndpoint, timeoutMs };
      if (apiKey) body.apiKey = apiKey;
      return (await api.put<SerialisedSetting>("/admin/system/settings/ai", body)).data;
    },
    onSuccess: () => {
      toast.success("Настройки AI сохранены");
      setApiKey("");
      qc.invalidateQueries({ queryKey: ["admin-system-setting", "AI"] });
    },
    onError: (err) => toast.error(extractApiError(err).message),
  });

  const testMutation = useMutation({
    mutationFn: async () => (await api.post<TestResult>("/admin/system/test/ai")).data,
    onSuccess: (r) => setTestResult(r),
    onError: (err) => setTestResult({ ok: false, message: extractApiError(err).message }),
  });

  if (settingQ.isLoading) return <Loader2 className="h-5 w-5 animate-spin" />;
  if (settingQ.error) return <div className="text-destructive">{extractApiError(settingQ.error).message}</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Bot className="h-4 w-4" /> AI Provider (system default)
          <Badge variant={enabled ? "default" : "outline"}>{enabled ? "включено" : "выключено"}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Включить AI как default для платформы
        </label>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="ai-provider">Provider</Label>
            <Input id="ai-provider" value={providerName} onChange={(e) => setProviderName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ai-model">Default model</Label>
            <Input id="ai-model" value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)} placeholder="gpt-4o-mini" />
          </div>
        </div>
        <div>
          <Label htmlFor="ai-baseUrl">Base URL</Label>
          <Input id="ai-baseUrl" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" />
        </div>
        <div>
          <Label htmlFor="ai-models-endpoint">Models endpoint (опционально)</Label>
          <Input id="ai-models-endpoint" value={modelsEndpoint} onChange={(e) => setModelsEndpoint(e.target.value)} placeholder="(по умолчанию baseUrl/models)" />
        </div>
        <div>
          <Label htmlFor="ai-apiKey">API key</Label>
          <Input id="ai-apiKey" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." />
          <SecretHint present={settingQ.data?.secretPresent.apiKey} masked={settingQ.data?.secretMasked.apiKey} />
        </div>
        <div>
          <Label htmlFor="ai-timeout">Timeout (ms)</Label>
          <Input id="ai-timeout" type="number" value={timeoutMs} onChange={(e) => setTimeoutMs(Number(e.target.value))} />
        </div>
        <Separator />
        <div className="flex flex-wrap gap-2 items-center">
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Сохранить
          </Button>
          <Button variant="outline" onClick={() => testMutation.mutate()} disabled={testMutation.isPending}>
            {testMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Проверить (получить модели)
          </Button>
          <TestBadge result={testResult} />
        </div>
      </CardContent>
    </Card>
  );
}

/* ============================== SMTP ============================== */

function SmtpPanel() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const settingQ = useSetting("SMTP");
  const [enabled, setEnabled] = useState(false);
  const [host, setHost] = useState("");
  const [port, setPort] = useState(587);
  const [username, setUsername] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("BuhClaude");
  const [secure, setSecure] = useState(false);
  const [requireTLS, setRequireTLS] = useState(true);
  const [password, setPassword] = useState("");
  const [testEmail, setTestEmail] = useState(user?.email ?? "");
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  useEffect(() => {
    if (!settingQ.data) return;
    const c = settingQ.data.config as Record<string, unknown>;
    setEnabled(settingQ.data.enabled);
    setHost(String(c.host ?? ""));
    setPort(Number(c.port ?? 587));
    setUsername(String(c.username ?? ""));
    setFromEmail(String(c.fromEmail ?? ""));
    setFromName(String(c.fromName ?? "BuhClaude"));
    setSecure(Boolean(c.secure));
    setRequireTLS(c.requireTLS !== false);
  }, [settingQ.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { enabled, host, port, username, fromEmail, fromName, secure, requireTLS };
      if (password) body.password = password;
      return (await api.put<SerialisedSetting>("/admin/system/settings/smtp", body)).data;
    },
    onSuccess: () => {
      toast.success("Настройки SMTP сохранены");
      setPassword("");
      qc.invalidateQueries({ queryKey: ["admin-system-setting", "SMTP"] });
    },
    onError: (err) => toast.error(extractApiError(err).message),
  });

  const testMutation = useMutation({
    mutationFn: async () => (await api.post<TestResult>("/admin/system/test/smtp", { to: testEmail })).data,
    onSuccess: (r) => setTestResult(r),
    onError: (err) => setTestResult({ ok: false, message: extractApiError(err).message }),
  });

  if (settingQ.isLoading) return <Loader2 className="h-5 w-5 animate-spin" />;
  if (settingQ.error) return <div className="text-destructive">{extractApiError(settingQ.error).message}</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Mail className="h-4 w-4" /> SMTP
          <Badge variant={enabled ? "default" : "outline"}>{enabled ? "включено" : "выключено"}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Включить SMTP (используется future email-приглашениями)
        </label>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <Label htmlFor="smtp-host">Host</Label>
            <Input id="smtp-host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="smtp.yandex.ru" />
          </div>
          <div>
            <Label htmlFor="smtp-port">Port</Label>
            <Input id="smtp-port" type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="smtp-username">Username</Label>
            <Input id="smtp-username" value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="smtp-password">Password</Label>
            <Input id="smtp-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••" />
            <SecretHint present={settingQ.data?.secretPresent.password} masked={settingQ.data?.secretMasked.password} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="smtp-from-email">From email</Label>
            <Input id="smtp-from-email" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="noreply@v-s-b.ru" />
          </div>
          <div>
            <Label htmlFor="smtp-from-name">From name</Label>
            <Input id="smtp-from-name" value={fromName} onChange={(e) => setFromName(e.target.value)} />
          </div>
        </div>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={secure} onChange={(e) => setSecure(e.target.checked)} /> secure (SSL/465)
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={requireTLS} onChange={(e) => setRequireTLS(e.target.checked)} /> requireTLS
          </label>
        </div>
        <Separator />
        <div>
          <Label htmlFor="smtp-test-to">Адрес для тестового письма</Label>
          <Input id="smtp-test-to" type="email" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Сохранить
          </Button>
          <Button variant="outline" onClick={() => testMutation.mutate()} disabled={testMutation.isPending || !testEmail}>
            {testMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Отправить тестовое письмо
          </Button>
          <TestBadge result={testResult} />
        </div>
      </CardContent>
    </Card>
  );
}

/* ============================== APP ============================== */

function AppPanel() {
  const qc = useQueryClient();
  const settingQ = useSetting("APP");
  const [publicUrl, setPublicUrl] = useState("");
  const [supportEmail, setSupportEmail] = useState("");
  const [appName, setAppName] = useState("BuhClaude");

  useEffect(() => {
    if (!settingQ.data) return;
    const c = settingQ.data.config as Record<string, unknown>;
    setPublicUrl(String(c.publicUrl ?? ""));
    setSupportEmail(String(c.supportEmail ?? ""));
    setAppName(String(c.appName ?? "BuhClaude"));
  }, [settingQ.data]);

  const saveMutation = useMutation({
    mutationFn: async () => (await api.put<SerialisedSetting>("/admin/system/settings/app", { publicUrl, supportEmail, appName })).data,
    onSuccess: () => {
      toast.success("Настройки App сохранены");
      qc.invalidateQueries({ queryKey: ["admin-system-setting", "APP"] });
    },
    onError: (err) => toast.error(extractApiError(err).message),
  });

  if (settingQ.isLoading) return <Loader2 className="h-5 w-5 animate-spin" />;
  if (settingQ.error) return <div className="text-destructive">{extractApiError(settingQ.error).message}</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Globe className="h-4 w-4" /> App
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label htmlFor="app-name">App name</Label>
          <Input id="app-name" value={appName} onChange={(e) => setAppName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="app-publicUrl">Public URL</Label>
          <Input id="app-publicUrl" value={publicUrl} onChange={(e) => setPublicUrl(e.target.value)} placeholder="https://v-s-b.ru" />
        </div>
        <div>
          <Label htmlFor="app-supportEmail">Support email</Label>
          <Input id="app-supportEmail" type="email" value={supportEmail} onChange={(e) => setSupportEmail(e.target.value)} placeholder="support@v-s-b.ru" />
        </div>
        <Separator />
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          Сохранить
        </Button>
      </CardContent>
    </Card>
  );
}
