const projectRoot = new URL("..", import.meta.url);
const workspaceRoot = new URL("../../../", import.meta.url);
const distRoot = new URL("../dist/", import.meta.url);
const viewsRoot = new URL("./views/mainview/", distRoot);
const bunRoot = new URL("./bun/", distRoot);

const reactEntrypoints = new Map([
  ["react", new URL("node_modules/react/index.js", workspaceRoot).pathname],
  ["react/jsx-runtime", new URL("node_modules/react/jsx-runtime.js", workspaceRoot).pathname],
  ["react/jsx-dev-runtime", new URL("node_modules/react/jsx-dev-runtime.js", workspaceRoot).pathname]
]);

const dedupeReactPlugin = {
  name: "dedupe-react",
  setup(build: {
    onResolve: (
      options: { filter: RegExp },
      callback: (args: { path: string }) => { path: string } | undefined
    ) => void;
  }) {
    build.onResolve({ filter: /^react(?:\/jsx-runtime|\/jsx-dev-runtime)?$/ }, (args) => {
      const path = reactEntrypoints.get(args.path);
      return path ? { path } : undefined;
    });
  }
};

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
    entrypoints: [new URL("../src/mainview/app.tsx", import.meta.url).pathname],
    outdir: viewsRoot.pathname,
    target: "browser",
    format: "esm",
    plugins: [dedupeReactPlugin],
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
