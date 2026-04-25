declare const process: {
  env: Record<string, string | undefined>;
};

export const clerkPublishableKey = process.env.CLERK_PUBLISHABLE_KEY?.trim() ?? "";

export const apiOrigin = (
  process.env.JITTLE_LAMP_API_ORIGIN?.trim() || "http://127.0.0.1:3001"
).replace(/\/+$/, "");
