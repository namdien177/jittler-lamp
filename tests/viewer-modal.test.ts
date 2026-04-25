import { describe, expect, test } from "bun:test";

import { buildCurl, getResponseBodyString } from "@jittle-lamp/viewer-react";

const baseRequest = {
  kind: "network" as const,
  method: "POST",
  url: "https://example.com/api/widgets?id=42",
  request: {
    headers: [
      { name: "content-type", value: "application/json" },
      { name: "x-trace-id", value: "abc 123" }
    ],
    cookies: [],
    body: {
      disposition: "captured" as const,
      encoding: "utf8" as const,
      value: '{"name":"jonny\'s widget"}'
    }
  }
};

describe("viewer-modal — buildCurl", () => {
  test("emits headers and a quoted body", () => {
    const curl = buildCurl(baseRequest);
    expect(curl).toContain("curl -X POST 'https://example.com/api/widgets?id=42'");
    expect(curl).toContain("-H 'content-type: application/json'");
    expect(curl).toContain("-H 'x-trace-id: abc 123'");
    expect(curl).toContain("--data");
  });

  test("escapes single quotes in body", () => {
    const curl = buildCurl(baseRequest);
    // single quote in input is escaped as '\''
    expect(curl).toContain("'\\''");
  });

  test("emits base64 body marker", () => {
    const curl = buildCurl({
      ...baseRequest,
      request: {
        ...baseRequest.request,
        body: {
          disposition: "captured" as const,
          encoding: "base64" as const,
          value: "aGVsbG8="
        }
      }
    });
    expect(curl).toContain("--data-binary '@base64:aGVsbG8='");
  });

  test("omits body section when not captured", () => {
    const curl = buildCurl({
      ...baseRequest,
      request: {
        ...baseRequest.request,
        body: { disposition: "omitted" as const, reason: "too-large" }
      }
    });
    expect(curl).not.toContain("--data");
  });
});

describe("viewer-modal — getResponseBodyString", () => {
  test("returns the captured response body raw value", () => {
    const out = getResponseBodyString({
      ...baseRequest,
      response: {
        headers: [],
        setCookieHeaders: [],
        setCookies: [],
        body: { disposition: "captured" as const, encoding: "utf8" as const, value: "ok" }
      }
    });
    expect(out).toBe("ok");
  });

  test("returns empty string when no response or no body", () => {
    expect(getResponseBodyString(baseRequest)).toBe("");
  });

  test("returns empty string when body was omitted", () => {
    const out = getResponseBodyString({
      ...baseRequest,
      response: {
        headers: [],
        setCookieHeaders: [],
        setCookies: [],
        body: { disposition: "omitted" as const, reason: "binary" }
      }
    });
    expect(out).toBe("");
  });
});
