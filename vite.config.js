import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// ⚠️ Remplace "barometre" par le nom exact de ton repo GitHub si besoin.
// Ce "base" est nécessaire pour que les assets se chargent correctement
// une fois hébergé sur https://<ton-pseudo>.github.io/<nom-du-repo>/
export default defineConfig({
  plugins: [react()],
  base: "/BarOmetre/",
});
