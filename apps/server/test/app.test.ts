import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
describe("health endpoint", () => { it("reports service health and applies baseline security headers", async () => {
  const response = await request(createApp()).get("/health");
  expect(response.status).toBe(200); expect(response.body).toEqual({ status: "ok" }); expect(response.headers["x-content-type-options"]).toBe("nosniff"); expect(response.headers["x-frame-options"]).toBe("DENY");
}); it("reports readiness without implementation details", async () => {
  const response = await request(createApp()).get("/ready");
  expect(response.status).toBe(200); expect(response.body).toEqual({ status: "ready" });
}); });
