import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { makeApp, signIn } from "./helpers.ts";

let ctx: Awaited<ReturnType<typeof makeApp>>;
type Auth = { authorization: string };
let alice: Auth;
let bob: Auth;

before(async () => {
  ctx = await makeApp();
  alice = await signIn(ctx.app, "alice@example.com");
  bob = await signIn(ctx.app, "bob@example.com");
});
after(async () => { await ctx.close(); });

const create = (headers: Auth, payload: object) => ctx.app.inject({ method: "POST", url: "/notes", headers, payload });

test("an owner can create, read, list, update and delete a note", async () => {
  const created = await create(alice, { title: "Groceries", body: "milk" });
  assert.equal(created.statusCode, 201);
  const note = created.json();
  assert.equal(note.title, "Groceries");
  assert.equal("ownerId" in note || "owner_id" in note, false);

  const read = await ctx.app.inject({ method: "GET", url: `/notes/${note.id}`, headers: alice });
  assert.equal(read.json().body, "milk");

  const list = await ctx.app.inject({ method: "GET", url: "/notes", headers: alice });
  assert.ok(list.json().some((n: { id: string }) => n.id === note.id));

  const updated = await ctx.app.inject({ method: "PATCH", url: `/notes/${note.id}`, headers: alice, payload: { body: "oat milk" } });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.json().body, "oat milk");
  assert.equal(updated.json().title, "Groceries");

  assert.equal((await ctx.app.inject({ method: "DELETE", url: `/notes/${note.id}`, headers: alice })).statusCode, 204);
  assert.equal((await ctx.app.inject({ method: "GET", url: `/notes/${note.id}`, headers: alice })).statusCode, 404);
});

test("another user's note is indistinguishable from a missing one", async () => {
  const note = (await create(alice, { title: "Private" })).json();
  for (const [method, payload] of [["GET", undefined], ["PATCH", { title: "Mine now" }], ["DELETE", undefined]] as const) {
    const res = await ctx.app.inject({ method, url: `/notes/${note.id}`, headers: bob, ...(payload ? { payload } : {}) });
    assert.equal(res.statusCode, 404, method);
    assert.deepEqual(res.json(), { error: "not_found" });
  }
  const bobsList = await ctx.app.inject({ method: "GET", url: "/notes", headers: bob });
  assert.ok(!bobsList.json().some((n: { id: string }) => n.id === note.id));
  assert.equal((await ctx.app.inject({ method: "GET", url: `/notes/${note.id}`, headers: alice })).json().title, "Private");
});

test("note input is validated at the boundary", async () => {
  const note = (await create(alice, { title: "Valid" })).json();
  const cases: Array<[string, string, object]> = [
    ["POST", "/notes", {}],
    ["POST", "/notes", { title: "" }],
    ["POST", "/notes", { title: "x".repeat(201) }],
    ["POST", "/notes", { title: "ok", ownerId: "someone-else" }],
    ["PATCH", `/notes/${note.id}`, {}],
    ["PATCH", `/notes/${note.id}`, { title: 42 }],
  ];
  for (const [method, url, payload] of cases) {
    const res = await ctx.app.inject({ method: method as "POST" | "PATCH", url, headers: alice, payload });
    assert.equal(res.statusCode, 400, `${method} ${JSON.stringify(payload)}`);
  }
  assert.equal((await ctx.app.inject({ method: "GET", url: "/notes/not-a-uuid", headers: alice })).statusCode, 400);
});

test("oversized JSON bodies are refused", async () => {
  const res = await create(alice, { title: "big", body: "x".repeat(70 * 1024) });
  assert.equal(res.statusCode, 413);
});
