import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { makeApp } from "./helpers.ts";

let ctx: Awaited<ReturnType<typeof makeApp>>;
before(async () => { ctx = await makeApp(); });
after(async () => { await ctx.close(); });

test("GET /healthz reports status, release and environment", async () => {
  const res = await ctx.app.inject({ method: "GET", url: "/healthz" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { status: "ok", release: "test-release", environment: "test" });
});

test("responses carry the security headers", async () => {
  const res = await ctx.app.inject({ method: "GET", url: "/healthz" });
  assert.equal(res.headers["x-content-type-options"], "nosniff");
  assert.equal(res.headers["x-frame-options"], "DENY");
  assert.equal(res.headers["cache-control"], "no-store");
});

test("unknown routes answer a generic 404", async () => {
  const res = await ctx.app.inject({ method: "GET", url: "/nope" });
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.json(), { error: "not_found" });
});
