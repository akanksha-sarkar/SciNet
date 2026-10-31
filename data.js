// Fetch + cache the static JSON bundle. The frontend reads ONLY these files.
// Data is keyed by domain (data/<domain>/*.json); setDomain() selects which one
// load() reads from and clears the cache on change.
//
// Data URLs are resolved against THIS module's URL (import.meta.url), not the
// document — so the engine keeps resolving data/ correctly regardless of the
// page that loads it or how deep in the tree that page sits.
const dataURL = (rel) => new URL(`data/${rel}`, import.meta.url);
const cache = new Map();
let domain = null;

export function setDomain(name) {
  if (name === domain) return;
  domain = name;
  cache.clear();
}

export const getDomain = () => domain;

export async function load(name) {
  const key = `${domain}/${name}`;
  if (!cache.has(key)) {
    cache.set(
      key,
      fetch(dataURL(`${domain}/${name}.json`)).then((r) => {
        if (!r.ok)
          throw new Error(`failed to load ${domain}/${name}.json (${r.status})`);
        return r.json();
      }),
    );
  }
  return cache.get(key);
}

// The landing page and each domain page read this once: [{"name","title"}, ...].
export async function loadDomains() {
  const r = await fetch(dataURL("domains.json"));
  if (!r.ok) throw new Error(`failed to load domains.json (${r.status})`);
  return r.json();
}

export const fmt = (n) =>
  typeof n === "number" ? n.toLocaleString("en-US") : n ?? "—";

// Stable color per node/entity type — used by graph, legend, overview.
// Domain-general: the type set is not known ahead of time, so a type's color
// is derived by hashing its name into a fixed palette. Same type → same color
// across every view and every domain, with no per-domain configuration.
const UNTYPED_COLOR = "#525a68";
export const TYPE_PALETTE = [
  "#5b8cff", "#37d9a0", "#f5a623", "#c17bff", "#ff7ab6", "#4bd0e6",
  "#e2c541", "#ff8a5b", "#7fd15b", "#e05b7a", "#b08968", "#2a78d6",
  "#0ca30c", "#a05cc8", "#26a69a", "#8d6e63",
];
const hashStr = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
};
export const typeColor = (t) =>
  !t || t === "untyped"
    ? UNTYPED_COLOR
    : TYPE_PALETTE[hashStr(t) % TYPE_PALETTE.length];

// Distinct-by-default color function for a KNOWN set of types: assigns palette
// colors by sorted position so no two types collide until the palette (16) is
// exhausted. Order-independent — every view that passes the same type set gets
// the same colors. Past 16 types it falls back to the hash-based typeColor.
export function makeTypeColor(types) {
  const sorted = [...new Set(types)]
    .filter((t) => t && t !== "untyped")
    .sort();
  const map = new Map();
  sorted.forEach((t, i) => {
    if (i < TYPE_PALETTE.length) map.set(t, TYPE_PALETTE[i]);
  });
  return (t) =>
    !t || t === "untyped" ? UNTYPED_COLOR : map.get(t) || typeColor(t);
}
