export default {
  app: {
    name: "jittle-lamp",
    identifier: "dev.jittlelamp.desktop",
    version: "0.1.0"
  },
  build: {
    bun: {
      entrypoint: "src/bun/index.ts"
    },
    views: {
      mainview: {
        entrypoint: "src/mainview/app.ts"
      }
    },
    copy: {
      "src/mainview/index.html": "views/mainview/index.html",
      "src/mainview/index.css": "views/mainview/index.css"
    }
  }
};
