import { describe, expect, it } from "vitest";
import { formatDate, statusLabel } from "./tournament.js";
describe("spectator presentation helpers", () => {
  it("formats valid event dates and preserves invalid values", () => { expect(formatDate("2026-08-15T00:00:00.000Z")).toContain("2026"); expect(formatDate("not-a-date")).toBe("not-a-date"); });
  it("uses live status language", () => { expect(statusLabel("ACTIVE")).toBe("LIVE"); expect(statusLabel("CANCELLED")).toBe("CANCELLED"); });
});
