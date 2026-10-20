import assert from "node:assert/strict";
import { test } from "node:test";
import { validateHtml, validateUpload } from "../src/html-policy.js";
import { FULL_ACCESS_SANDBOX, renderViewer } from "../src/viewer.js";

const page = `<!doctype html><title>Full</title>
<script src="https://cdn.example/lib.js"></script>
<form action="https://example.com"><iframe src="https://example.com"></iframe></form>
<script>fetch("https://api.example").then(() => new Worker("w.js"))</script>`;

test("full access publishes markup the stock policy blocks", () => {
  assert.equal(validateHtml(page).ok, false);

  const result = validateHtml(page, { fullAccess: true });
  assert.deepEqual(result.errors, []);
  // Only the URL-based worker is left: an opaque origin can only start blob: workers.
  assert.deepEqual(result.issues.map((issue) => issue.code), ["sandbox-worker-url"]);
  assert.equal(result.hasScripts, true);
});

test("full access still warns about APIs its sandbox blocks", () => {
  const result = validateHtml("<!doctype html><title>Db</title><script>indexedDB.open('x')</script>", {
    fullAccess: true
  });
  assert.deepEqual(result.issues.map((issue) => issue.code), ["sandbox-indexeddb"]);
});

test("full access keeps structural limits", () => {
  const result = validateUpload([{ path: "index.html", html: page }], { maxBytes: 10, fullAccess: true });
  assert.equal(result.ok, false);
  const errors = result.issues.filter((issue) => issue.level === "error");
  assert.deepEqual(errors.map((issue) => issue.code), ["too-large"]);
});

test("the viewer carries the draft as inert data in an opaque-origin frame", () => {
  const html = renderViewer({
    html: "<!-- banner --><p>draft</p></script><script>parent.document.title = 'escaped'</script>",
    draftId: "abc123def456",
    title: '"><img src=x>',
    versionNumbers: [1, 2, 3],
    currentVersion: 2,
    draftRoot: "/d/abc123def456"
  });

  // Only the viewer's own two scripts may close; the draft's "</script>" stays escaped.
  assert.equal(html.match(/<\/script>/g).length, 2);
  // A comment opener anywhere in the shell would change where the HTML parser
  // ends its inline script.
  assert.ok(!html.includes("<!--"));
  assert.ok(!html.includes('"><img'));
  assert.ok(!FULL_ACCESS_SANDBOX.includes("allow-same-origin"));
  assert.match(html, /<a href="\/d\/abc123def456\/v\/1">1<\/a><strong>2<\/strong><a href="\/d\/abc123def456\/v\/3">3<\/a>/);
});
