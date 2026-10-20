// PostplanPro: full-access drafts open in a trusted shell, with the version
// switcher on top and the draft in an opaque-origin sandboxed iframe. The draft
// may load any script, call any CORS-enabled API, start workers, and submit
// forms, but cannot reach the shell, the dashboard, or Postplan cookies.
// localStorage and sessionStorage are bridged to the shell and namespaced per
// draft, so saved state survives reloads and new versions.

// What the opaque origin still rules out, reported by /api/check.
export const FULL_ACCESS_LIMITS = ["indexedDB, cookies, Cache Storage, and service workers"];

// Every sandbox capability except allow-same-origin, which would give the draft
// the shell's origin and with it the signed-in dashboard.
export const FULL_ACCESS_SANDBOX = [
  "allow-scripts",
  "allow-forms",
  "allow-modals",
  "allow-popups",
  "allow-popups-to-escape-sandbox",
  "allow-downloads",
  "allow-pointer-lock",
  "allow-presentation",
  "allow-top-navigation-by-user-activation"
].join(" ");

const FRAME_PERMISSIONS = "fullscreen; clipboard-read; clipboard-write; autoplay; picture-in-picture";

// The shell needs no CSP: it carries the draft only as escaped JSON, and the
// srcdoc frame inherits the shell's (absent) policy, leaving the draft unrestricted.
export function renderViewer({ html, draftId, title, versionNumbers, currentVersion, draftRoot }) {
  const label = escapeHtml(title || "Postplan draft");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <title>${label}</title>
  <style>
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; background: #000; }
    body { display: flex; min-height: 100dvh; flex-direction: column; overflow: hidden; }
    .postplan-versions { flex: none; display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 4px; padding: 7px 12px; background: #0d0d11; border-bottom: 1px solid #2a2a32; color: #6f7482; font: 12px/1.6 -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif; }
    .postplan-versions b { margin-right: 5px; font-size: 10px; letter-spacing: .06em; text-transform: uppercase; }
    .postplan-versions a { color: #9aa0b4; text-decoration: none; font-weight: 700; padding: 1px 7px; }
    .postplan-versions a.latest { color: #8e91ff; font-weight: 800; }
    .postplan-versions strong { background: #e8e8ee; color: #0b0b0e; font-weight: 800; padding: 1px 8px; border-radius: 999px; }
    iframe { display: block; flex: 1 1 auto; width: 100%; min-height: 0; border: 0; background: #000; }
  </style>
</head>
<body>${renderVersionHeader(versionNumbers, currentVersion, draftRoot)}<iframe id="draft" sandbox="${FULL_ACCESS_SANDBOX}" allow="${FRAME_PERMISSIONS}" title="${label}"></iframe>
<script type="application/json" id="draft-html">${scriptJson(stripVersionBlock(html))}</script>
<script>(${startViewer})(${scriptJson(draftId)}, ${scriptJson(String(storageBridge))});</script>
</body>
</html>`;
}

// Runs in the shell: hands the draft its saved storage, then persists changes.
function startViewer(draftId, bridgeSource) {
  const frame = document.getElementById("draft");
  const key = `postplan:${draftId}`;
  const stores = {};
  const saved = {};
  for (const area of ["local", "session"]) {
    saved[area] = {};
    try {
      stores[area] = window[`${area}Storage`];
      saved[area] = JSON.parse(stores[area].getItem(key)) || {};
    } catch {
      // Storage is blocked or the saved copy is unreadable; start empty.
    }
  }

  addEventListener("message", (event) => {
    const { area, entries } = event.data?.postplanStorage || {};
    if (event.source !== frame.contentWindow || !Object.hasOwn(stores, area)) return;
    try {
      stores[area].setItem(key, JSON.stringify(entries));
    } catch {
      // Over quota: the draft keeps its in-memory copy for this visit.
    }
  });

  const html = JSON.parse(document.getElementById("draft-html").textContent);
  const state = JSON.stringify(saved).replace(/</g, "\\u003c");
  frame.srcdoc = `<script>(${bridgeSource})(${state})<\/script>${html}`;
  // Dark while loading so dark drafts never flash, then white behind drafts
  // that set no background, as in a normal tab.
  frame.addEventListener("load", () => (frame.style.background = "#fff"), { once: true });
}

// Runs first in the draft. The opaque origin has no storage, so this installs
// in-memory copies that report every change to the shell. Preceding the
// draft's doctype is harmless: srcdoc documents never enter quirks mode.
function storageBridge(saved) {
  for (const area of ["local", "session"]) {
    const data = new Map(Object.entries(saved[area] || {}));
    const save = () =>
      parent.postMessage({ postplanStorage: { area, entries: Object.fromEntries(data) } }, "*");
    const storage = {
      get length() {
        return data.size;
      },
      key: (index) => [...data.keys()][index] ?? null,
      getItem: (key) => data.get(String(key)) ?? null,
      setItem(key, value) {
        data.set(String(key), String(value));
        save();
      },
      removeItem(key) {
        if (data.delete(String(key))) save();
      },
      clear() {
        data.clear();
        save();
      }
    };
    Object.defineProperty(window, `${area}Storage`, { value: storage, configurable: true, enumerable: true });
  }
}

function renderVersionHeader(numbers, current, draftRoot) {
  if (numbers.length < 2) return "";
  const root = escapeHtml(draftRoot);
  const parts = numbers.map((number) =>
    number === current ? `<strong>${number}</strong>` : `<a href="${root}/v/${number}">${number}</a>`
  );
  parts.push(`<a class="latest" href="${root || "/"}">Nyeste →</a>`);
  return `<nav class="postplan-versions" aria-label="Draft versions"><b>Versjon</b>${parts.join("")}</nav>`;
}

// Older drafts were published with a static version block; the header above replaces it.
function stripVersionBlock(html) {
  const startMarker = "<!-- postplan-versions:start -->";
  const endMarker = "<!-- postplan-versions:end -->";
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker);
  return start !== -1 && end > start ? html.slice(0, start) + html.slice(end + endMarker.length) : html;
}

// JSON that is safe inside a <script> element: no "<" can close it.
function scriptJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
