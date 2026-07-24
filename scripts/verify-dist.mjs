import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const dist = resolve("dist");
const expectedHtml = [
  "index.html",
  "tracker/index.html",
  "about/index.html",
  "account/index.html",
];
const forbiddenOutputs = [
  "tracker.html",
  "about.html",
  "account.html",
  "finances.html",
  "projects.html",
  "finance/index.html",
  "finances/index.html",
  "projects/index.html",
];

function fail(message) {
  throw new Error(`dist verification failed: ${message}`);
}

if (!existsSync(dist)) fail("dist directory is missing");

for (const relativePath of expectedHtml) {
  if (!existsSync(resolve(dist, relativePath))) {
    fail(`missing ${relativePath}`);
  }
}

for (const relativePath of forbiddenOutputs) {
  if (existsSync(resolve(dist, relativePath))) {
    fail(`unexpected ${relativePath}`);
  }
}

function filesIn(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = resolve(directory, name);
    return statSync(path).isDirectory() ? filesIn(path) : [path];
  });
}

const textFiles = filesIn(dist).filter((path) => /\.(?:html|css|js)$/.test(path));
const combined = textFiles.map((path) => readFileSync(path, "utf8")).join("\n");

if (combined.includes("/personal-website/")) {
  fail("found the old /personal-website/ base path");
}
if (combined.includes("stanleywh.github.io/personal-website")) {
  fail("found the old GitHub Pages URL");
}
if (/(?:index|tracker|about|account|finances|finance|projects)\.html\b/.test(combined)) {
  fail("found legacy .html navigation");
}
if (!combined.includes("/assets/")) {
  fail("no root-relative /assets/ references were emitted");
}

for (const relativePath of expectedHtml) {
  const html = readFileSync(resolve(dist, relativePath), "utf8");
  for (const match of html.matchAll(/(?:src|href)="(\/[^"#?]+)"/g)) {
    const url = match[1];
    if (/\.(?:css|js)$/.test(url) && !url.startsWith("/assets/")) {
      fail(`${relativePath} contains non-root asset URL ${url}`);
    }
  }
}

const routeExpectations = new Map([
  ["index.html", ['href="/tracker/"', 'href="/about/"']],
  ["tracker/index.html", ['href="/"', 'href="/account/?mode=login&amp;next=tracker"']],
  ["about/index.html", ['href="/"', 'href="/tracker/"']],
  ["account/index.html", ['href="/"']],
]);

for (const [relativePath, snippets] of routeExpectations) {
  const html = readFileSync(resolve(dist, relativePath), "utf8");
  for (const snippet of snippets) {
    if (!html.includes(snippet)) {
      fail(`${relativePath} is missing ${snippet}`);
    }
  }
}

console.log("dist verification passed");
