/**
 * Commercial notifications — email, WhatsApp webhook, queued outbox.
 */

import nodemailer from 'nodemailer';
import { pool } from '../config/db.js';
import { isSmtpConfigured, sendEticketEmail } from './ticketDocuments.js';
import { getOrBuildEticketPdfBuffer } from './eticketPdfCache.js';
import { logInfo, logError } from '../lib/safeLog.js';

export function isMissingNotificationSchema(err) {
  return err?.code === '42P01' && String(err?.message || '').includes('commercial_notifications');
}

function smtpTransport() {
  if (!isSmtpConfigured()) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined
  });
}

export async function queueNotification(client, {
  channel,
  templateCode,
  recipient,
  bookingId = null,
  flightId = null,
  passengerId = null,
  payload = {},
  scheduledAt = null
}) {
  const r = await client.query(
    `INSERT INTO commercial_notifications (
       channel, template_code, recipient, booking_id, flight_id, passenger_id,
       status, payload, scheduled_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, 'QUEUED', $7::jsonb, $8)
     RETURNING id, channel, template_code, status, created_at`,
    [
      channel,
      templateCode,
      recipient,
      bookingId,
      flightId,
      passengerId,
      JSON.stringify(payload),
      scheduledAt
    ]
  );
  return r.rows[0];
}

async function markNotification(client, id, { status, providerRef, errorMessage }) {
  await client.query(
    `UPDATE commercial_notifications
     SET status = $2, provider_ref = $3, error_message = $4, sent_at = CASE WHEN $2 = 'SENT' THEN NOW() ELSE sent_at END
     WHERE id = $1`,
    [id, status, providerRef || null, errorMessage || null]
  );
}

async function sendWhatsAppWebhook({ to, body }) {
  const url = String(process.env.HAMS_WHATSAPP_WEBHOOK_URL || '').trim();
  if (!url) {
    const err = new Error('WhatsApp webhook not configured (HAMS_WHATSAPP_WEBHOOK_URL).');
    err.code = 'WHATSAPP_NOT_CONFIGURED';
    throw err;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to, message: body })
  });
  if (!res.ok) {
    const err = new Error(`WhatsApp webhook failed (${res.status}).`);
    err.code = 'WHATSAPP_FAILED';
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  return data?.id || data?.messageId || 'whatsapp-sent';
}

export async function deliverNotification(client, row) {
  const payload = row.payload || {};
  const template = String(row.template_code || '').toUpperCase();

  if (row.channel === 'EMAIL') {
    if (!isSmtpConfigured()) {
      await markNotification(client, row.id, { status: 'SKIPPED', errorMessage: 'SMTP not configured' });
      return { ok: false, skipped: true };
    }
    const transport = smtpTransport();
    const to = String(row.recipient || '').trim();
    if (!to) {
      await markNotification(client, row.id, { status: 'FAILED', errorMessage: 'Missing recipient' });
      return { ok: false };
    }

    if (template === 'ETICKET' && row.booking_id && payload.ticketId) {
      const { buffer: buf, context: ctx } = await getOrBuildEticketPdfBuffer(pool, row.booking_id, payload.ticketId);
      if (!buf || !ctx) {
        await markNotification(client, row.id, { status: 'FAILED', errorMessage: 'Ticket PDF not found' });
        return { ok: false };
      }
      await sendEticketEmail({
        to,
        subject: payload.subject,
        pdfBuffer: buf,
        filename: `e-ticket-${ctx.ticket.ticket_number}.pdf`,
        pnr: ctx.ticket.pnr,
        ticketNo: ctx.ticket.ticket_number
      });
    } else {
      const subject =
        payload.subject ||
        (template === 'BOOKING_CONFIRM' ? `Booking confirmed — PNR ${payload.pnr || ''}` : 'Hawana Airways');
      const text =
        payload.body ||
        payload.text ||
        `Your Hawana Airways notification (${template}). PNR: ${payload.pnr || '—'}`;
      await transport.sendMail({
        from: process.env.SMTP_FROM,
        to,
        subject,
        text,
        html: payload.html || undefined
      });
    }
    await markNotification(client, row.id, { status: 'SENT', providerRef: 'smtp' });
    return { ok: true };
  }

  if (row.channel === 'WHATSAPP') {
    const body =
      payload.body ||
      `Hawana Airways: ${template.replace(/_/g, ' ')}. PNR ${payload.pnr || '—'}. ${payload.detail || ''}`.trim();
    const ref = await sendWhatsAppWebhook({ to: row.recipient, body });
    await markNotification(client, row.id, { status: 'SENT', providerRef: String(ref) });
    return { ok: true };
  }

  await markNotification(client, row.id, { status: 'SKIPPED', errorMessage: `Unsupported channel ${row.channel}` });
  return { ok: false, skipped: true };
}

