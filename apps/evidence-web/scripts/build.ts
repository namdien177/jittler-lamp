/// <reference types="bun-types" />

const workspaceRoot = new URL("../../../", import.meta.url);
const distRoot = new URL("../dist/", import.meta.url);

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

const build = await Bun.build({
  entrypoints: [new URL("../src/app.ts", import.meta.url).pathname],
  outdir: distRoot.pathname,
  target: "browser",
  format: "esm",
  plugins: [dedupeReactPlugin],
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
