import { createApp } from "./app";

const { app, runtime, logger } = createApp(process.env);

app.listen({ hostname: runtime.host, port: runtime.port }, () => {
	logger.info(
		{ host: runtime.host, port: runtime.port, env: runtime.nodeEnv },
		"backend listening",
	);
});