export async function processNotificationOutbox(limit = 25) {
  const client = await pool.connect();
  let sent = 0;
  let failed = 0;
  try {
    const q = await client.query(
      `SELECT id, channel, template_code, recipient, booking_id, flight_id, passenger_id, payload, status
       FROM commercial_notifications
       WHERE status = 'QUEUED'
         AND (scheduled_at IS NULL OR scheduled_at <= NOW())
       ORDER BY created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [limit]
    );
    for (const row of q.rows) {
      try {
        const out = await deliverNotification(client, row);
        if (out.ok) sent += 1;
        else if (!out.skipped) failed += 1;
      } catch (e) {
        failed += 1;
        await markNotification(client, row.id, {
          status: 'FAILED',
          errorMessage: e?.message || String(e)
        });
        logError('[notifications] deliver failed', { id: row.id, err: e?.message });
      }
    }
  } finally {
    client.release();
  }
  return { sent, failed };
}

export async function notifyBookingConfirmation(client, bookingId, { channels = ['EMAIL'] } = {}) {
  const b = await client.query(
    `SELECT b.id, b.pnr, b.total_amount, b.currency, b.trip_type
     FROM bookings b WHERE b.id = $1`,
    [bookingId]
  );
  const booking = b.rows[0];
  if (!booking) return [];

  const pax = await client.query(
    `SELECT p.id, p.email, p.phone, p.first_name, p.last_name
     FROM booking_passengers bp
     JOIN passengers p ON p.id = bp.passenger_id
     WHERE bp.booking_id = $1`,
    [bookingId]
  );

  const flights = await client.query(
    `SELECT f.flight_number, f.departure_airport, f.arrival_airport, f.departure_time
     FROM booking_flights bf
     JOIN flights f ON f.id = bf.flight_id
     WHERE bf.booking_id = $1
     ORDER BY bf.leg_sequence, f.departure_time`,
    [bookingId]
  );

  const route = flights.rows.map((f) => `${f.departure_airport}→${f.arrival_airport}`).join(', ');
  const firstDep = flights.rows[0]?.departure_time;
  const queued = [];

  for (const row of pax.rows) {
    const name = `${row.first_name} ${row.last_name}`.trim();
    const payload = {
      pnr: booking.pnr,
      name,
      route,
      departure: firstDep,
      total: booking.total_amount,
      currency: booking.currency,
      body: `Booking confirmed. PNR ${booking.pnr}. ${route}. Departure ${firstDep ? new Date(firstDep).toISOString() : 'TBC'}. Total ${booking.currency} ${booking.total_amount}.`
    };

    if (channels.includes('EMAIL') && row.email) {
      queued.push(
        await queueNotification(client, {
          channel: 'EMAIL',
          templateCode: 'BOOKING_CONFIRM',
          recipient: row.email,
          bookingId,
          passengerId: row.id,
          payload
        })
      );
    }
    if (channels.includes('WHATSAPP') && row.phone) {
      queued.push(
        await queueNotification(client, {
          channel: 'WHATSAPP',
          templateCode: 'BOOKING_CONFIRM',
          recipient: row.phone,
          bookingId,
          passengerId: row.id,
          payload
        })
      );
    }
  }
  return queued;
}

export async function notifyFlightDelay(flightId, { delayMinutes, reason } = {}) {
  const db = await pool.connect();
  try {
    const f = await db.query(
      `SELECT flight_number, departure_airport, arrival_airport, departure_time FROM flights WHERE id = $1`,
      [flightId]
    );
    const flight = f.rows[0];
    if (!flight) return { queued: 0 };

    const pax = await db.query(
      `SELECT DISTINCT p.id, p.email, p.phone, p.first_name, b.pnr
       FROM booking_flights bf
       JOIN bookings b ON b.id = bf.booking_id AND upper(b.booking_status) <> 'CANCELLED'
       JOIN booking_passengers bp ON bp.booking_id = b.id
       JOIN passengers p ON p.id = bp.passenger_id
       WHERE bf.flight_id = $1`,
      [flightId]
    );

    let queued = 0;
    for (const row of pax.rows) {
      const payload = {
        pnr: row.pnr,
        flight: flight.flight_number,
        delayMinutes,
        reason: reason || 'Operational delay',
        body: `Flight ${flight.flight_number} ${flight.departure_airport}→${flight.arrival_airport} delayed ${delayMinutes} min. PNR ${row.pnr}.`
      };
      if (row.email) {
        await queueNotification(db, {
          channel: 'EMAIL',
          templateCode: 'DELAY_ALERT',
          recipient: row.email,
          bookingId: null,
          flightId,
          passengerId: row.id,
          payload
        });
        queued += 1;
      }
      if (row.phone && process.env.HAMS_WHATSAPP_WEBHOOK_URL) {
        await queueNotification(db, {
          channel: 'WHATSAPP',
          templateCode: 'DELAY_ALERT',
          recipient: row.phone,
          flightId,
          passengerId: row.id,
          payload
        });
        queued += 1;
      }
    }
    return { queued };
  } finally {
    db.release();
  }
}

/** Fire-and-forget after booking commit */
export function scheduleBookingNotifications(bookingId) {
  setImmediate(async () => {
    const client = await pool.connect();
    try {
      const channels = ['EMAIL'];
      if (process.env.HAMS_WHATSAPP_WEBHOOK_URL) channels.push('WHATSAPP');
      await notifyBookingConfirmation(client, bookingId, { channels });
      await processNotificationOutbox(50);
    } catch (e) {
      logInfo('[notifications] booking confirm', { err: e?.message });
    } finally {
      client.release();
    }
  });
}
