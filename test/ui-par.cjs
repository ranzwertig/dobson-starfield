// Runs the UI tests (test/ui.cjs) in parallel shards, each its own process with its own server and browser: most of
// the time goes into waiting for the app (animations, timers), so a few shards at once finish much sooner than one.
// The machine is shared by the shards, so a test that waits a fixed time can miss under load: tests that fail are run
// once more on their own afterwards, and only a failure there counts (the retried ones are named).
//   node test/ui-par.cjs [test names …]     UI_JOBS=n sets the number of shards (default 3)
const { spawn } = require('node:child_process');
const path = require('node:path');
const n = Math.max(1, +process.env.UI_JOBS || 3), names = process.argv.slice(2), t0 = Date.now();
const run = args => new Promise(res => {
  const p = spawn(process.execPath, [path.join(__dirname, 'ui.cjs'), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
  p.on('close', code => res({ code, out }));
});
// checks per test ("  12/12 passed (3.1 s)" after "• name")
function perTest(out) {
  const m = new Map(); let test = null;
  out.split('\n').forEach(l => { if (l.startsWith('• ')) test = l.slice(2).trim(); else { const x = /^\s+(\d+)\/(\d+) passed/.exec(l); if (x && test) m.set(test, +x[2]); } });
  return m;
}
// the failed checks of a run, each with its test
function failures(out) {
  const lines = out.split('\n'), bad = [];
  let test = null;
  lines.forEach(l => { if (l.startsWith('• ')) test = l.slice(2).trim(); else if (/✗/.test(l)) bad.push({ test, line: l }); });
  return bad;
}
(async () => {
  const rs = await Promise.all(Array.from({ length: n }, (_, k) => run(['--shard=' + (k + 1) + '/' + n, ...names])));
  const checks = new Map();
  const failed = [];
  rs.forEach((r, k) => {
    perTest(r.out).forEach((v, t) => checks.set(t, v));
    const bad = failures(r.out);
    if (r.code && !bad.length) { console.log('shard ' + (k + 1) + ' broke off:\n' + r.out.slice(-2000)); failed.push({ test: null }); }
    failed.push(...bad);
  });
  const again = [...new Set(failed.map(f => f.test).filter(Boolean))];
  let ok = !failed.some(f => !f.test), still = [];
  if (again.length) {
    const r = await run(again);
    perTest(r.out).forEach((v, t) => checks.set(t, v));   // a test that broke off early ran fewer checks
    still = failures(r.out);
    if (r.code && !still.length) { ok = false; console.log('retry broke off:\n' + r.out.slice(-2000)); }
    still.forEach(f => console.log('✗ ' + f.test + ': ' + f.line.trim()));
    const flaky = again.filter(t => !still.some(f => f.test === t));
    if (flaky.length) console.log('passed when run again on their own (timing under load): ' + flaky.join(', '));
  }
  ok = ok && !still.length;
  const total = [...checks.values()].reduce((a, b) => a + b, 0);
  console.log((ok ? `All ${total} checks passed` : `${still.length} of ${total} checks failed`) + ` (${n} shards, ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  process.exit(ok ? 0 : 1);
})();
