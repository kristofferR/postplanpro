export function renderHome({ publicBaseUrl }) {
  return htmlPage({
    title: "Postplan",
    body: `
      <main class="home">
        <h1>Postplan</h1>
        <p>Authenticated static HTML draft publishing for agents.</p>
        <pre>npx postplan upload ./plan.html</pre>
        <p><a href="/dashboard">My drafts</a> · <a href="/cli/auth">CLI setup</a></p>
        <p>Health: <a href="/healthz">/healthz</a></p>
        <p>Public base URL: ${escapeHtml(publicBaseUrl || "not configured")}</p>
      </main>
    `
  });
}

export function renderNotFound() {
  return htmlPage({
    title: "Draft not found",
    body: `
      <main class="home">
        <h1>Draft not found</h1>
        <p>The requested draft is unavailable.</p>
      </main>
    `
  });
}

function htmlPage({ title, body }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="alternate icon" href="/favicon.png" type="image/png">
  <title>${escapeHtml(title)}</title>
  <meta name="color-scheme" content="dark">
  <style>
    body {
      margin: 0;
      background: #000;
      color: #fff;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      -webkit-font-smoothing: antialiased;
    }

    .home {
      max-width: 760px;
      margin: 64px auto;
      padding: 0 20px;
    }

    h1 {
      margin: 0 0 12px;
      font-size: 40px;
      line-height: 1.1;
      letter-spacing: -0.02em;
    }

    p {
      color: #a3a3a3;
      font-size: 17px;
      line-height: 1.6;
    }

    a {
      color: #8ab4ff;
      text-decoration: none;
    }

    a:hover {
      text-decoration: underline;
    }

    pre {
      overflow-x: auto;
      padding: 14px;
      border: 1px solid #262626;
      background: #0b0b0b;
      border-radius: 6px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
  </style>
</head>
<body>${body}</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
