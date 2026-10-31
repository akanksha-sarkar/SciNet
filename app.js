// Shell: hash router + nav + theme, for ONE domain fixed per page. Views get
// render(root, params) where params is a plain object parsed from the hash
// query (#/view?a=1&b=2).
import { loadDomains, setDomain } from "./data.js";

const ROUTES = [
  { id: "overview", label: "Overview", mod: () => import("./views/overview.js") },
  { id: "graph", label: "Graph", mod: () => import("./views/graph.js") },
  { id: "matrix", label: "Matrix", mod: () => import("./views/matrix.js") },
  { id: "plots", label: "Plots", mod: () => import("./views/plots.js") },
  { id: "claims", label: "Claims", mod: () => import("./views/claims.js") },
  { id: "lenses", label: "Lenses", mod: () => import("./views/lenses.js") },
  { id: "hypotheses", label: "Hypotheses", mod: () => import("./views/hypotheses.js") },
  { id: "failure-modes", label: "Failure modes", mod: () => import("./views/failure-modes.js") },
  { id: "opportunities", label: "Opportunities", mod: () => import("./views/opportunities.js") },
  { id: "shifts", label: "Shifts", mod: () => import("./views/shifts.js") },
  { id: "audit", label: "Audit", mod: () => import("./views/audit.js") },
];

const nav = document.getElementById("nav");
const view = document.getElementById("view");

for (const r of ROUTES) {
  const a = document.createElement("a");
  a.href = `#/${r.id}`;
  a.textContent = r.label;
  a.dataset.id = r.id;
  nav.appendChild(a);
}

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, query = ""] = raw.split("?");
  const id = (path || "overview").split("/")[0];
  const params = {};
  for (const [k, v] of new URLSearchParams(query)) params[k] = v;
  return { route: ROUTES.find((r) => r.id === id) || ROUTES[0], params };
}

let token = 0;
async function route() {
  const { route: r, params } = parseHash();
  const mine = ++token;
  for (const a of nav.querySelectorAll("a"))
    a.classList.toggle("active", a.dataset.id === r.id);
  // Full-bleed views own their own scrolling (a canvas beside an inspector).
  view.className = ["graph", "matrix", "plots"].includes(r.id) ? "view full" : "view";
  view.innerHTML = `<div class="empty">Loading ${r.label}…</div>`;
  try {
    const mod = await r.mod();
    if (mine !== token) return; // a newer navigation superseded this one
    view.innerHTML = "";
    await mod.render(view, params);
  } catch (e) {
    if (mine !== token) return;
    view.innerHTML = `<div class="empty">Failed to load ${r.label}.<br><span class="mono">${e.message}</span></div>`;
    console.error(e);
  }
}

// Theme toggle (persisted, best-effort).
const root = document.documentElement;
try {
  const saved = localStorage.getItem("skb-theme");
  if (saved) root.dataset.theme = saved;
} catch {}
document.getElementById("theme-toggle").addEventListener("click", () => {
  const next = root.dataset.theme === "light" ? "dark" : "light";
  root.dataset.theme = next;
  try {
    localStorage.setItem("skb-theme", next);
  } catch {}
  window.dispatchEvent(new CustomEvent("themechange"));
});

// The domain is FIXED per page: each dashboard page declares it on
// <html data-domain="…">. The landing page lists domains and does not load
// this engine. Brand text + browser title come from the domain's entry in
// domains.json; the brand links back to the landing page (../).
const DOMAIN = document.documentElement.dataset.domain;

async function initDomain() {
  if (!DOMAIN) throw new Error("this page has no data-domain on <html>");
  setDomain(DOMAIN); // set first, so views still load if domains.json is missing
  const domains = await loadDomains().catch(() => []);
  const d = domains.find((x) => x.name === DOMAIN);
  const label = (d && (d.title || d.name)) || DOMAIN;
  const brand = document.getElementById("brand-name");
  if (brand) brand.textContent = label;
  document.title = `${label} · SciNet`;
}

window.addEventListener("hashchange", route);
initDomain()
  .catch((e) => console.error("failed to init domain", e))
  .then(route);
