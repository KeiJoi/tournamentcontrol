import { describe, expect, it } from "vitest";
import { readConfig } from "../src/config.js";

const secrets = { PUBLIC_BASE_URL: "https://tournaments.example.com", SERVER_ACCESS_PASSWORD: "server", MASTER_ADMIN_PASSWORD: "master", SESSION_SECRET: "a-session-secret-with-more-than-thirty-two-characters" };

describe("production deployment configuration", () => {
  it("requires the Render persistent-disk database path in production", () => {
    expect(() => readConfig({ ...secrets, NODE_ENV: "production", DATABASE_PATH: "/tmp/tournaments.sqlite" })).toThrow();
  });

  it("accepts the Render database path and Render-provided port", () => {
    expect(readConfig({ ...secrets, NODE_ENV: "production", PORT: "10000", DATABASE_PATH: "/var/data/vat-tournaments.sqlite" })).toMatchObject({ PORT: 10000, DATABASE_PATH: "/var/data/vat-tournaments.sqlite" });
  });
});
