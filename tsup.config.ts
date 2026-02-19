import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  target: "node20",
  dts: true,
  clean: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
});
