import { env } from "./lib/env.js";
import { buildServer } from "./server.js";
import { disconnectPrisma } from "./lib/prisma.js";

async function main() {
  const app = await buildServer();

  const shutdown = async (signal: string) => {
    app.log.info(`Получен сигнал ${signal}, завершаю работу...`);
    try {
      await app.close();
      await disconnectPrisma();
      process.exit(0);
    } catch (err) {
      app.log.error(err);
      process.exit(1);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    app.log.info(`BuhClaude API listening on http://${env.HOST}:${env.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
