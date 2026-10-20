// PostplanPro: full-access drafts open in a trusted shell, with the version
// switcher on top and the draft in an opaque-origin sandboxed iframe. The draft
// may load any script, call any CORS-enabled API, start workers, and submit
// forms, but cannot reach the shell, the dashboard, or Postplan cookies.
// localStorage and sessionStorage are bridged to the shell and namespaced per
// draft, so saved state survives reloads and new versions.

// What the opaque origin still rules out, reported by /api/check.
export const FULL_ACCESS_LIMITS = [
  "indexedDB, cookies, Cache Storage, and service workers",
  "camera, microphone, geolocation, and other permission-gated APIs",
  "localStorage and sessionStorage in multi-page drafts, which skip the viewer"
];

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
    .postplan-versions { flex: none; display: flex; flex-wrap: nowrap; white-space: nowrap; overflow-x: auto; scrollbar-width: thin; align-items: center; justify-content: safe center; gap: 4px; padding: 7px 12px; background: #0d0d11; border-bottom: 1px solid #2a2a32; color: #6f7482; font: 12px/1.6 -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif; }
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

// Runs in the shell: hands the draft its saved storage, then applies each
// change the draft reports.
function startViewer(draftId, bridgeSource) {
  const frame = document.getElementById("draft");
  const storageKey = `postplan:${draftId}`;
  // Only the bridge injected below knows this token. A page the frame later
  // navigates to shares its WindowProxy, so the source check alone is not enough.
  const token = Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) => n.toString(36)).join("");
  const stores = {};
  for (const area of ["local", "session"]) {
    try {
      stores[area] = window[`${area}Storage`];
    } catch {
      // Storage is blocked; the draft keeps in-memory storage for this visit.
    }
  }
  // Read fresh for every change, so writes from other tabs of the draft survive.
  const read = (area) => {
    try {
      return JSON.parse(stores[area].getItem(storageKey)) || {};
    } catch {
      return {};
    }
  };

  addEventListener("message", (event) => {
    const change = event.data?.postplanStorage;
    if (event.source !== frame.contentWindow || change?.token !== token || !Object.hasOwn(stores, change.area)) return;
    const entries = new Map(Object.entries(read(change.area)));
    if (change.op === "clear") entries.clear();
    else if (change.op === "remove") entries.delete(String(change.key));
    else entries.set(String(change.key), String(change.value));
    try {
      stores[change.area].setItem(storageKey, JSON.stringify(Object.fromEntries(entries)));
    } catch {
      // Over quota: the draft keeps its in-memory copy for this visit.
    }
  });

  const html = JSON.parse(document.getElementById("draft-html").textContent);

  // Drafts opened before this viewer ran on the shell's own origin, so their
  // saved keys sit unprefixed in its localStorage. Once per draft, copy in the
  // ones its source names, keeping any newer value saved through the bridge.
  const migratedKey = `postplan-legacy:${draftId}`;
  try {
    if (stores.local && !stores.local.getItem(migratedKey)) {
      const entries = new Map(Object.entries(read("local")));
      const size = entries.size;
      for (let index = 0; index < stores.local.length; index++) {
        const key = stores.local.key(index);
        const own = key.startsWith("postplan:") || key.startsWith("postplan-legacy:");
        if (key && !own && !entries.has(key) && html.includes(key)) entries.set(key, stores.local.getItem(key));
      }
      if (entries.size > size) stores.local.setItem(storageKey, JSON.stringify(Object.fromEntries(entries)));
      stores.local.setItem(migratedKey, "1");
    }
  } catch {
    // Over quota or blocked: the draft starts from what the bridge saved.
  }

  const state = JSON.stringify({ local: read("local"), session: read("session"), token }).replace(/</g, "\\u003c");
  // Keep leading comments and the doctype ahead of the bridge. Comment
  // delimiters are written with \x3c and \x3e: literally, inside this inline
  // script, they would change how the HTML parser finds its closing tag.
  let at = 0;
  for (;;) {
    while (/\s/.test(html[at] ?? "")) at++;
    const end = html.startsWith("\x3c!--", at) ? html.indexOf("--\x3e", at + 4) : -1;
    if (end === -1) break;
    at = end + 3;
  }
  const doctype = /\x3c!doctype[^>]*>/iy;
  doctype.lastIndex = at;
  const prolog = doctype.test(html) ? html.slice(0, doctype.lastIndex) : "";
  frame.srcdoc = `${prolog}<script>(${bridgeSource})(${state})<\/script>${html.slice(prolog.length)}`;
  document.querySelector(".postplan-versions strong")?.scrollIntoView({ block: "nearest", inline: "center" });
  // Dark while loading so dark drafts never flash, then white behind drafts
  // that set no background, as in a normal tab.
  frame.addEventListener("load", () => (frame.style.background = "#fff"), { once: true });
}

