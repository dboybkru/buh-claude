// Валидация переменных окружения.
// При невалидной конфигурации backend не стартует — ошибка выводится без раскрытия
// фактических значений (только имена и сообщения Zod), чтобы случайно не залогировать секреты.

import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  // Среда / порт
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().default("0.0.0.0"),

  // База данных
  DATABASE_URL: z.string().url("DATABASE_URL должен быть валидным URL подключения к PostgreSQL"),

  // CORS — список разрешённых origin через запятую
  CORS_ORIGIN: z.string().default("http://localhost:5173"),

  // JWT — секрет минимум 32 символа (используется и для AES-256-GCM шифрования apiKey)
  JWT_SECRET: z.string().min(32, "JWT_SECRET должен быть не короче 32 символов (используется и для шифрования AI apiKey)"),
  JWT_EXPIRES_IN: z.string().default("7d"),

  // Sprint 10: отдельный ключ для шифрования секретов IntegrationSetting.
  // Опционален: если пуст, lib/secrets.ts падёт на JWT_SECRET-derived key.
  APP_ENCRYPTION_KEY: z.string().default(""),

  // Файлы — uploads для логотипа/печати/подписи организации
  UPLOADS_DIR: z.string().default("./uploads"),
  MAX_UPLOAD_SIZE_MB: z.coerce.number().int().positive().default(10),

  // Внешние сервисы (опционально)
  DADATA_API_KEY: z.string().default(""),
  DADATA_SECRET_KEY: z.string().default(""),

  // Логирование
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Не выводим само значение переменных — только имена и описания ошибок,
  // чтобы случайно не утёк JWT_SECRET / DATABASE_URL пароль в логах процесса.
  const fieldErrors = parsed.error.flatten().fieldErrors;
  // eslint-disable-next-line no-console
  console.error("❌ Невалидные переменные окружения:");
  for (const [field, messages] of Object.entries(fieldErrors)) {
    // eslint-disable-next-line no-console
    console.error(`  • ${field}: ${(messages ?? []).join("; ")}`);
  }
  // eslint-disable-next-line no-console
  console.error("\nПодсказка: см. backend/.env.example. Не коммитьте реальные секреты в git.");
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;

/** Экспортируем schema отдельно — для unit-тестов проверки парсинга. */
export const envSchema = schema;
