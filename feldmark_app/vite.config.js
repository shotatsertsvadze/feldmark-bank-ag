import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5291,
    proxy: {
      "/api": "http://localhost:4300",
      "/uploads": "http://localhost:4300",
    },
  },
});
