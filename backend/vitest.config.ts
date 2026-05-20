import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["src/lib/**/*.test.ts", "src/pdf/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "integration",
          include: ["src/test/integration/**/*.test.ts"],
          environment: "node",
          fileParallelism: false,
          hookTimeout: 30_000,
          testTimeout: 15_000,
        },
      },
    ],
  },
});
