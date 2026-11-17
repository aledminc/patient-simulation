import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 8000,
    strictPort: true,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Resource-Policy": "same-origin"
    }
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Resource-Policy": "same-origin"
    }
  },
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 6500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("@mlc-ai/web-llm")) return "webllm";
          if (id.includes("@huggingface/transformers") || id.includes("onnxruntime")) return "transformers";
          if (id.includes("kokoro-js")) return "kokoro";
        }
      }
    }
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"],
    coverage: { reporter: ["text", "json-summary"] }
  }
});
