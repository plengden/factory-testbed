import test from "node:test";
import assert from "node:assert/strict";
import { classify } from "./classify.mjs";
import { findWeakening } from "./weakened.mjs";
import { checkLockfile } from "./lockfile-check.mjs";
import { SECTIONS, checkBody, checkTrailers } from "./pr-contract.mjs";

const f = (path, added = 1, deleted = 0) => ({ path, added, deleted });
const cls = (files, floor, findings) => classify(files, floor, findings).class;

// classify (ported from paperclip-bmad-test, extended for the factory's protected paths)
test("docs only", () => assert.equal(cls([f("README.md"), f("docs/guide.txt")]), "docs"));
test("empty diff is docs", () => assert.equal(cls([]), "docs"));
test("application code is standard", () => assert.equal(cls([f("src/notes/routes.ts"), f("test/notes.test.ts")]), "standard"));
test("code plus docs is standard", () => assert.equal(cls([f("README.md"), f("src/app.ts")]), "standard"));
test("anything under .github is high", () => {
  for (const p of [".github/workflows/ci.yml", ".github/scripts/classify.mjs", ".github/CODEOWNERS"]) assert.equal(cls([f(p)]), "high", p);
});
test("constitution-protected paths are high, even when they look like docs", () => {
  for (const p of ["AGENTS.md", "src/CLAUDE.md", "policy/blocklist.json", ".claude/settings.json", ".npmrc", ".semgrepignore", ".gitleaksignore", ".trivyignore", ".dockerignore", ".nvmrc", "CODEOWNERS"]) {
    assert.equal(cls([f(p)]), "high", p);
  }
});
test("build, lint and type-check config is high", () => {
  for (const p of ["tsconfig.json", "tsconfig.build.json", "eslint.config.js", "eslint.config.mjs"]) assert.equal(cls([f(p)]), "high", p);
});
test("auth path is high", () => assert.equal(cls([f("src/auth/sessions.ts")]), "high"));
test("migrations, terraform, Dockerfile, env are high", () => {
  for (const p of ["migrations/0002_tags.sql", "infra/main.tf", "modules/x.tf", "Dockerfile", "app/Dockerfile.prod", ".env.production"]) assert.equal(cls([f(p)]), "high", p);
});
test("dependency manifests and lockfiles are high", () => {
  for (const p of ["package.json", "package-lock.json", "requirements.txt", "go.sum", "Cargo.lock"]) assert.equal(cls([f(p)]), "high", p);
});
test("diff over 400 lines is high, exactly 400 is not", () => {
  assert.equal(cls([f("src/a.ts", 400)]), "standard");
  assert.equal(cls([f("src/a.ts", 300, 101)]), "high");
});
test("a high file among low ones wins", () => assert.equal(cls([f("README.md"), f("src/a.ts"), f("infra/x.js")]), "high"));
test("auth-like names that are not directories stay standard", () => assert.equal(cls([f("src/author.ts"), f("src/authority.ts")]), "standard"));
test("floor can raise but never lower", () => {
  assert.equal(cls([f("README.md")], "standard"), "standard");
  assert.equal(cls([f("src/a.ts")], "high"), "high");
  assert.equal(cls([f(".github/workflows/ci.yml")], "docs"), "high");
});
test("weakening findings raise the class to high and are listed as reasons", () => {
  const r = classify([f("test/notes.test.ts")], "docs", ["test file deleted: test/a.test.ts"]);
  assert.equal(r.class, "high");
  assert.match(r.reasons.join(" "), /bar lowered: test file deleted/);
});

// weakened
test("deleted test files are flagged; deleted source files are not", () => {
  const out = findWeakening([{ path: "test/notes.test.ts", status: "D" }, { path: "src/old.ts", status: "D" }], []);
  assert.deepEqual(out, ["test file deleted: test/notes.test.ts"]);
});
test("skipped or focused tests are flagged in test files", () => {
  for (const line of ['test.skip("x", () => {})', 'it.only("x", () => {})', 'test("x", { skip: true }, () => {})', "describe.todo('y')"]) {
    assert.equal(findWeakening([], [{ path: "test/a.test.ts", line }]).length, 1, line);
  }
  assert.equal(findWeakening([], [{ path: "src/skip.ts", line: "const skip = items.skip(2)" }]).length, 0);
});
test("new suppressions are flagged anywhere", () => {
  for (const line of ["// @ts-ignore", "// @ts-expect-error", "/* eslint-disable */", "x(); // nosemgrep", "# gitleaks:allow"]) {
    assert.equal(findWeakening([], [{ path: "src/a.ts", line }]).length, 1, line);
  }
});
test("loosened type checking is flagged", () => {
  assert.equal(findWeakening([], [{ path: "tsconfig.json", line: '    "strict": false,' }]).length, 1);
});
test("ordinary changes produce no findings", () => {
  assert.deepEqual(findWeakening([{ path: "src/a.ts", status: "M" }], [{ path: "test/a.test.ts", line: 'test("adds", () => {})' }]), []);
});

// lockfile-check
const goodLock = {
  lockfileVersion: 3,
  packages: { "": {}, "node_modules/x": { resolved: "https://registry.npmjs.org/x/-/x-1.0.0.tgz", integrity: "sha512-abc" } },
};
test("a registry-only, integrity-pinned lockfile with exact versions passes", () => {
  assert.deepEqual(checkLockfile({ dependencies: { x: "1.0.0" } }, goodLock), []);
});
test("ranges, foreign sources, missing integrity and links are refused", () => {
  const lock = { lockfileVersion: 3, packages: { "": {},
    "node_modules/a": { resolved: "https://evil.example/a.tgz", integrity: "sha512-x" },
    "node_modules/b": { resolved: "https://registry.npmjs.org/b/-/b-1.0.0.tgz" },
    "node_modules/c": { link: true } } };
  const problems = checkLockfile({ dependencies: { x: "^1.0.0", y: "github:user/y" } }, lock);
  assert.equal(problems.length, 5, problems.join("\n"));
});

// pr-contract
const fullBody = SECTIONS.map((s) => `## ${s}\nnone`).join("\n");
test("a body with every section filled passes", () => assert.deepEqual(checkBody(fullBody), []));
test("missing and empty sections are reported", () => {
  const body = fullBody.replace("## Evidence\nnone", "## Evidence\n").replace(/## Suspected injection\nnone/, "");
  assert.deepEqual(checkBody(body), [
    'PR body section "## Evidence" is empty (write "none" if nothing applies)',
    'PR body is missing the "## Suspected injection" section',
  ]);
});
test("commits need all three trailers", () => {
  const ok = { sha: "a".repeat(40), message: "Fix\n\nPaperclip-Issue: SDL-1\nAgent: developer\nModel: claude-opus-5-5" };
  const bad = { sha: "b".repeat(40), message: "Fix\n\nAgent: developer" };
  assert.deepEqual(checkTrailers([ok]), []);
  assert.equal(checkTrailers([bad]).length, 2);
});
