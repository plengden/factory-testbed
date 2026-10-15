// Deterministic risk classifier (Factory-Design.md §3; ported from paperclip-bmad-test, extended).
// Input: changed files with line counts, plus findings from weakened.mjs. Output: { class, reasons }.
// Rules, highest match wins: high > standard > docs. Classes only go UP: --floor and findings raise, nothing lowers.
// Usage: node classify.mjs <base-sha> <head-sha> [--floor docs|standard|high] [--findings weakened.json]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const ORDER = ["docs", "standard", "high"];
export const DIFF_LINE_LIMIT = 400;

// Protected paths (constitution "Boundaries") and anything that can change how the code is built, tested or gated.
const HIGH_PATH = [
  /^\.github\//,
  /(^|\/)CODEOWNERS$/,
  /^policy\//,
  /^\.claude\//,
  /(^|\/)(AGENTS|CLAUDE)\.md$/,
  /(^|\/)\.(npmrc|gitattributes|gitmodules|semgrepignore|gitleaksignore|trivyignore|dockerignore|nvmrc)$/,
  /(^|\/)tsconfig[^/]*\.json$/,
  /(^|\/)eslint\.config\.[cm]?[jt]s$/,
  /(^|\/)auth(entication|orization)?\//i,
  /(^|\/)security\//i,
  /(^|\/)secrets?\//i,
  /(^|\/)infra(structure)?\//i,
  /(^|\/)migrations?\//i,
  /\.tf$/,
  /(^|\/)Dockerfile[^/]*$/,
  /(^|\/)\.env[^/]*$/,
];
const MANIFEST = /(^|\/)(package(-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|requirements[^/]*\.txt|pyproject\.toml|poetry\.lock|Pipfile(\.lock)?|go\.(mod|sum)|Cargo\.(toml|lock)|pom\.xml|build\.gradle(\.kts)?|Gemfile(\.lock)?|composer\.(json|lock))$/;
const DOC = /(\.(md|mdx|rst|txt|adoc)$)|(^|\/)docs?\//i;

export function classify(files, floor = "docs", findings = []) {
  const reasons = [];
  const lines = files.reduce((n, f) => n + (f.added || 0) + (f.deleted || 0), 0);
  let cls = "docs";
  if (files.length === 0) reasons.push("no changed files");
  for (const f of files) {
    if (HIGH_PATH.some((r) => r.test(f.path))) { cls = "high"; reasons.push(`high-risk path: ${f.path}`); }
    else if (MANIFEST.test(f.path)) { cls = "high"; reasons.push(`dependency manifest or lockfile: ${f.path}`); }
    else if (!DOC.test(f.path) && cls !== "high") { cls = "standard"; }
  }
  if (lines > DIFF_LINE_LIMIT) { cls = "high"; reasons.push(`diff of ${lines} lines exceeds ${DIFF_LINE_LIMIT}`); }
  if (findings.length) { cls = "high"; reasons.push(...findings.map((x) => `bar lowered: ${x}`)); }
  if (cls === "standard") reasons.push("application code or tests changed, no high-risk rule hit");
  if (cls === "docs" && files.length) reasons.push("only documentation files changed");
  if (ORDER.indexOf(floor) > ORDER.indexOf(cls)) { reasons.push(`raised from ${cls} to ${floor} by floor`); cls = floor; }
  return { class: cls, reasons, changedFiles: files.length, changedLines: lines };
}

export function changedFiles(base, head) {
  const out = execFileSync("git", ["diff", "--numstat", "-z", `${base}...${head}`], { encoding: "utf8" });
  const files = [];
  const parts = out.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const m = /^(\d+|-)\t(\d+|-)\t(.*)$/.exec(parts[i]);
    if (!m) continue;
    let path = m[3];
    if (path === "") {
      // Rename: old and new path follow. Both count, so renaming a protected file away is still high.
      files.push({ path: parts[i + 1], added: 0, deleted: 0 });
      path = parts[i + 2];
      i += 2;
    }
    files.push({ path, added: m[1] === "-" ? 0 : +m[1], deleted: m[2] === "-" ? 0 : +m[2] });
  }
  return files;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const [base, head] = args;
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const floor = opt("--floor") ?? "docs";
  if (!base || !head) { console.error("usage: classify.mjs <base> <head> [--floor class] [--findings file]"); process.exit(2); }
  if (!ORDER.includes(floor)) { console.error("floor must be docs, standard or high"); process.exit(2); }
  const findingsFile = opt("--findings");
  const findings = findingsFile ? JSON.parse(readFileSync(findingsFile, "utf8")).findings : [];
  console.log(JSON.stringify(classify(changedFiles(base, head), floor, findings)));
}
