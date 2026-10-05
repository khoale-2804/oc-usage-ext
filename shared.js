'use strict';
/*
 * Shared by the page overlay (content.js) and the toolbar popup (popup.js):
 * formatting, peak-hour logic, and markup builders. Markup uses the classes
 * `.grid .bar .lbl .val .muted .row .dot`; each host supplies the CSS (shadow
 * DOM in the page, popup.css in the popup).
 */
globalThis.OCU = (() => {
  const fmtTokens = (n) => {
    if (!Number.isFinite(n)) return '-';
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'G';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return String(Math.round(n));
  };
  const fmtMoney = (n) => {
    if (!Number.isFinite(n)) return '-';
    if (n === 0) return '$0';
    return '$' + (n < 0.01 ? n.toFixed(4) : n.toFixed(3));
  };
  const fmtDur = (sec) => {
    if (!Number.isFinite(sec) || sec <= 0) return 'now';
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (d) return d + 'd ' + h + 'h';
    if (h) return h + 'h ' + m + 'm';
    if (m) return m + 'm ' + s + 's';
    return s + 's';
  };

  // peak = 10:00-13:00 & 15:00-19:00 Asia/Tokyo, Mon-Fri (deepseek_peak_toggle.sh)
  const PEAKS = [
    { id: 'deepseek', name: 'DeepSeek', tz: 'Asia/Tokyo', weekdays: [1, 2, 3, 4, 5], windows: [[10, 13], [15, 19]] },
  ];
  const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const partsIn = (ms, tz) => {
    const f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const o = {};
    for (const p of f.formatToParts(ms)) o[p.type] = p.value;
    return { wd: WD[o.weekday], h: (+o.hour) % 24, m: +o.minute };
  };
  const isPeak = (peak, ms) => {
    const p = partsIn(ms, peak.tz);
    if (!peak.weekdays.includes(p.wd)) return false;
    return peak.windows.some(([a, b]) => p.h >= a && p.h < b);
  };
  const nextChange = (peak, nowMs) => {
    const cur = isPeak(peak, nowMs);
    for (let i = 1; i <= 8 * 24 * 60; i++) {
      const t = nowMs + i * 60000;
      if (isPeak(peak, t) !== cur) return t;
    }
    return null;
  };

  const cacheHit = (r) => {
    const denom = r.input + r.cacheRead + r.cacheWrite;
    return denom ? Math.round((r.cacheRead / denom) * 100) : null;
  };

  const peakRowsHTML = (nowMs) => PEAKS.map((p) => {
    const on = isPeak(p, nowMs);
    const nc = nextChange(p, nowMs);
    const dur = nc ? fmtDur((nc - nowMs) / 1000) : '';
    return '<div class="row" style="padding:0">'
      + '<span class="dot ' + (on ? 'on' : 'off') + '"></span>'
      + '<span style="flex:1">' + p.name + ' <span class="muted">' + (on ? 'peak' : 'off-peak') + '</span></span>'
      + '<span class="val muted">' + (dur ? dur + ' &rarr; ' + (on ? 'off-peak' : 'peak') : '-') + '</span>'
      + '</div>';
  }).join('');

  const WINDOW_LABEL = { '5h': '5h', weekly: 'Week', monthly: 'Month' };
  const quotaWindowsHTML = (quota) => {
    if (!quota) return '<span class="muted">usage...</span>';
    if (!quota.ok) {
      if (quota.locked) return '<span class="muted">OpenCode Go: locked</span>';
      if (quota.configured === false) {
        return '<span class="muted">OpenCode Go: no key</span>';
      }
      return '<span class="muted">OpenCode Go: ' + (quota.error ? String(quota.error) : 'unavailable') + '</span>';
    }
    const w = (quota.usage && quota.usage.windows) || {};
    const elapsed = (Date.now() - (quota.fetchedAt || Date.now())) / 1000;
    const rows = ['5h', 'weekly', 'monthly'].filter((k) => w[k]).map((k, i) => {
      const x = w[k];
      const used = Math.min(100, Math.max(0, Math.round(x.usedPercent || 0)));
      const left = Number.isFinite(x.resetAfterSeconds) ? Math.max(0, x.resetAfterSeconds - elapsed) : NaN;
      const reset = Number.isFinite(left) ? ' &middot; ' + fmtDur(left) : '';
      return '<div class="grid" style="margin-top:' + (i ? '4px' : '0') + '">'
        + '<span class="lbl muted">' + (WINDOW_LABEL[k] || k) + '</span>'
        + '<span class="bar"><i style="width:' + used + '%"></i></span>'
        + '<span class="val muted" title="used ' + used + '%; resets ' + (x.resetAtFormatted || '') + '">'
        + (100 - used) + '%' + reset + '</span>'
        + '</div>';
    });
    return rows.join('') || '<span class="muted">no windows</span>';
  };

  return { fmtTokens, fmtMoney, fmtDur, PEAKS, isPeak, nextChange, cacheHit, peakRowsHTML, quotaWindowsHTML };
})();
