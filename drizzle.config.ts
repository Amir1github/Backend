import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
    // Опционально настраиваем пул для Supabase
    poolOptions: {
      max: 5,                 // макс соединений
      idleTimeoutMillis: 5000, // 5 секунд для "idle"
      connectionTimeoutMillis: 5000, // таймаут на новое подключение
    },
  },
});

