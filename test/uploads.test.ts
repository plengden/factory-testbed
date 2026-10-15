import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { after, before, test } from "node:test";
import { makeApp, signIn } from "./helpers.ts";

let ctx: Awaited<ReturnType<typeof makeApp>>;
type Auth = { authorization: string };
let alice: Auth;
let bob: Auth;

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("png body")]);
const PDF = Buffer.from("%PDF-1.7\n%test document\n");

before(async () => {
  ctx = await makeApp();
  alice = await signIn(ctx.app, "alice@example.com");
  bob = await signIn(ctx.app, "bob@example.com");
});
after(async () => { await ctx.close(); });

async function newNote(headers: Auth): Promise<string> {
  return (await ctx.app.inject({ method: "POST", url: "/notes", headers, payload: { title: "with files" } })).json().id;
}

function upload(noteId: string, headers: Auth, bytes: Buffer, filename: string) {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)]), filename);
  return ctx.app.inject({ method: "POST", url: `/notes/${noteId}/attachments`, headers, payload: form });
}

test("an owner can upload an allowed file and download it back as an attachment", async () => {
  const noteId = await newNote(alice);
  const res = await upload(noteId, alice, PNG, "photo.png");
  assert.equal(res.statusCode, 201);
  const { id, contentType, sizeBytes } = res.json();
  assert.equal(contentType, "image/png");
  assert.equal(sizeBytes, PNG.length);

  const dl = await ctx.app.inject({ method: "GET", url: `/notes/${noteId}/attachments/${id}`, headers: alice });
  assert.equal(dl.statusCode, 200);
  assert.equal(dl.headers["content-type"], "image/png");
  assert.equal(dl.headers["content-disposition"], `attachment; filename="${id}.png"`);
  assert.deepEqual(dl.rawPayload, PNG);
});

test("file type comes from the content, and must match the extension", async () => {
  const noteId = await newNote(alice);
  assert.equal((await upload(noteId, alice, PDF, "doc.pdf")).statusCode, 201);
  for (const [bytes, name] of [[PNG, "image.pdf"], [Buffer.from("<script>alert(1)</script>"), "page.png"], [PDF, "doc.html"]] as const) {
    const res = await upload(noteId, alice, bytes, name);
    assert.equal(res.statusCode, 415, name);
  }
});

test("files over the size cap are refused", async () => {
  const noteId = await newNote(alice);
  const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);
  assert.equal((await upload(noteId, alice, big, "big.png")).statusCode, 413);
});

test("stored files are named by their id, never by the client's filename", async () => {
  const noteId = await newNote(alice);
  const res = await upload(noteId, alice, PNG, "../../escape.png");
  assert.equal(res.statusCode, 201);
  assert.ok(readdirSync(ctx.uploadDir).includes(res.json().id));
  assert.ok(readdirSync(ctx.uploadDir).every((f) => /^[0-9a-f-]{36}$/.test(f)));
});

test("another user can neither upload to nor download from a note they do not own", async () => {
  const noteId = await newNote(alice);
  const { id } = (await upload(noteId, alice, PNG, "a.png")).json();
  assert.equal((await upload(noteId, bob, PNG, "b.png")).statusCode, 404);
  const dl = await ctx.app.inject({ method: "GET", url: `/notes/${noteId}/attachments/${id}`, headers: bob });
  assert.equal(dl.statusCode, 404);
});

test("deleting a note removes its files", async () => {
  const noteId = await newNote(alice);
  const { id } = (await upload(noteId, alice, PNG, "gone.png")).json();
  await ctx.app.inject({ method: "DELETE", url: `/notes/${noteId}`, headers: alice });
  assert.ok(!readdirSync(ctx.uploadDir).includes(id));
});
