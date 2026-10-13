// Node check for the peak-hour logic and markup builders in shared.js.
// Run: node test/peak.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
new Function(readFileSync(join(root, 'shared.js'), 'utf8'))();
const { isPeak, nextChange, state, rulerHTML, keyRowsHTML, fmtDur } = globalThis.OCU;

// Tue 2026-10-13 in Asia/Tokyo (UTC+9); JST h -> UTC h-9.
const tue = (h, m = 0) => Date.UTC(2026, 9, 13, h - 9, m, 0);

// 1. window boundaries
assert.equal(isPeak(tue(9, 59)), false, '09:59 must be off-peak');
assert.equal(isPeak(tue(10)), true, '10:00 must be peak');
assert.equal(isPeak(tue(12, 59)), true, '12:59 must be peak');
assert.equal(isPeak(tue(13)), false, '13:00 must be off-peak');
assert.equal(isPeak(tue(15)), true, '15:00 must be peak');
assert.equal(isPeak(tue(18, 59)), true, '18:59 must be peak');
assert.equal(isPeak(tue(19)), false, '19:00 must be off-peak');
console.log('ok  boundaries 10-13 / 15-19 JST');

// 2. weekend is always off-peak
assert.equal(isPeak(Date.UTC(2026, 9, 18, 2)), false, 'Sunday 11:00 JST must be off-peak');
assert.equal(isPeak(Date.UTC(2026, 9, 17, 6)), false, 'Saturday 15:00 JST must be off-peak');
console.log('ok  Sat/Sun off-peak');

// 3. countdown to the next change
assert.equal(fmtDur((nextChange(tue(16, 35)) - tue(16, 35)) / 1000), '2h 25m', 'peak at 16:35 ends 19:00');
assert.equal(fmtDur((nextChange(tue(9)) - tue(9)) / 1000), '1h 0m', 'off-peak at 09:00 ends 10:00');
assert.equal(fmtDur((nextChange(tue(12)) - tue(12)) / 1000), '1h 0m', 'peak at 12:00 ends 13:00');
console.log('ok  countdown to next change');

// 4. Friday evening rolls over the weekend to Monday 10:00
const fri = (h, m = 0) => Date.UTC(2026, 9, 16, h - 9, m, 0);
assert.equal(fmtDur((nextChange(fri(19, 30)) - fri(19, 30)) / 1000), '2d 14h', 'Fri 19:30 -> Mon 10:00');
console.log('ok  weekend rollover');

// 5. state() shape the chip renders from
const s = state(tue(16, 35));
assert.equal(s.on, true);
assert.equal(s.word, 'peak');
assert.equal(s.nextWord, 'off-peak');
assert.equal(s.until, '2h 25m');
console.log('ok  state()');

// 6. ruler bands land on the right hours
const ruler = rulerHTML(tue(16, 35));
assert.ok(ruler.includes('left:41.67%;width:12.50%'), 'band 10-13 at 41.67% width 12.5%');
assert.ok(ruler.includes('left:62.50%;width:16.67%'), 'band 15-19 at 62.5% width 16.67%');
assert.ok(ruler.includes('>10–13<') && ruler.includes('>15–19<'), 'band labels');
assert.ok(ruler.includes('JST · Mon–Fri'));
console.log('ok  ruler markup');

// 7. key rows: active state, meters, error fallback
const keys = [
  { id: 'a', label: 'OpenCode Go 2', quota: { usage: { windows: { '5h': { usedPercent: 7, resetAfterSeconds: 6100 }, weekly: { usedPercent: 3 } } } } },
  { id: 'b', label: 'OpenCode Go', quota: null, error: 'sign in to OpenChamber' },
];
const html = keyRowsHTML(keys, 'a');
assert.ok(html.includes('class="krow active" data-id="a"'), 'active row marked');
assert.ok(html.includes('disabled>in use</button>'), 'active key is not re-selectable');
assert.ok(html.includes('data-id="b"') && html.includes('>use</button>'), 'other key offers use');
assert.ok(html.includes('>93%</span>'), 'remaining percent, not used');
assert.ok(html.includes('sign in to OpenChamber'), 'error text passes through');
console.log('ok  key rows');

console.log('ALL PASS');
