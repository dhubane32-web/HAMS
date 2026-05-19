import { getConfig } from '../config/index.js';
import { logError, logInfo, redactString } from '../lib/safeLog.js';

/**
 * Send operational alerts (backup failure, health degradation) to webhook when configured.
 */
function alertWebhookUrl() {
  const cfg = getConfig();
  return cfg.alerts?.webhook || '';
}

export async function sendOperationalAlert({ severity = 'warning', title, message, context = {} }) {
  const url = alertWebhookUrl();
  const payload = {
    severity,
    title: redactString(title),
    message: redactString(message),
    service: 'HAMS backend',
    timestamp: new Date().toISOString(),
    context
  };

  logInfo(`[alert] ${severity}: ${title}`, { message: payload.message });

  if (!url) return { delivered: false, reason: 'no_webhook' };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000)
    });
    if (!res.ok) {
      logError('[alert] webhook failed', new Error(`HTTP ${res.status}`));
      return { delivered: false, reason: `http_${res.status}` };
    }
    return { delivered: true };
  } catch (err) {
    logError('[alert] webhook error', err);
    return { delivered: false, reason: 'request_failed' };
  }
}
