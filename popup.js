'use strict';
/* Toolbar popup: quota + peak timer without OpenChamber (API-key mode). */
(() => {
  const { quotaWindowsHTML, peakRowsHTML } = OCU;
  const $ = (id) => document.getElementById(id);

  const renderPeaks = () => { $('peaks').innerHTML = peakRowsHTML(Date.now()); };

  async function loadQuota() {
    let quota = null;
    try { quota = await chrome.runtime.sendMessage({ type: 'ocu:quota' }); }
    catch { quota = { ok: false, configured: true, error: 'worker unavailable' }; }
    $('quota').innerHTML = quotaWindowsHTML(quota);
    $('setup').style.display = !quota || quota.configured === false ? '' : 'none';
  }

  const openSettings = () => chrome.runtime.openOptionsPage();
  $('settings').addEventListener('click', openSettings);
  $('setup-btn').addEventListener('click', openSettings);
  $('session').textContent = 'Per-turn cost & cache are shown on the OpenChamber page.';

  renderPeaks();
  loadQuota();
  setInterval(renderPeaks, 1000);
  setInterval(loadQuota, 60000);
})();
