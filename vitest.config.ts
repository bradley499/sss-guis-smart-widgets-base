import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "happy-dom", // Simulates the browser document API
        setupFiles: ["./vitest.setup.ts"]
    },
});
