import { describe, expect, it, vi } from "vitest";
import { researchBody, researchUser } from "@/lib/patent-search/http";

vi.mock("@/lib/auth", () => ({ authMode: () => "configured" }));
vi.mock("@/lib/db/sessions", () => ({
  requireUser: async () => ({ id: "transport-test-user" }),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));

describe("research HTTP input boundary", () => {
  it("uses the browser-facing Host when the framework URL uses an internal hostname", async () => {
    const request = new Request("http://localhost:3000/api/patent-search", { method: "POST", headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" } });
    await expect(researchUser(request)).resolves.toMatchObject({ id: "transport-test-user" });
  });

  it.each(["https://example.invalid", "null", "not-a-url"])("rejects a foreign or opaque origin %s before authorization", async (origin) => {
    const request = new Request("http://localhost:3000/api/patent-search", { method: "POST", headers: { host: "localhost:3000", origin } });
    await expect(researchUser(request)).rejects.toMatchObject({ status: 403 });
  });

  it("bounds JSON bodies before parsing", async () => {
    const request = new Request("http://localhost/api/patent-search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "x".repeat(17000) }) });
    await expect(researchBody(request)).rejects.toMatchObject({ status: 413 });
  });

  it("rejects malformed JSON and non-JSON submissions", async () => {
    await expect(researchBody(new Request("http://localhost/", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }))).rejects.toMatchObject({ status: 400 });
    await expect(researchBody(new Request("http://localhost/", { method: "POST", body: "plain text" }))).rejects.toMatchObject({ status: 415 });
  });
});
