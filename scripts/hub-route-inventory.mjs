// scripts/hub-route-inventory.mjs
// Boots the hub router and walks the RUNTIME Express stack (not source regex —
// several route defs span multiple lines). Emits one stable line per route:
//   "<PUB|AUTH> <METHOD> <path>"  sorted, so it can be diffed across refactors.
//
// NOTE: importing hub.js transitively loads server/loadEnv.js, which prints a
// "[gcloud-auth]" diagnostic to stdout at import time. We silence stdout-bound
// console output (log/info) during the dynamic import so the baseline contains
// ONLY route lines and stays clean/diffable. console.warn (stderr) and
// console.error are left intact so real import-time problems still surface.
// No source files are touched.

const origLog = console.log;
const origInfo = console.info;
console.log = () => {};
console.info = () => {};
let hubRouter;
try {
  ({ default: hubRouter } = await import('../server/routes/hub.js'));
} finally {
  console.log = origLog;
  console.info = origInfo;
}

const out = [];

function isRequireAuth(layer) {
  // router.use(requireAuth) appears as a middleware layer named 'requireAuth'.
  return layer && !layer.route && typeof layer.handle === 'function'
    && (layer.handle.name === 'requireAuth' || layer.name === 'requireAuth');
}

// `gated` is threaded through the recursion (not module-global): the top-level
// router.use(requireAuth) flips it for the router's own subsequent siblings,
// while a recursed sub-router only inherits the current value and cannot leak a
// gate change back to its parent's siblings.
function walk(stack, gated) {
  for (const layer of stack) {
    if (isRequireAuth(layer)) { gated = true; continue; }
    if (layer.route) {
      const p = layer.route.path;
      const methods = Object.keys(layer.route.methods)
        .filter((m) => layer.route.methods[m]);
      for (const m of methods) {
        out.push(`${gated ? 'AUTH' : 'PUB '} ${m.toUpperCase().padEnd(6)} ${p}`);
      }
    } else if (layer.handle && Array.isArray(layer.handle.stack)) {
      // mounted sub-router (express.Router) — recurse, inheriting gate state
      walk(layer.handle.stack, gated);
    }
  }
}

walk(hubRouter.stack, false);
out.sort();
process.stdout.write(out.join('\n') + '\n');
process.stderr.write(`TOTAL ROUTES: ${out.length}\n`);
