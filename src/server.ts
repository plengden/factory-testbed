import { mkdirSync } from "node:fs";
import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { openDatabase } from "./db.ts";

const config = loadConfig();
mkdirSync(config.uploadDir, { recursive: true, mode: 0o700 });
const db = openDatabase(config.databasePath);
const app = await buildApp({ config, db, logger: { level: "info" } });

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    void app.close().finally(() => {
      db.close();
      process.exit(0);
    });
  });
}

await app.listen({ port: config.port, host: config.host });
