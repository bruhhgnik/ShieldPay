import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ["fhevmjs", "@zama-fhe/relayer-sdk/web"],
  },
  resolve: {
    alias: {
      // node polyfills needed by fhevmjs
      buffer: "buffer",
    },
  },
});
