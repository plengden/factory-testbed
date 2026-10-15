export interface Config {
  port: number;
  host: string;
  databasePath: string;
  uploadDir: string;
  release: string;
  environment: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return {
    port,
    host: env.HOST ?? "0.0.0.0",
    databasePath: env.DATABASE_PATH ?? ":memory:",
    uploadDir: env.UPLOAD_DIR ?? "data/uploads",
    // Set at image build time (git commit), so /healthz shows exactly which build is running.
    release: env.RELEASE ?? "dev",
    environment: env.APP_ENV ?? "development",
  };
}
