// Dependency vetting before any install (Factory-Design.md §3 CI): every locked package must come from the
// npm registry with an sha512 integrity hash, and package.json may name only exact versions.
// Blocks dependency confusion and tampered or unpinned sources. Usage: node lockfile-check.mjs [dir]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const REGISTRY = "https://registry.npmjs.org/";
const EXACT = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

export function checkLockfile(pkg, lock) {
  const problems = [];
  for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const [name, spec] of Object.entries(pkg[section] ?? {})) {
      if (!EXACT.test(spec)) problems.push(`package.json ${section}.${name} is "${spec}", not an exact version`);
    }
  }
  if (lock.lockfileVersion !== 3) problems.push(`lockfileVersion ${lock.lockfileVersion}, expected 3`);
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (path === "") continue;
    if (entry.link) { problems.push(`${path} is a link, not a registry package`); continue; }
    if (!entry.resolved?.startsWith(REGISTRY)) problems.push(`${path} resolves outside the npm registry: ${entry.resolved ?? "(none)"}`);
    if (!entry.integrity?.startsWith("sha512-")) problems.push(`${path} has no sha512 integrity`);
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2] ?? ".";
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(join(dir, "package-lock.json"), "utf8"));
  const problems = checkLockfile(pkg, lock);
  for (const p of problems) console.error(`::error::${p}`);
  console.log(problems.length ? `${problems.length} problem(s)` : `lockfile OK: ${Object.keys(lock.packages).length - 1} packages, all from ${REGISTRY}`);
  process.exit(problems.length ? 1 : 0);
}
