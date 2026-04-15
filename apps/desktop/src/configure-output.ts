import { saveCompanionConfig } from "./companion/config";

const outputDir = process.argv[2];

if (!outputDir) {
  throw new Error("Usage: bun run ./src/configure-output.ts <output-directory>");
}

const config = await saveCompanionConfig({ outputDir });
console.info(`jittle-lamp companion output directory set to ${config.outputDir}`);