// Runs first in the draft. The opaque origin has no storage, so this installs
// in-memory Storage objects that report each change to the shell. The state
// also rides in window.name, which survives a reload inside the frame, where
// srcdoc would restart from the snapshot taken when the shell loaded.
function storageBridge(saved) {
  const prefix = "postplan-storage:";
  const { token } = saved;
  let state = saved;
  try {
    if (window.name.startsWith(prefix)) state = JSON.parse(window.name.slice(prefix.length));
  } catch {
    // Unreadable: start from the shell's snapshot.
  }
  // window.name outlives the document, so drop it before leaving for another
  // page that could read it. Without the Navigation API it stays set.
  window.navigation?.addEventListener("navigate", (event) => {
    if (event.navigationType !== "reload" && !event.destination.sameDocument) window.name = "";
  });

  // A srcdoc document resolves links against the shell's URL, so a plain link
  // to it would load a second viewer inside this frame. Keep in-page anchors
  // here and send other links on the shell's origin to the top window.
  addEventListener("click", (event) => {
    const link = event.target.closest?.("a[href]");
    const plain = event.button === 0 && !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);
    if (!(link instanceof HTMLAnchorElement) || !plain || event.defaultPrevented) return;
    if (link.target && link.target !== "_self") return;
    const url = new URL(link.href);
    const base = new URL(document.baseURI);
    if (url.origin !== base.origin) return;
    if (url.hash && url.pathname === base.pathname && url.search === base.search) {
      event.preventDefault();
      location.hash = url.hash;
    } else {
      link.target = "_top";
    }
  });

  const areas = {};
  const record = (area, change) => {
    const all = { local: Object.fromEntries(areas.local), session: Object.fromEntries(areas.session) };
    window.name = prefix + JSON.stringify(all);
    parent.postMessage({ postplanStorage: { area, token, ...change } }, "*");
  };
  for (const area of ["local", "session"]) {
    const data = (areas[area] = new Map(Object.entries(state[area] || {})));
    const methods = {
      key: (index) => [...data.keys()][index] ?? null,
      getItem: (key) => data.get(String(key)) ?? null,
      setItem(key, value) {
        data.set(String(key), String(value));
        record(area, { op: "set", key: String(key), value: String(value) });
      },
      removeItem(key) {
        if (data.delete(String(key))) record(area, { op: "remove", key: String(key) });
      },
      clear() {
        data.clear();
        record(area, { op: "clear" });
      }
    };
    // Named properties (localStorage.theme = "dark") act on entries, as on real Storage.
    const storage = new Proxy(methods, {
      get: (target, key) => (key === "length" ? data.size : key in target ? target[key] : data.get(key)),
      set: (target, key, value) => (methods.setItem(key, value), true),
      deleteProperty: (target, key) => (methods.removeItem(key), true),
      has: (target, key) => key in target || data.has(key),
      ownKeys: () => [...data.keys()],
      getOwnPropertyDescriptor: (target, key) =>
        data.has(key) ? { value: data.get(key), writable: true, enumerable: true, configurable: true } : undefined
    });
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
