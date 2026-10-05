'use strict';
/* Toolbar popup: quota + peak timer without OpenChamber (API-key vault). */
(() => {
  const { quotaWindowsHTML, peakRowsHTML } = OCU;
  const $ = (id) => document.getElementById(id);

  const renderPeaks = () => { $('peaks').innerHTML = peakRowsHTML(Date.now()); };

  function showAction(quota) {
    const el = $('action');
    if (quota && quota.ok) { el.style.display = 'none'; return; }
    if (quota && quota.locked) {
      $('action-btn').textContent = 'Unlock vault';
      $('action-hint').textContent = 'Enter your passphrase in Settings.';
    } else if (quota && quota.configured === false) {
      $('action-btn').textContent = 'Add OpenCode Go API key';
      $('action-hint').textContent = 'Stored encrypted; unlocked per session.';
    } else {
      el.style.display = 'none';
      return;
    }
    el.style.display = '';
  }

  async function loadQuota() {
    let quota = null;
    try { quota = await chrome.runtime.sendMessage({ type: 'ocu:quota' }); }
    catch { quota = { ok: false, configured: true, error: 'worker unavailable' }; }
    $('quota').innerHTML = quotaWindowsHTML(quota);
    showAction(quota);
  }

  const openSettings = () => chrome.runtime.openOptionsPage();
  $('settings').addEventListener('click', openSettings);
  $('action-btn').addEventListener('click', openSettings);
  $('session').textContent = 'Per-turn cost & cache are shown on the OpenChamber page.';

  renderPeaks();
  loadQuota();
  setInterval(renderPeaks, 1000);
  setInterval(loadQuota, 60000);
})();
