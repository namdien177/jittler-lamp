import { describe, expect, test } from "bun:test";
import { readChromePublishConfig } from "../scripts/release/publish-chrome-extension";

describe("Chrome publishing authentication", () => {
  const env = {
    CHROME_ACCESS_TOKEN: "short-lived-test-token",
    CHROME_PUBLISHER_ID: "publisher",
    CHROME_EXTENSION_ID: "extension"
  };

  test("accepts an OIDC-generated access token without OAuth client credentials", () => {
    expect(readChromePublishConfig(env)).toEqual({
      accessToken: "short-lived-test-token",
      publisherId: "publisher",
      extensionId: "extension",
      publishType: "DEFAULT_PUBLISH"
    });
  });

  test("fails before publishing if the access token is missing or blank", () => {
    for (const accessToken of [undefined, "", "  "]) {
      expect(() => readChromePublishConfig({ ...env, CHROME_ACCESS_TOKEN: accessToken }))
        .toThrow("CHROME_ACCESS_TOKEN is required");
    }
  });

  test("still requires the destination publisher and extension", () => {
    for (const name of ["CHROME_PUBLISHER_ID", "CHROME_EXTENSION_ID"]) {
      expect(() => readChromePublishConfig({ ...env, [name]: "" }))
        .toThrow(`${name} is required`);
    }
  });
});
