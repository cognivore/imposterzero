import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: {
    __WS_URL__: JSON.stringify(
      process.env.WS_URL ?? "ws://localhost:30588",
    ),
  },
});
