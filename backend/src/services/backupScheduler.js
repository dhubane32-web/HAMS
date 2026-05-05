import { cleanupBackupsByRetention, runFullBackup } from './backupService.js';

let timer = null;
const lastRuns = { daily: '', weekly: '', monthly: '' };

function msUntilNext(hourUtc, minuteUtc) {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(hourUtc, minuteUtc, 0, 0);
  if (next <= now) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime() - now.getTime();
}

function normalizeNumber(raw, fallback, min, max) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  if (n < min || n > max) return fallback;
  return Math.floor(n);
}

function isSunday(date) {
  return date.getUTCDay() === 0;
}

function isMonthStart(date) {
  return date.getUTCDate() === 1;
}

function keyFor(date, tier) {
  const y = date.getUTCFullYear();
  if (tier === 'daily') return `${y}-${date.getUTCMonth() + 1}-${date.getUTCDate()}`;
  if (tier === 'weekly') {
    const d = new Date(Date.UTC(y, date.getUTCMonth(), date.getUTCDate()));
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    return `${d.getUTCFullYear()}-W${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
  }
  return `${y}-${date.getUTCMonth() + 1}`;
}

export function startBackupScheduler() {
  const enabled = String(process.env.BACKUP_SCHEDULER_ENABLED || 'true').trim().toLowerCase();
  if (enabled === 'false' || enabled === '0' || enabled === 'off') {
    console.log('[backup] scheduler disabled by BACKUP_SCHEDULER_ENABLED');
    return;
  }
  const dailyHourUtc = normalizeNumber(process.env.BACKUP_DAILY_HOUR_UTC, 2, 0, 23);
  const dailyMinuteUtc = normalizeNumber(process.env.BACKUP_DAILY_MINUTE_UTC, 0, 0, 59);
  const weeklyHourUtc = normalizeNumber(process.env.BACKUP_WEEKLY_HOUR_UTC, 2, 0, 23);
  const weeklyMinuteUtc = normalizeNumber(process.env.BACKUP_WEEKLY_MINUTE_UTC, 15, 0, 59);
  const monthlyHourUtc = normalizeNumber(process.env.BACKUP_MONTHLY_HOUR_UTC, 2, 0, 23);
  const monthlyMinuteUtc = normalizeNumber(process.env.BACKUP_MONTHLY_MINUTE_UTC, 30, 0, 59);

  const loop = async () => {
    const now = new Date();
    const h = now.getUTCHours();
    const m = now.getUTCMinutes();
    try {
      if (h === dailyHourUtc && m === dailyMinuteUtc) {
        const k = keyFor(now, 'daily');
        if (lastRuns.daily !== k) {
          lastRuns.daily = k;
          await runFullBackup({ triggeredBy: 'scheduler', triggerKind: 'daily' });
          await cleanupBackupsByRetention();
        }
      }
      if (isSunday(now) && h === weeklyHourUtc && m === weeklyMinuteUtc) {
        const k = keyFor(now, 'weekly');
        if (lastRuns.weekly !== k) {
          lastRuns.weekly = k;
          await runFullBackup({ triggeredBy: 'scheduler', triggerKind: 'weekly' });
          await cleanupBackupsByRetention();
        }
      }
      if (isMonthStart(now) && h === monthlyHourUtc && m === monthlyMinuteUtc) {
        const k = keyFor(now, 'monthly');
        if (lastRuns.monthly !== k) {
          lastRuns.monthly = k;
          await runFullBackup({ triggeredBy: 'scheduler', triggerKind: 'monthly' });
          await cleanupBackupsByRetention();
        }
      }
    } catch (error) {
      console.error('[backup] scheduled backup failed:', error?.message || error);
    } finally {
      timer = setTimeout(loop, 60 * 1000);
      if (typeof timer.unref === 'function') timer.unref();
    }
  };

  const firstWait = Math.min(
    msUntilNext(dailyHourUtc, dailyMinuteUtc),
    msUntilNext(weeklyHourUtc, weeklyMinuteUtc),
    msUntilNext(monthlyHourUtc, monthlyMinuteUtc),
    60 * 1000
  );
  timer = setTimeout(loop, Math.max(1000, firstWait));
  if (typeof timer.unref === 'function') timer.unref();
  console.log(
    `[backup] scheduler active daily=${String(dailyHourUtc).padStart(2, '0')}:${String(dailyMinuteUtc).padStart(2, '0')} ` +
      `weekly(sun)=${String(weeklyHourUtc).padStart(2, '0')}:${String(weeklyMinuteUtc).padStart(2, '0')} ` +
      `monthly(day1)=${String(monthlyHourUtc).padStart(2, '0')}:${String(monthlyMinuteUtc).padStart(2, '0')} UTC`
  );
}

export function stopBackupScheduler() {
  if (timer) clearTimeout(timer);
  timer = null;
}
