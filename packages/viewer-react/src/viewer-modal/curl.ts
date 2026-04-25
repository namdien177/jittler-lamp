import type { TimelineItem } from "@jittle-lamp/shared";

type NetworkPayload = Extract<TimelineItem["payload"], { kind: "network" }>;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function buildCurl(payload: NetworkPayload): string {
  const parts: string[] = ["curl", "-X", payload.method, shellQuote(payload.url)];

  for (const header of payload.request.headers) {
    parts.push("-H", shellQuote(`${header.name}: ${header.value}`));
  }

  const body = payload.request.body;
  if (body && body.disposition === "captured" && body.value !== undefined) {
    if (body.encoding === "base64") {
      parts.push("--data-binary", shellQuote(`@base64:${body.value}`));
    } else {
      parts.push("--data", shellQuote(body.value));
    }
  }

  return parts.join(" ");
}

export function getResponseBodyString(payload: NetworkPayload): string {
  const body = payload.response?.body;
  if (!body) return "";
  if (body.disposition !== "captured") return "";
  return body.value ?? "";
}
