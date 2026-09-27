/**
 * Security audit scanner (Phase 9). Scans the repository for obvious leaked
 * secrets — never prints actual values, only file + pattern name.
 *
 * Run: node scripts/security-audit.mjs   (exit 1 on any finding)
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "target",
  ".venv",
  "venv",
  "__pycache__",
  "coverage",
  ".turbo",
]);
const SKIP_FILES = new Set(["pnpm-lock.yaml", ".env.example"]);
const BINARY_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".exe",
  ".dll",
  ".node",
  ".zip",
  ".gz",
  ".mp4",
  ".tsbuildinfo",
]);

// Pattern name → regex. Each is aimed at real-looking secrets, not examples.
const PATTERNS = [
  { name: "pem-private-key", re: /-----BEGIN (EC |RSA |OPENSSH )?PRIVATE KEY-----/ },
  { name: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "github-pat", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: "binance-key-header", re: /X-OC-APIKEY:\s*[A-Za-z0-9]{32,}/ },
  { name: "hex-private-key-assignment", re: /private[_-]?key\s*[:=]\s*["']?[0-9a-fA-F]{64}["']/ },
  {
    name: "mnemonic-assignment",
    re: /\b(mnemonic|seed[_-]?phrase)\b\s*[:=]\s*["'][a-z]{3,}(\s+[a-z]{3,}){10,}/i,
  },
  {
    name: "bearer-token-literal",
    re: /Authorization["']?\s*[:=]\s*["']Bearer\s+[A-Za-z0-9\-_.]{25,}/,
  },
  { name: "db-url-with-password", re: /postgresql:\/\/[^:\s"']+:[^@\s"']{8,}@/ },
  { name: "openai-style-key", re: /\bsk-[A-Za-z0-9]{32,}\b/ },
];

const findings = [];

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (!SKIP_DIRS.has(entry)) walk(full);
      continue;
    }
    const dot = entry.lastIndexOf(".");
    if (dot !== -1 && BINARY_EXT.has(entry.slice(dot))) continue;
    if (SKIP_FILES.has(entry)) continue;
    const rel = relative(ROOT, full);
    let content;
    try {
      content = readFileSync(full, "utf8");
    } catch {
      continue;
    }
    for (const pattern of PATTERNS) {
      if (pattern.re.test(content)) {
        findings.push({ file: rel, pattern: pattern.name });
      }
    }
  }
}

walk(ROOT);

// .env must be gitignored (it may exist locally with real values).
try {
  const gitignore = readFileSync(join(ROOT, ".gitignore"), "utf8");
  if (!/^\.env$/m.test(gitignore)) {
    findings.push({ file: ".gitignore", pattern: "missing .env gitignore entry" });
  }
} catch {
  findings.push({ file: ".gitignore", pattern: "missing .gitignore" });
}

if (findings.length > 0) {
  console.error("SECURITY AUDIT FAILED — potential secrets found:");
  for (const f of findings) {
    console.error(`  ${f.file}: ${f.pattern}`);
  }
  process.exit(1);
}
console.log("Security audit passed: no secret patterns found in tracked sources.");
