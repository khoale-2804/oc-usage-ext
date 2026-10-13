'use strict';
/*
 * Shared by the page overlay (content.js) and the offline harness
 * (test/harness.html): DeepSeek peak-hour logic and the markup builders.
 * Markup uses `.ruler .track .band .now .krow .kname .use .meters .m .bar`
 * plus `.row .sec .dot .muted .val`; each host supplies the CSS.
 */
globalThis.OCU = (() => {
  const fmtDur = (sec) => {
    if (!Number.isFinite(sec) || sec <= 0) return 'now';
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (d) return d + 'd ' + h + 'h';
    if (h) return h + 'h ' + m + 'm';
    if (m) return m + 'm ' + (s < 10 ? '0' : '') + s + 's';
    return s + 's';
  };

  // peak = 10:00-13:00 & 15:00-19:00 Asia/Tokyo, Mon-Fri (deepseek_peak_toggle.sh)
  const TZ = 'Asia/Tokyo';
  const WEEKDAYS = [1, 2, 3, 4, 5];
  const WINDOWS = [[10, 13], [15, 19]];
  const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  const partsIn = (ms) => {
    const f = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const o = {};
    for (const p of f.formatToParts(ms)) o[p.type] = p.value;
    return { wd: WD[o.weekday], h: (+o.hour) % 24, m: +o.minute };
  };

  const isPeak = (ms) => {
    const p = partsIn(ms);
    if (!WEEKDAYS.includes(p.wd)) return false;
    return WINDOWS.some(([a, b]) => p.h >= a && p.h < b);
  };

  const nextChange = (ms) => {
    const cur = isPeak(ms);
    for (let i = 1; i <= 8 * 24 * 60; i++) {
      const t = ms + i * 60000;
      if (isPeak(t) !== cur) return t;
    }
    return null;
  };

  // { on, untilMs, until, inMinutes } — everything the chip needs to render.
  const state = (ms) => {
    const on = isPeak(ms);
    const at = nextChange(ms);
    const p = partsIn(ms);
    return {
      on,
      word: on ? 'peak' : 'off-peak',
      nextWord: on ? 'off-peak' : 'peak',
      at,
      until: at ? fmtDur((at - ms) / 1000) : '',
      minuteOfDay: p.h * 60 + p.m,
      tzLocal: p,
    };
  };

  const pct = (v) => Math.min(100, Math.max(0, Math.round(v || 0)));
  const hourPct = (h) => (h / 24) * 100;

  // 24h JST ruler: the two peak bands plus a "now" tick.
  const rulerHTML = (ms) => {
    const m = state(ms);
    const bands = WINDOWS.map(([a, b]) =>
      '<span class="band" style="left:' + hourPct(a).toFixed(2) + '%;width:' +
      (hourPct(b) - hourPct(a)).toFixed(2) + '%"></span>').join('');
    const marks = WINDOWS.map(([a, b]) =>
      '<span class="mark" style="left:' + hourPct(a).toFixed(2) + '%">' + a + '–' + b + '</span>').join('');
    return '<div class="ruler">'
      + '<div class="track">' + bands
      + '<span class="now" style="left:' + hourPct(m.minuteOfDay / 60).toFixed(2) + '%"></span></div>'
      + '<div class="marks">' + marks + '</div>'
      + '<div class="sub">JST · Mon–Fri</div>'
      + '</div>';
  };

  const WINDOW_LABEL = { '5h': '5h', weekly: 'Week', monthly: 'Month' };
  const meterHTML = (label, w) => {
    if (!w) return '';
    const used = pct(w.usedPercent);
    const left = 100 - used;
    const reset = Number.isFinite(w.resetAfterSeconds) ? fmtDur(w.resetAfterSeconds) : '';
    const title = 'used ' + used + '%' + (reset ? ', resets in ' + reset : '');
    return '<span class="m" title="' + title + '"><span class="mlbl">' + label + '</span>'
      + '<span class="bar"><i class="' + (left <= 10 ? 'low' : left <= 35 ? 'mid' : 'ok')
      + '" style="width:' + left + '%"></i></span>'
      + '<span class="val">' + left + '%</span></span>';
  };

  // keys: [{ id, label, quota|null, error|null }], activeId: string|null
  const keyRowsHTML = (keys, activeId) => {
    if (!keys || !keys.length) return '<span class="muted">no Go keys</span>';
    return keys.map((k) => {
      const active = k.id === activeId;
      const w = (k.quota && k.quota.usage && k.quota.usage.windows) || null;
      const body = k.error
        ? '<div class="kbody muted">' + k.error + '</div>'
        : w
          ? '<div class="meters">'
            + meterHTML(WINDOW_LABEL['5h'], w['5h'])
            + meterHTML(WINDOW_LABEL.weekly, w.weekly)
            + meterHTML(WINDOW_LABEL.monthly, w.monthly)
            + '</div>'
          : '<div class="kbody muted">reading…</div>';
      return '<div class="krow' + (active ? ' active' : '') + '" data-id="' + k.id + '">'
        + '<div class="khead"><span class="dot ' + (active ? 'live' : 'idle') + '"></span>'
        + '<span class="kname">' + k.label + '</span>'
        + '<button class="use' + (active ? ' is-active' : '') + '" type="button" data-id="' + k.id + '"'
        + (active ? ' disabled' : '') + '>' + (active ? 'in use' : 'use') + '</button></div>'
        + body
        + '</div>';
    }).join('');
  };

  return { fmtDur, isPeak, nextChange, state, rulerHTML, keyRowsHTML, TZ, WINDOWS, WEEKDAYS };
})();
