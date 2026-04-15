import { startCompanionServer } from "./companion/server";

await startCompanionServer();

await new Promise(() => {
  // Keep the Bun companion server alive.
});
