import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bot, CheckCircle2, Loader2, RefreshCw, Settings as SettingsIcon } from "lucide-react";
import { api } from "@/lib/api";
import { handleApiError } from "@/lib/errors";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { FormField } from "@/pages/Organizations";

interface AiSettings {
  provider: string;
  maskedApiKey: string;
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
  isEnabled: boolean;
  configured: boolean;
}

const PROVIDER_PRESETS: Record<string, { baseUrl: string; defaultModel: string; label: string; description: string }> = {
  openai:   { baseUrl: "https://api.openai.com/v1",     defaultModel: "gpt-4o-mini",        label: "OpenAI",          description: "Прямой доступ к OpenAI API. Нужен ключ sk-..." },
  vsegpt:   { baseUrl: "https://api.vsegpt.ru/v1",      defaultModel: "openai/gpt-4o-mini", label: "VseGPT",          description: "Российский прокси к OpenAI/Anthropic/Google. Оплата в RUB." },
  aitunnel: { baseUrl: "https://api.aitunnel.ru/v1",    defaultModel: "gpt-4o-mini",        label: "AITunnel",        description: "Российский прокси, оплата в RUB" },
  custom:   { baseUrl: "https://api.example.com/v1",    defaultModel: "model-id",           label: "Custom",          description: "Любой OpenAI-совместимый endpoint" },
  local:    { baseUrl: "http://localhost:11434/v1",     defaultModel: "llama3.1",           label: "Local (Ollama)",  description: "Локальная модель через Ollama / vLLM" },
  mock:     { baseUrl: "mock://local",                  defaultModel: "mock-gpt-base",      label: "Mock (dev/test)", description: "Детерминированный mock-провайдер без обращения в сеть. Команды «создай контрагента ...» / «создай счёт ...»" },
};

export function AiSettingsPage() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["ai-settings"],
    queryFn: async () => (await api.get<AiSettings>("/ai/settings")).data,
  });

  const [provider, setProvider] = useState("openai");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(PROVIDER_PRESETS.openai!.baseUrl);
  const [model, setModel] = useState(PROVIDER_PRESETS.openai!.defaultModel);
  const [temperature, setTemperature] = useState("0.2");
  const [maxTokens, setMaxTokens] = useState("2000");
  const [isEnabled, setIsEnabled] = useState(true);

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setProvider(data.provider);
    setApiKey(""); // не подставляем маску в input — пользователь либо вводит новый, либо оставляет пустым
    setBaseUrl(data.baseUrl);
    setModel(data.model);
    setTemperature(String(data.temperature));
    setMaxTokens(String(data.maxTokens));
    setIsEnabled(data.isEnabled);
  }, [data]);

  function onProviderChange(v: string) {
    setProvider(v);
    const preset = PROVIDER_PRESETS[v];
    if (preset) {
      setBaseUrl(preset.baseUrl);
      if (!data?.configured || data.provider !== v) setModel(preset.defaultModel);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        provider,
        baseUrl,
        model,
        temperature: parseFloat(temperature),
        maxTokens: parseInt(maxTokens),
        isEnabled,
      };
      if (apiKey && !apiKey.includes("•")) payload.apiKey = apiKey;
      await api.put("/ai/settings", payload);
      toast.success("Настройки AI сохранены");
      setApiKey("");
      refetch();
    } catch (err) {
      handleApiError(err);
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await api.post<{ ok: boolean; reply: string }>("/ai/test");
      setTestResult("✓ " + (r.data.reply || "ok"));
      toast.success("Соединение установлено");
    } catch (err) {
      const e = err as { response?: { data?: { error?: { message?: string } } } };
      setTestResult("✗ " + (e.response?.data?.error?.message ?? "Ошибка"));
      handleApiError(err, "Не удалось подключиться");
    } finally {
      setTesting(false);
    }
  }

  async function fetchModels() {
    setLoadingModels(true);
    try {
      const r = await api.post<{ models: string[] }>("/ai/models");
      setModels(r.data.models);
      toast.success(`Загружено моделей: ${r.data.models.length}`);
    } catch (err) {
      handleApiError(err);
    } finally {
      setLoadingModels(false);
    }
  }

  if (isLoading) {
    return <div className="text-muted-foreground">Загрузка...</div>;
  }

  const preset = PROVIDER_PRESETS[provider];
  const isMock = provider === "mock";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Bot className="h-6 w-6" /> AI Ассистент — настройки
        </h1>
        {data?.configured ? <Badge variant="success">Настроен</Badge> : <Badge variant="secondary">Не настроен</Badge>}
      </div>

      <div className="rounded-md border bg-sky-50 dark:bg-sky-950/30 px-3 py-2 text-sm">
        <strong>AI не выполняет действия без вашего подтверждения.</strong> Любой запрос превращается в action plan,
        который вы видите в чате и явно подтверждаете. AI пока не создаёт платежи, не редактирует и не удаляет документы.
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <SettingsIcon className="h-4 w-4" /> Провайдер
          </CardTitle>
          <CardDescription>
            Поддерживаются OpenAI-совместимые endpoint-ы. Mock-провайдер — для dev/test без внешней сети.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Провайдер">
              <Select value={provider} onValueChange={onProviderChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PROVIDER_PRESETS).map(([k, p]) => (
                    <SelectItem key={k} value={k}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {preset ? <div className="text-xs text-muted-foreground mt-1">{preset.description}</div> : null}
            </FormField>
            <FormField label="Включить AI">
              <Select value={isEnabled ? "on" : "off"} onValueChange={(v) => setIsEnabled(v === "on")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="on">Да</SelectItem>
                  <SelectItem value="off">Нет</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
          </div>

          {!isMock ? (
            <FormField label="API Key">
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={data?.maskedApiKey ? `Текущий: ${data.maskedApiKey} (оставьте пустым, чтобы не менять)` : "sk-..."}
                autoComplete="off"
              />
              <div className="text-xs text-muted-foreground mt-1">
                Ключ хранится в БД зашифрованным (AES-256-GCM). На клиент возвращается только маска.
              </div>
            </FormField>
          ) : (
            <div className="text-xs text-muted-foreground">
              Mock-провайдер не требует API-ключа.
            </div>
          )}

          <FormField label="Base URL">
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" disabled={isMock} />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Модель">
              {models.length > 0 ? (
                <Select value={model} onValueChange={setModel}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {models.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-4o-mini" />
              )}
              <div className="text-xs text-muted-foreground mt-1">
                Если /models недоступен — введите название модели вручную.
              </div>
            </FormField>
            <FormField label="Список моделей">
              <Button type="button" variant="outline" onClick={fetchModels} disabled={loadingModels || !data?.configured}>
                {loadingModels ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Получить модели
              </Button>
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Temperature (0–2)</Label>
              <Input type="number" step="0.1" min="0" max="2" value={temperature} onChange={(e) => setTemperature(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Max tokens</Label>
              <Input type="number" step="100" min="100" max="32000" value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} />
            </div>
          </div>

          <div className="flex gap-2 pt-2 flex-wrap">
            <Button onClick={save} disabled={saving}>
              {saving ? "Сохранение..." : "Сохранить"}
            </Button>
            <Button variant="outline" onClick={test} disabled={testing || !data?.configured}>
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Проверить подключение
            </Button>
            {testResult ? (
              <span className={`text-sm self-center ${testResult.startsWith("✓") ? "text-emerald-700" : "text-destructive"}`}>
                {testResult}
              </span>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
