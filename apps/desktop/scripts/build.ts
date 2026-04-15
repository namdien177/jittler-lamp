const projectRoot = new URL("..", import.meta.url);
const distRoot = new URL("../dist/", import.meta.url);
const viewsRoot = new URL("./views/mainview/", distRoot);
const bunRoot = new URL("./bun/", distRoot);

const [bunBuild, viewBuild] = await Promise.all([
  Bun.build({
    entrypoints: [new URL("../src/bun/index.ts", import.meta.url).pathname],
    outdir: bunRoot.pathname,
    target: "bun",
    format: "esm",
    external: ["electrobun", "electrobun/bun"],
    naming: "[name].js"
  }),
  Bun.build({
    entrypoints: [new URL("../src/mainview/app.ts", import.meta.url).pathname],
    outdir: viewsRoot.pathname,
    target: "browser",
    format: "esm",
    naming: "[name].js"
  })
]);

if (!bunBuild.success || !viewBuild.success) {
  for (const log of [...bunBuild.logs, ...viewBuild.logs]) {
    console.error(log);
  }

  process.exit(1);
}

await Promise.all([
  Bun.write(
    new URL("index.html", viewsRoot),
    Bun.file(new URL("../src/mainview/index.html", import.meta.url))
  ),
  Bun.write(
    new URL("index.css", viewsRoot),
    Bun.file(new URL("../src/mainview/index.css", import.meta.url))
  ),
  Bun.write(
    new URL("electrobun.config.ts", distRoot),
    Bun.file(new URL("electrobun.config.ts", projectRoot))
  )
]);

console.info(`Built desktop shell scaffold into ${distRoot.pathname}`);
