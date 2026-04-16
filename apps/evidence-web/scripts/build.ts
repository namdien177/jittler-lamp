/// <reference types="bun-types" />

const distRoot = new URL("../dist/", import.meta.url);

const build = await Bun.build({
  entrypoints: [new URL("../src/app.ts", import.meta.url).pathname],
  outdir: distRoot.pathname,
  target: "browser",
  format: "esm",
  naming: "[name].js",
  minify: true
});

if (!build.success) {
  for (const log of build.logs) {
    console.error(log);
  }
  process.exit(1);
}

await Promise.all([
  Bun.write(
    new URL("index.html", distRoot),
    Bun.file(new URL("../src/index.html", import.meta.url))
  ),
  Bun.write(
    new URL("index.css", distRoot),
    Bun.file(new URL("../src/index.css", import.meta.url))
  )
]);

console.info(`Built evidence-web into ${distRoot.pathname}`);
