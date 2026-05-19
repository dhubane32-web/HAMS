import { apiFetchJson } from '@/lib/api-client';

export type FlightInventory = {
  flightId: string;
  flightNumber: string;
  status: string;
  capacity: number;
  sold: number;
  available: number;
  openForSale: boolean;
};

export type CommercialNotification = {
  id: string;
  channel: string;
  template_code: string;
  recipient: string;
  status: string;
  created_at: string;
  sent_at?: string | null;
  error_message?: string | null;
};

export type PassengerProfile = {
  id: string;
  profile_ref: string;
  primary_email?: string | null;
  primary_phone?: string | null;
  loyalty_tier: string;
  passenger_links?: number;
};

export async function fetchCommercialHealth() {
  return apiFetchJson<{ module: string; status: string; phase: number }>('/api/commercial/health');
}

export async function fetchFlightInventory(flightId: string, fareClassId?: string) {
  const q = fareClassId ? `?fareClassId=${encodeURIComponent(fareClassId)}` : '';
  return apiFetchJson<{ inventory: FlightInventory }>(`/api/commercial/inventory/${flightId}${q}`);
}

export async function createMultiCityBooking(body: Record<string, unknown>) {
  return apiFetchJson<{ booking: Record<string, unknown>; tickets: unknown[] }>(
    '/api/commercial/bookings/multi-city',
    { method: 'POST', body: JSON.stringify(body) }
  );
}

export async function fetchSsrOsi(bookingId: string) {
  return apiFetchJson<{ ssr: unknown[]; osi: unknown[] }>(`/api/commercial/bookings/${bookingId}/ssr-osi`);
}

export async function addBookingSsr(bookingId: string, body: Record<string, unknown>) {
  return apiFetchJson(`/api/commercial/bookings/${bookingId}/ssr`, {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

export async function addBookingOsi(bookingId: string, line: string) {
  return apiFetchJson(`/api/commercial/bookings/${bookingId}/osi`, {
    method: 'POST',
    body: JSON.stringify({ osiLine: line })
  });
}

export async function modifyBookingCommercial(
  bookingId: string,
  body: { notes?: string; contactUpdates?: Array<{ passengerId: string; phone?: string; email?: string }> }
) {
  return apiFetchJson(`/api/commercial/bookings/${bookingId}/modify`, {
    method: 'PATCH',
    body: JSON.stringify(body)
  });
}

export async function reissueTicket(ticketId: string) {
  return apiFetchJson(`/api/commercial/tickets/${ticketId}/reissue`, { method: 'POST' });
}

export async function refundTicketCommercial(ticketId: string, body?: { amount?: number; reason?: string }) {
  return apiFetchJson(`/api/commercial/tickets/${ticketId}/refund`, {
    method: 'POST',
    body: JSON.stringify(body || {})
  });
}

export async function searchPassengerProfiles(q: string) {
  return apiFetchJson<{ profiles: PassengerProfile[] }>(
    `/api/commercial/profiles/search?q=${encodeURIComponent(q)}`
  );
}

export async function fetchPassengerProfile(profileId: string) {
  return apiFetchJson<{
    profile: PassengerProfile;
    passengers: unknown[];
    bookings: unknown[];
  }>(`/api/commercial/profiles/${profileId}`);
}

export async function fetchCommercialNotifications(limit = 40) {
  return apiFetchJson<{ notifications: CommercialNotification[] }>(
    `/api/commercial/notifications?limit=${limit}`
  );
}

export async function sendBookingNotifications(bookingId: string, channels: string[] = ['EMAIL']) {
  return apiFetchJson(`/api/commercial/notifications/booking/${bookingId}/send`, {
    method: 'POST',
    body: JSON.stringify({ channels })
  });
}

export async function fetchTicketCoupons(bookingId: string) {
  return apiFetchJson<{ coupons: unknown[] }>(`/api/commercial/bookings/${bookingId}/coupons`);
}

export async function fetchBaggageRules(bookingId: string) {
  return apiFetchJson<{ rules: unknown[] }>(`/api/commercial/bookings/${bookingId}/baggage-rules`);
}
