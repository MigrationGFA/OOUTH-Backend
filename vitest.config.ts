import { defineConfig } from "vitest/config";

const databaseUrl = "postgresql://postgres:oouth_local_dev@127.0.0.1:5433/oouth_test?schema=public";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    hookTimeout: 120000,
    testTimeout: 30000,
    env: {
      NODE_ENV: "test",
      PORT: "4000",
      DATABASE_URL: databaseUrl,
      FRONTEND_ORIGIN: "http://localhost:3000",
      JWT_ACCESS_SECRET: "test-access-secret-value",
      JWT_REFRESH_SECRET: "test-refresh-secret-value",
      VIDEO_TOKEN_SECRET: "test-video-secret-value",
      ACCESS_TOKEN_MINUTES: "15",
      REFRESH_TOKEN_DAYS: "7",
      PAYSTACK_SECRET_KEY: "sk_test_oouth",
      PAYSTACK_PUBLIC_KEY: "pk_test_oouth",
      DEMO_STAFF_PASSWORD: "Preview#2026",
    },
  },
});
