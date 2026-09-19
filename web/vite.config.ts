import { defineConfig } from "vite";

// GitHub Pages などのサブパスでも動くように相対パスで出力する
export default defineConfig({ base: "./" });
