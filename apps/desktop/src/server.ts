import { startCompanionServer } from "./companion/server";

await startCompanionServer();

await new Promise(() => {
  // Keep the standalone companion server alive.
});
