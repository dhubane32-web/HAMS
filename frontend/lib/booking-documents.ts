import { getPublicApiBaseUrl } from '@/lib/api-base';

const API_BASE_URL = getPublicApiBaseUrl();

function authHeaders(): HeadersInit {
  const token = typeof window !== 'undefined' ? localStorage.getItem('hams_token') : null;
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

async function fetchPdf(path: string): Promise<Blob> {
  const res = await fetch(`${API_BASE_URL}${path}`, { headers: authHeaders() });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(err.message || `PDF request failed (${res.status})`);
  }
  return res.blob();
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function downloadTicketPdf(bookingId: string, ticketId: string, ticketNumber: string) {
  const blob = await fetchPdf(`/api/booking/${bookingId}/documents/tickets/${ticketId}.pdf`);
  downloadBlob(blob, `e-ticket-${ticketNumber}.pdf`);
}

export async function regenerateTicketPdf(bookingId: string, ticketId: string, ticketNumber: string) {
  const blob = await fetchPdf(`/api/booking/${bookingId}/documents/tickets/${ticketId}.pdf?regenerate=1`);
  downloadBlob(blob, `e-ticket-${ticketNumber}-regenerated.pdf`);
}

/** Open the e-ticket PDF in a new tab (inline viewer). */
export async function viewTicketPdf(bookingId: string, ticketId: string) {
  const blob = await fetchPdf(`/api/booking/${bookingId}/documents/tickets/${ticketId}.pdf`);
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank', 'noopener,noreferrer');
  if (!w) {
    URL.revokeObjectURL(url);
    throw new Error('Popup blocked — allow popups to view the e-ticket, or use Download PDF.');
  }
  window.setTimeout(() => {
    try {
      w.focus();
    } catch {
      /* ignore */
    }
  }, 100);
}

/** Opens the PDF in a new tab and triggers the browser print dialog (print-friendly e-ticket). */
export async function printTicketPdf(bookingId: string, ticketId: string) {
  const blob = await fetchPdf(`/api/booking/${bookingId}/documents/tickets/${ticketId}.pdf`);
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank', 'noopener,noreferrer');
  if (w) {
    window.setTimeout(() => {
      try {
        w.focus();
        w.print();
      } catch {
        /* rely on browser PDF viewer print */
      }
    }, 600);
  } else {
    URL.revokeObjectURL(url);
    throw new Error('Popup blocked — allow popups to print, or use Download PDF.');
  }
}

export async function emailTicketPdf(bookingId: string, ticketId: string, to?: string) {
  const res = await fetch(`${API_BASE_URL}/api/booking/${bookingId}/documents/tickets/${ticketId}/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(to ? { to } : {})
  });
  const data = (await res.json().catch(() => ({}))) as { message?: string; to?: string; code?: string };
  if (!res.ok) {
    const err = new Error(data.message || 'Email failed');
    (err as Error & { code?: string }).code = data.code;
    throw err;
  }
  return data;
}

export async function downloadBookingInvoicePdf(bookingId: string, pnr: string) {
  const blob = await fetchPdf(`/api/booking/${bookingId}/documents/invoice.pdf`);
  downloadBlob(blob, `invoice-${pnr}.pdf`);
}

export async function downloadPaymentReceiptPdf(bookingId: string, paymentId: string, pnr: string) {
  const blob = await fetchPdf(`/api/booking/${bookingId}/documents/payments/${paymentId}/receipt.pdf`);
  downloadBlob(blob, `receipt-${pnr}-${paymentId.slice(0, 8)}.pdf`);
}
