import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { PASSWORD, makeApp, signIn } from "./helpers.ts";

let ctx: Awaited<ReturnType<typeof makeApp>>;
before(async () => { ctx = await makeApp(); });
after(async () => { await ctx.close(); });

const register = (payload: object) => ctx.app.inject({ method: "POST", url: "/auth/register", payload });
const login = (payload: object) => ctx.app.inject({ method: "POST", url: "/auth/login", payload });

test("register returns the new user without any password material", async () => {
  const res = await register({ email: "reg@example.com", password: PASSWORD });
  assert.equal(res.statusCode, 201);
  assert.deepEqual(Object.keys(res.json()).sort(), ["email", "id"]);
});

test("passwords are stored as salted scrypt hashes", async () => {
  await register({ email: "hash@example.com", password: PASSWORD });
  const row = ctx.db.prepare("SELECT password_hash FROM users WHERE email = ?").get("hash@example.com");
  assert.match(String(row?.password_hash), /^scrypt\$[\w-]+\$[\w-]+$/);
  assert.ok(!String(row?.password_hash).includes(PASSWORD));
});

test("registering an existing email fails without saying why", async () => {
  await register({ email: "dup@example.com", password: PASSWORD });
  const res = await register({ email: "DUP@example.com", password: PASSWORD });
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.json(), { error: "registration_failed" });
});

test("register rejects short passwords, bad emails and unknown fields", async () => {
  for (const payload of [
    { email: "short@example.com", password: "too-short" },
    { email: "not-an-email", password: PASSWORD },
    { email: "extra@example.com", password: PASSWORD, isAdmin: true },
  ]) {
    const res = await register(payload);
    assert.equal(res.statusCode, 400, JSON.stringify(payload));
    assert.deepEqual(res.json(), { error: "invalid_request" });
  }
});

test("login with a wrong password or unknown email gives the same 401", async () => {
  await register({ email: "login@example.com", password: PASSWORD });
  const wrong = await login({ email: "login@example.com", password: "wrong password here" });
  const unknown = await login({ email: "nobody@example.com", password: PASSWORD });
  assert.equal(wrong.statusCode, 401);
  assert.equal(unknown.statusCode, 401);
  assert.deepEqual(wrong.json(), unknown.json());
});

test("a session token unlocks protected routes until logout", async () => {
  const headers = await signIn(ctx.app, "session@example.com");
  assert.equal((await ctx.app.inject({ method: "GET", url: "/notes", headers })).statusCode, 200);
  assert.equal((await ctx.app.inject({ method: "POST", url: "/auth/logout", headers })).statusCode, 204);
  assert.equal((await ctx.app.inject({ method: "GET", url: "/notes", headers })).statusCode, 401);
});

test("only a hash of the session token is stored", async () => {
  const { authorization } = await signIn(ctx.app, "tokenhash@example.com");
  const token = authorization.slice("Bearer ".length);
  const rows = ctx.db.prepare("SELECT token_hash FROM sessions").all().map((r) => String(r.token_hash));
  assert.ok(rows.length > 0);
  assert.ok(!rows.includes(token));
});

test("protected routes refuse missing and malformed tokens", async () => {
  for (const authorization of [undefined, "Bearer nope", "Basic abc", `Bearer ${"A".repeat(43)}`]) {
    const res = await ctx.app.inject({ method: "GET", url: "/notes", headers: authorization ? { authorization } : {} });
    assert.equal(res.statusCode, 401, String(authorization));
  }
});
