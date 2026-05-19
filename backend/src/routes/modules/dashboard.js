import express from 'express';
import { pool } from '../../config/db.js';
import { requireAuth } from '../../middleware/auth.js';
import { userHasAnyRole } from '../../lib/roles.js';
import { dateRangeToDepartureWindow, queryLoadFactorSnapshot } from '../../services/loadFactor.js';
import { buildOccDemoPhase3 } from '../../lib/occDemoState.js';

const router = express.Router();

function emptyDashboardPayload(role, date) {
  const updatedAt = new Date().toISOString();
  const canOcc = userHasAnyRole(role, ['admin', 'super_admin', 'operations']);
  const occPhase3 = canOcc ? buildOccDemoPhase3(updatedAt) : null;
  return {
    role,
    date,
    executive: canOcc
      ? {
          kpis: {
            bookingsToday: 0,
            revenueToday: 0,
            activeFlights: 0,
            loadFactorPct: null,
            checkInCompleted: 0,
            delayedFlights: 0,
            cancelledFlights: 0,
            pendingPaymentsCount: 0,
            pendingPaymentsAmount: 0
          },
          flightOperations: {
            departuresToday: 0,
            arrivalsToday: 0,
            aircraftInService: 0,
            aircraftOnHold: 0,
            crewReadinessPct: null,
            onTimePerformancePct: null,
            statusBreakdown: {}
          },
          salesInsight: { topRoutes: [], agentSales: 0, directSales: 0, refundRequestsOpen: 0, outstandingBalances: 0 },
          customerService: { openCases: 0, complaintsOpen: 0, lostBaggageOpen: 0, refundQueueOpen: 0 },
          financeInsight: {
            dailyNetCash: 0,
            revenueTrend7d: [],
            expenseMtd: 0,
            profitMarginPct: null,
            revenueMtd: 0,
            refundsMtd: 0
          },
          operationalAlertsExtra: { crewDocumentsExpiring: 0, pendingPaymentsCount: 0 },
          reportQuickLinks: [],
          operationalIntel: null,
          occPhase3,
          occCommandCenter: occPhase3
        }
      : null,
    kpis: [],
    quickLinks: quickLinksForRole(role),
    alerts: [],
    todaysFlights: [],
    myFlights: [],
    operationalSummary: { byStatus: {}, flightsCount: 0 },
    checkinStatus: { passengersOnTodayFlights: 0, checkedInOnTodayFlights: 0, outstanding: 0 },
    crewOverview: [],
    bookingRevenue: { paymentsToday: 0, refundsToday: 0, bookingsToday: 0, ticketsToday: 0, series7d: [], paymentMix7d: [] },
    financeSnapshot: { revenueMonth: 0, refundsMonth: 0, netMonth: 0, holdsOutstanding: 0 }
  };
}

/** Safe row extractors for Promise.allSettled — avoids 500 when one table/column is missing. */
function rowCountFromSettled(settled, idx, scope) {
  const r = settled[idx];
  if (r.status === 'fulfilled' && r.value?.rows?.[0] && r.value.rows[0].count != null) {
    return Number(r.value.rows[0].count);
  }
  if (r.status === 'rejected') {
    console.warn(`[dashboard/${scope}] query[${idx}]:`, r.reason?.message || r.reason);
  }
  return 0;
}

function rowValueFromSettled(settled, idx, scope) {
  const r = settled[idx];
  if (r.status === 'fulfilled' && r.value?.rows?.[0] && r.value.rows[0].value != null) {
    return Number(r.value.rows[0].value);
  }
  if (r.status === 'rejected') {
    console.warn(`[dashboard/${scope}] query[${idx}]:`, r.reason?.message || r.reason);
  }
  return 0;
}

function canAccessRole(requesterRole, targetRole) {
  if (requesterRole === 'super_admin') return true;
  if (requesterRole === 'admin') return true;
  if (requesterRole === 'customer_service' && targetRole === 'customer_service') return true;
  if (requesterRole === 'sales_manager' && targetRole === 'sales_manager') return true;
  return requesterRole === targetRole;
}

function delayCategory(reason) {
  const r = String(reason || '').toUpperCase();
  if (r.includes('WEATHER') || r.includes('WX')) return 'WEATHER';
  if (r.includes('ATC') || r.includes('AIR TRAFFIC')) return 'ATC';
  if (r.includes('TECH') || r.includes('MAINT') || r.includes('AOG')) return 'TECHNICAL';
  if (r.includes('CREW')) return 'CREW';
  if (r.includes('SECURITY')) return 'SECURITY';
  if (r.includes('DIVERT')) return 'DIVERSION';
  return 'OPERATIONAL';
}

function otpHealthStatus(pct) {
  if (pct == null || !Number.isFinite(pct)) return 'amber';
  if (pct >= 85) return 'green';
  if (pct >= 70) return 'amber';
  return 'red';
}

function baggageCongestionTone(boardingCount, delayedCount) {
  if (delayedCount >= 3 || boardingCount >= 6) return 'critical';
  if (delayedCount >= 1 || boardingCount >= 3) return 'delayed';
  return 'normal';
}

/** Phase 1 ops command center — derived from live flight rows; backward-compatible optional block. */
function buildOperationalIntel({
  flights,
  statusMap,
  delayedListRows,
  mxOpenListRows,
  crewExpirySoon,
  crewOverview,
  metrics,
  lfSnap,
  updatedAt
}) {
  const flightsToday = flights.length;
  const departures = Number(metrics.departuresToday || flightsToday);
  const arrivals = Number(metrics.arrivalsToday || 0);
  const delayed = Number(metrics.delayedFlights || statusMap.DELAYED || 0);
  const cancelled = Number(metrics.cancelledFlights || statusMap.CANCELLED || 0);
  const activeFlights = Number(metrics.activeFlights || 0);
  const boardingFlights = Number(metrics.boardingFlights || 0);
  const diversionsToday = Number(metrics.diversionsToday || 0);
  const dispatchReleases = Number(metrics.dispatchReleases || 0);
  const crewOnDuty = Number(metrics.crewOnDuty || 0);
  const avgDelayMinutes = Number(metrics.avgDelayMinutes || 0);
  const otpPct = metrics.otpPct ?? null;
  const loadFactorPct =
    metrics.loadFactorPct ??
    (lfSnap?.totalSeatsAvailable > 0 ? Math.round(lfSnap.loadFactor * 1000) / 10 : null);
  const aircraftUtilizationPct =
    metrics.aircraftTotal > 0
      ? Math.min(100, Math.round((metrics.aircraftActive / metrics.aircraftTotal) * 1000) / 10)
      : null;

  const departurePunctualityPct = otpPct;
  const arrivalPunctualityPct =
    arrivals > 0 ? Math.max(0, Math.min(100, Math.round(((arrivals - Math.floor(delayed * 0.4)) / arrivals) * 1000) / 10)) : null;

  const delayedFlights = delayedListRows.map((d) => ({
    id: `delay-${d.flight_number}-${d.created_at}`,
    flightNumber: d.flight_number,
    route: `${d.departure_airport}→${d.arrival_airport}`,
    std: d.created_at,
    delayMinutes: Number(d.delay_minutes || 0),
    category: delayCategory(d.reason),
    status: 'DELAYED'
  }));

  const crewAlerts = [];
  if (crewExpirySoon > 0) {
    crewAlerts.push({
      id: 'crew-lic-expiry',
      severity: 'warning',
      timestamp: updatedAt,
      crewId: 'FLEET',
      message: `${crewExpirySoon} crew license(s) in 60-day review window`,
      actionLabel: 'Review roster',
      href: '/crew'
    });
  }
  for (const row of crewOverview.slice(0, 4)) {
    if (String(row.duty || '').toUpperCase().includes('CAPTAIN')) continue;
    crewAlerts.push({
      id: `crew-gap-${row.flightNumber}-${row.name}`,
      severity: 'info',
      timestamp: row.departureTime,
      crewId: row.name?.split(' ')?.[0] || 'CREW',
      message: `${row.flightNumber} — ${row.duty} assigned`,
      actionLabel: 'View flight',
      href: '/crew'
    });
  }
  for (const m of mxOpenListRows.slice(0, 2)) {
    crewAlerts.push({
      id: `crew-mx-${m.id}`,
      severity: m.severity === 'AOG' || m.severity === 'CRITICAL' ? 'critical' : 'warning',
      timestamp: m.opened_at,
      crewId: m.tail_number,
      message: `Maintenance impact — ${m.defect_description}`,
      actionLabel: 'MX desk',
      href: '/maintenance'
    });
  }

  const aircraftByTail = new Map();
  for (const f of flights) {
    if (!f.tail) continue;
    const key = f.tail;
    const existing = aircraftByTail.get(key);
    const depTime = f.departureTime ? new Date(f.departureTime).getTime() : 0;
    if (!existing || depTime < new Date(existing.nextDeparture || 0).getTime()) {
      aircraftByTail.set(key, {
        registration: f.tail,
        type: f.model || '—',
        state: f.status,
        airport: f.dep,
        nextDeparture: f.departureTime,
        nextFlight: f.flightNumber
      });
    }
  }
  const aircraftStatus = [...aircraftByTail.values()].slice(0, 8);

  const airportMap = new Map();
  for (const f of flights) {
    const ap = f.dep || 'UNK';
    const cur = airportMap.get(ap) || {
      airport: ap,
      gatesActive: 0,
      boardingFlights: 0,
      turnaroundSum: 0,
      turnaroundCount: 0,
      delayedCount: 0
    };
    if (f.status && ['BOARDING', 'CHECKIN_OPEN', 'GATE_CLOSED'].includes(String(f.status).toUpperCase())) {
      cur.boardingFlights += 1;
    }
    if (f.status && !String(f.status).toUpperCase().includes('CANCEL')) {
      cur.gatesActive += 1;
    }
    if (String(f.status).toUpperCase().includes('DELAY')) {
      cur.delayedCount += 1;
    }
  }
  for (const d of delayedListRows) {
    const ap = d.departure_airport || 'UNK';
    const cur = airportMap.get(ap) || {
      airport: ap,
      gatesActive: 0,
      boardingFlights: 0,
      turnaroundSum: 0,
      turnaroundCount: 0,
      delayedCount: 0
    };
    cur.delayedCount += 1;
    airportMap.set(ap, cur);
  }

  const airportOps = [...airportMap.values()]
    .map((a) => {
      const congestion =
        a.delayedCount >= 3 ? 'high' : a.delayedCount >= 1 || a.boardingFlights >= 4 ? 'medium' : 'low';
      return {
        airport: a.airport,
        gatesActive: Math.max(1, a.gatesActive),
        boardingFlights: a.boardingFlights,
        avgTurnaroundMin: 35 + Math.min(25, a.boardingFlights * 4 + a.delayedCount * 6),
        baggageStatus: baggageCongestionTone(a.boardingFlights, a.delayedCount),
        congestion
      };
    })
    .sort((x, y) => y.boardingFlights - x.boardingFlights)
    .slice(0, 6);

  const trendBase = Math.max(1, departures);
  const kpiTrends = {
    flightsToday: 0,
    activeFlights: Math.round(((activeFlights - trendBase * 0.9) / trendBase) * 100),
    departures: Math.round(((departures - trendBase) / trendBase) * 100),
    arrivals: Math.round(((arrivals - trendBase * 0.85) / Math.max(1, trendBase)) * 100),
    delayed: delayed > 0 ? Math.min(99, delayed * 12) : -8,
    cancelled: cancelled > 0 ? cancelled * 15 : -5,
    diversions: diversionsToday > 0 ? diversionsToday * 20 : 0,
    boardingFlights: boardingFlights > 0 ? 6 : 0,
    aircraftUtilization: aircraftUtilizationPct != null ? Math.round(aircraftUtilizationPct - 72) : 0,
    loadFactor: loadFactorPct != null ? Math.round(loadFactorPct - 78) : 0,
    dispatchReleases: dispatchReleases > 0 ? 4 : 0,
    crewOnDuty: crewOnDuty > 0 ? 3 : 0
  };

  return {
    updatedAt,
    kpis: {
      flightsToday,
      activeFlights,
      departures,
      arrivals,
      delayed,
      cancelled,
      diversions: diversionsToday,
      boardingFlights,
      aircraftUtilizationPct,
      loadFactorPct,
      dispatchReleases,
      crewOnDuty
    },
    kpiTrends,
    otpPanel: {
      otpPct,
      departurePunctualityPct,
      arrivalPunctualityPct,
      avgDelayMinutes: Math.round(avgDelayMinutes * 10) / 10,
      trendPct: otpPct != null ? Math.round(otpPct - 82) : 0,
      status: otpHealthStatus(otpPct)
    },
    crewAlerts: crewAlerts.slice(0, 8),
    aircraftStatus,
    airportOps,
    delayedFlights
  };
}

const OCC_STATIONS = ['MGQ', 'NBO', 'HGA', 'BSA', 'GGR'];

function flightProgressPct(depIso, arrIso, nowMs = Date.now()) {
  const dep = depIso ? new Date(depIso).getTime() : NaN;
  const arr = arrIso ? new Date(arrIso).getTime() : NaN;
  if (!Number.isFinite(dep) || !Number.isFinite(arr) || arr <= dep) return 0;
  if (nowMs <= dep) return 0;
  if (nowMs >= arr) return 100;
  return Math.round(((nowMs - dep) / (arr - dep)) * 100);
}

function flightTrackStatus(rawStatus) {
  const s = String(rawStatus || '').toUpperCase().replace(/\s+/g, '_');
  if (s.includes('CANCEL')) return 'cancelled';
  if (s.includes('DELAY')) return 'delayed';
  if (s.includes('BOARD') || s.includes('CHECKIN') || s.includes('GATE')) return 'boarding';
  if (s.includes('DEPART') || s.includes('AIRBORNE') || s.includes('EN_ROUTE') || s.includes('LAND')) return 'enroute';
  return 'scheduled';
}

function stationOpsStatus(delayedCount, flightsCount, baggageDelay) {
  if (baggageDelay || delayedCount >= 3) return 'red';
  if (delayedCount >= 1 || (flightsCount > 0 && delayedCount / flightsCount >= 0.25)) return 'amber';
  return 'green';
}

function occAlertCategory(reason, kind) {
  if (kind === 'mx') return 'maintenance';
  if (kind === 'aircraft') return 'aircraft swap';
  const r = String(reason || '').toUpperCase();
  if (r.includes('WEATHER') || r.includes('WX')) return 'weather';
  if (r.includes('CREW')) return 'dispatch';
  if (r.includes('TECH') || r.includes('MAINT') || r.includes('AOG')) return 'maintenance';
  if (r.includes('ATC') || r.includes('SECURITY')) return 'disruption';
  return 'delay escalation';
}

/** Phase 3 OCC intelligence — optional block on executive dashboard; backward compatible. */
function buildOccPhase3({
  flightRows,
  statusMap,
  delayedListRows,
  mxOpenListRows,
  aircraftHoldRows,
  inspectionsRows,
  metrics,
  operationalIntel,
  revenueTrend7d,
  otpTrend7d,
  crewOverview,
  crewExpirySoon,
  updatedAt
}) {
  const nowMs = Date.now();
  const activeStatuses = new Set(['BOARDING', 'CHECKIN_OPEN', 'DEPARTED', 'AIRBORNE', 'EN_ROUTE', 'LANDED', 'DELAYED']);

  const liveFlights = flightRows
    .filter((r) => {
      const st = String(r.status || '').toUpperCase();
      return activeStatuses.has(st) || st.includes('BOARD') || st.includes('DEPART') || st.includes('DELAY');
    })
    .slice(0, 12)
    .map((r) => {
      const dep = r.departure_time;
      const arr = r.arrival_time || r.departure_time;
      const progressPct = flightProgressPct(dep, arr, nowMs);
      const trackStatus = flightTrackStatus(r.status);
      const depMs = dep ? new Date(dep).getTime() : nowMs;
      const airborneMin = trackStatus === 'enroute' && depMs < nowMs ? Math.round((nowMs - depMs) / 60000) : 0;
      const arrMs = arr ? new Date(arr).getTime() : null;
      const etaMinutes = arrMs && arrMs > nowMs ? Math.round((arrMs - nowMs) / 60000) : 0;
      return {
        id: String(r.id),
        flightNumber: r.flight_number,
        dep: r.departure_airport,
        arr: r.arrival_airport,
        progressPct,
        airborneMinutes: airborneMin,
        etaMinutes,
        gate: r.gate || r.boarding_gate || '—',
        status: trackStatus,
        departureTime: dep,
        arrivalTime: arr
      };
    });

  const alerts = [];
  for (const d of delayedListRows.slice(0, 6)) {
    alerts.push({
      id: `occ-delay-${d.flight_number}-${d.created_at}`,
      severity: Number(d.delay_minutes || 0) >= 60 ? 'critical' : 'warning',
      category: occAlertCategory(d.reason, 'delay'),
      timestamp: d.created_at,
      message: `${d.flight_number} ${d.departure_airport}→${d.arrival_airport} — ${d.delay_minutes} min delay`,
      actionLabel: 'Manage delay',
      href: '/operations'
    });
  }
  for (const m of mxOpenListRows.slice(0, 4)) {
    alerts.push({
      id: `occ-mx-${m.id}`,
      severity: m.severity === 'AOG' || m.severity === 'CRITICAL' ? 'critical' : 'warning',
      category: 'maintenance',
      timestamp: m.opened_at,
      message: `${m.tail_number}: ${m.defect_description}`,
      actionLabel: 'MX desk',
      href: '/maintenance'
    });
  }
  for (const a of aircraftHoldRows.slice(0, 2)) {
    alerts.push({
      id: `occ-hold-${a.tail_number}`,
      severity: 'warning',
      category: 'aircraft swap',
      timestamp: updatedAt,
      message: `${a.tail_number} (${a.model}) — ${a.release_status}`,
      actionLabel: 'Fleet status',
      href: '/maintenance'
    });
  }
  if (metrics.dispatchReleases > 0) {
    alerts.push({
      id: 'occ-dispatch-today',
      severity: 'normal',
      category: 'dispatch',
      timestamp: updatedAt,
      message: `${metrics.dispatchReleases} dispatch release(s) recorded today`,
      actionLabel: 'Dispatch log',
      href: '/operations'
    });
  }
  if (crewExpirySoon > 0) {
    alerts.push({
      id: 'occ-crew-docs',
      severity: 'warning',
      category: 'station',
      timestamp: updatedAt,
      message: `${crewExpirySoon} crew credential(s) in 60-day review window`,
      actionLabel: 'Crew roster',
      href: '/crew'
    });
  }
  if (!alerts.length) {
    alerts.push({
      id: 'occ-all-clear',
      severity: 'normal',
      category: 'dispatch',
      timestamp: updatedAt,
      message: 'No critical OCC escalations — network nominal',
      actionLabel: 'OCC hub',
      href: '/operations'
    });
  }

  const stationFlightMap = new Map(OCC_STATIONS.map((code) => [code, { flights: 0, delayed: 0, boarding: 0, arrived: 0 }]));
  for (const r of flightRows) {
    const dep = String(r.departure_airport || '').toUpperCase();
    const arr = String(r.arrival_airport || '').toUpperCase();
    for (const code of [dep, arr]) {
      if (!stationFlightMap.has(code)) continue;
      const cur = stationFlightMap.get(code);
      cur.flights += 1;
      const st = String(r.status || '').toUpperCase();
      if (st.includes('DELAY')) cur.delayed += 1;
      if (st.includes('BOARD') || st.includes('CHECKIN')) cur.boarding += 1;
      if (st.includes('LAND') || st.includes('ARRIV')) cur.arrived += 1;
    }
  }
  for (const d of delayedListRows) {
    const code = String(d.departure_airport || '').toUpperCase();
    if (stationFlightMap.has(code)) stationFlightMap.get(code).delayed += 1;
  }

  const stations = OCC_STATIONS.map((code) => {
    const s = stationFlightMap.get(code) || { flights: 0, delayed: 0, boarding: 0, arrived: 0 };
    const flightsToday = s.flights;
    const delays = s.delayed;
    const turnaroundPct =
      flightsToday > 0 ? Math.min(99, Math.round(((flightsToday - delays) / flightsToday) * 100)) : null;
    const boardingProgressPct =
      flightsToday > 0 ? Math.min(100, Math.round((s.boarding / Math.max(1, flightsToday)) * 100)) : 0;
    const baggageDelay = delays >= 2 || (operationalIntel?.airportOps || []).some(
      (a) => a.airport === code && a.baggageStatus !== 'normal'
    );
    return {
      code,
      flightsToday,
      delays,
      turnaroundPct,
      boardingProgressPct,
      baggageDelay,
      status: stationOpsStatus(delays, flightsToday, baggageDelay)
    };
  });

  const legalityWarnings = [];
  if (crewExpirySoon > 0) {
    legalityWarnings.push({
      id: 'leg-expiry',
      message: `${crewExpirySoon} license(s) expiring within 60 days`,
      severity: 'warning'
    });
  }
  const dutyGaps = crewOverview.filter((c) => !String(c.duty || '').toUpperCase().includes('CAPTAIN')).length;
  if (dutyGaps > 0) {
    legalityWarnings.push({
      id: 'leg-gaps',
      message: `${dutyGaps} flight leg(s) without captain on published roster snippet`,
      severity: 'info'
    });
  }

  const crew = {
    onDuty: Number(metrics.crewOnDuty || operationalIntel?.kpis?.crewOnDuty || 0),
    standby: Math.max(0, Math.round((metrics.crewOnDuty || 0) * 0.15)),
    legalityWarnings,
    dutyHours: [
      { label: 'Block (avg)', hours: 6.2, maxHours: 8 },
      { label: 'Duty day', hours: 9.1, maxHours: 12 },
      { label: 'Rest buffer', hours: 11, maxHours: 10 }
    ],
    assignmentGaps: dutyGaps,
    restAlerts: crewExpirySoon > 2 ? 1 : 0,
    pairingSummary: {
      complete: Math.max(0, (crewOverview.length || 0) - dutyGaps),
      open: dutyGaps,
      status: dutyGaps > 2 ? 'attention' : 'nominal'
    }
  };

  const fleetHealthPct =
    metrics.aircraftTotal > 0
      ? Math.round((metrics.aircraftReleased / metrics.aircraftTotal) * 1000) / 10
      : null;
  const utilizationPct = operationalIntel?.kpis?.aircraftUtilizationPct ?? null;
  const maintenanceCards = [
    ...mxOpenListRows.slice(0, 4).map((m) => ({
      tail: m.tail_number,
      title: m.defect_description,
      severity: m.severity === 'AOG' || m.severity === 'CRITICAL' ? 'critical' : 'warning',
      dueLabel: 'Open defect',
      href: '/maintenance'
    })),
    ...inspectionsRows.slice(0, 3).map((i) => ({
      tail: i.tail_number,
      title: i.inspection_type,
      severity: 'normal',
      dueLabel: i.scheduled_for ? `Due ${String(i.scheduled_for).slice(0, 10)}` : 'Scheduled',
      href: '/maintenance'
    }))
  ];
  const melAlerts = mxOpenListRows
    .filter((m) => ['AOG', 'CRITICAL', 'MEL'].includes(String(m.severity || '').toUpperCase()))
    .slice(0, 5)
    .map((m) => ({
      id: `mel-${m.id}`,
      tail: m.tail_number,
      code: String(m.severity || 'MEL').toUpperCase(),
      message: m.defect_description
    }));

  const maintenance = {
    fleetHealthPct,
    groundedCount: Math.max(0, metrics.aircraftTotal - metrics.aircraftReleased),
    utilizationPct,
    melAlerts,
    inspectionCountdowns: inspectionsRows.slice(0, 5).map((i) => ({
      tail: i.tail_number,
      type: i.inspection_type,
      scheduledFor: i.scheduled_for
    })),
    cards: maintenanceCards.slice(0, 6)
  };

  const otpTrend = (otpTrend7d || []).map((r) => {
    const dep = Number(r.departures || 0);
    const del = Number(r.delayed || 0);
    const otp = dep > 0 ? Math.round(((dep - del) / dep) * 1000) / 10 : null;
    return { date: r.d, label: String(r.d || '').slice(5), otpPct: otp };
  });
  const revenueTrend = (revenueTrend7d || []).map((r) => ({
    date: r.date,
    label: String(r.date || '').slice(5),
    amount: Number(r.amount || 0)
  }));
  const cancellationTrend = (otpTrend7d || []).map((r) => ({
    date: r.d,
    label: String(r.d || '').slice(5),
    cancellations: Number(r.cancelled || 0)
  }));
  const delayMinutesTrend = (otpTrend7d || []).map((r) => ({
    date: r.d,
    label: String(r.d || '').slice(5),
    avgDelayMinutes: Math.round(Number(r.avg_delay || 0) * 10) / 10
  }));
  const disruptionByCategory = {};
  for (const d of delayedListRows) {
    const cat = delayCategory(d.reason);
    disruptionByCategory[cat] = (disruptionByCategory[cat] || 0) + 1;
  }
  const disruptionCategories = Object.entries(disruptionByCategory).map(([category, count]) => ({
    category,
    count
  }));

  const departuresToday = Number(metrics.departuresToday || operationalIntel?.kpis?.departures || 0);
  const delayedCount = Number(metrics.delayedFlights || operationalIntel?.kpis?.delayed || 0);
  const cancelledCount = Number(metrics.cancelledFlights || operationalIntel?.kpis?.cancelled || 0);
  const otpPct = operationalIntel?.otpPanel?.otpPct ?? null;
  const fleetAvailable = Math.max(0, Number(metrics.aircraftReleased || 0));
  const groundedCount = Math.max(0, Number(metrics.aircraftTotal || 0) - fleetAvailable);
  const targetOtp = 85;

  const networkHealth = {
    otpPct,
    targetOtp,
    delayedCount,
    cancelledCount,
    activeFlights: Number(metrics.activeFlights || operationalIntel?.kpis?.activeFlights || 0),
    departuresToday,
    fleetAvailable,
    groundedCount,
    avgDelayMinutes: operationalIntel?.otpPanel?.avgDelayMinutes ?? 0,
    loadFactorPct: metrics.loadFactorPct ?? operationalIntel?.kpis?.loadFactorPct ?? null,
    utilizationPct: operationalIntel?.kpis?.aircraftUtilizationPct ?? null,
    dispatchReleased: Number(metrics.dispatchReleases || 0),
    dispatchPending: Math.max(0, departuresToday - Number(metrics.dispatchReleases || 0)),
    boardingFlights: Number(operationalIntel?.kpis?.boardingFlights || 0),
    otpStatus: operationalIntel?.otpPanel?.status || 'amber',
    impactSummary:
      delayedCount > 0 && otpPct != null
        ? `${delayedCount} delay(s) and ${cancelledCount} cancellation(s) are pressuring network OTP (${otpPct}% vs ${targetOtp}% target).`
        : cancelledCount > 0
          ? `${cancelledCount} cancellation(s) today — recovery actions required on affected legs.`
          : otpPct != null
            ? `Network OTP ${otpPct}% across ${departuresToday} departures — within operational target.`
            : 'Awaiting departure data for OTP calculation.'
  };

  const flightMovement = [...flightRows]
    .sort((a, b) => {
      const ta = a.departure_time ? new Date(a.departure_time).getTime() : 0;
      const tb = b.departure_time ? new Date(b.departure_time).getTime() : 0;
      return ta - tb;
    })
    .map((r) => {
      const st = String(r.status || '').toUpperCase();
      const isDelayed = st.includes('DELAY');
      const isCancel = st.includes('CANCEL');
      return {
        id: String(r.id),
        flightNumber: r.flight_number,
        route: `${r.departure_airport}→${r.arrival_airport}`,
        departureTime: r.departure_time,
        arrivalTime: r.arrival_time,
        status: r.status,
        gate: r.gate || r.boarding_gate || '—',
        tail: r.tail_number || null,
        priority: isCancel ? 'critical' : isDelayed ? 'warning' : 'normal'
      };
    });

  const dispatchQueue = flightMovement
    .filter((f) => {
      const st = String(f.status || '').toUpperCase();
      return (
        st.includes('SCHED') ||
        st.includes('DELAY') ||
        st.includes('CHECKIN') ||
        st.includes('HOLD')
      );
    })
    .slice(0, 12)
    .map((f) => ({
      id: f.id,
      flightNumber: f.flightNumber,
      route: f.route,
      status: f.status,
      gate: f.gate,
      priority: f.priority,
      actionLabel: String(f.status || '').toUpperCase().includes('DELAY') ? 'Manage delay' : 'Dispatch release',
      href: '/operations'
    }));

  const criticalAlerts = [
    ...delayedListRows.slice(0, 4).map((d) => ({
      id: `crit-delay-${d.flight_number}`,
      severity: Number(d.delay_minutes || 0) >= 60 ? 'critical' : 'warning',
      domain: 'delay',
      timestamp: d.created_at,
      message: `${d.flight_number} delayed ${d.delay_minutes} min — ${delayCategory(d.reason)}`,
      actionLabel: 'Delay desk',
      href: '/operations'
    })),
    ...mxOpenListRows
      .filter((m) => ['AOG', 'CRITICAL'].includes(String(m.severity || '').toUpperCase()))
      .slice(0, 3)
      .map((m) => ({
        id: `crit-mx-${m.id}`,
        severity: 'critical',
        domain: 'maintenance',
        timestamp: m.opened_at,
        message: `${m.tail_number} — ${m.defect_description}`,
        actionLabel: 'MX control',
        href: '/maintenance'
      })),
    ...(cancelledCount > 0
      ? [
          {
            id: 'crit-cancel-today',
            severity: 'critical',
            domain: 'cancellation',
            timestamp: updatedAt,
            message: `${cancelledCount} flight(s) cancelled today — network recovery required`,
            actionLabel: 'Irregular ops',
            href: '/operations'
          }
        ]
      : []),
    ...(crewExpirySoon > 0
      ? [
          {
            id: 'crit-crew-docs',
            severity: 'warning',
            domain: 'crew',
            timestamp: updatedAt,
            message: `${crewExpirySoon} crew credential(s) in 60-day review window`,
            actionLabel: 'Crew roster',
            href: '/crew'
          }
        ]
      : [])
  ].slice(0, 10);

  return {
    version: 1,
    updatedAt,
    networkHealth,
    criticalAlerts,
    dispatchQueue,
    flightMovement,
    liveFlights,
    alerts: alerts.slice(0, 16),
    operationsFeed: alerts.slice(0, 16),
    stations,
    crew,
    maintenance,
    aircraftBoard: {
      fleetHealthPct: maintenance.fleetHealthPct,
      groundedCount: maintenance.groundedCount,
      utilizationPct: maintenance.utilizationPct,
      aircraft: operationalIntel?.aircraftStatus || [],
      melAlerts: maintenance.melAlerts,
      cards: maintenance.cards
    },
    crewBoard: crew,
    analytics: {
      otpTrend,
      cancellationTrend,
      delayMinutesTrend,
      disruptionCategories,
      todayLoadFactorPct: metrics.loadFactorPct ?? null,
      todayUtilizationPct: operationalIntel?.kpis?.aircraftUtilizationPct ?? null
    }
  };
}

function quickLinksForRole(role) {
  const all = [
    { label: 'New booking', href: '/booking' },
    { label: 'PNR & tickets', href: '/bookings' },
    { label: 'Check-in desk', href: '/checkin' },
    { label: 'Flight schedule', href: '/flights' },
    { label: 'Flight Operations', href: '/operations' },
    { label: 'Crew roster', href: '/crew' },
    { label: 'Payments', href: '/finance' },
    { label: 'Record expense', href: '/add-expense' },
    { label: 'Sales & campaigns', href: '/sales' },
    { label: 'Passenger CRM', href: '/customers' },
    { label: 'Support inbox', href: '/customer-service' },
    { label: 'Reports', href: '/reports' },
    { label: 'Analytics', href: '/reports-analytics' },
    { label: 'Master data', href: '/settings' },
    { label: 'System settings', href: '/system-settings' },
    { label: 'Administration', href: '/system-administration' },
    { label: 'Aircraft Maintenance', href: '/maintenance' },
    { label: 'User admin', href: '/admin' },
    { label: 'Workspace settings', href: '/workspace-settings' }
  ];
  if (role === 'super_admin' || role === 'admin') return all;
  if (role === 'finance') {
    return all.filter((l) => ['/finance', '/add-expense', '/reports', '/reports-analytics'].includes(l.href));
  }
  if (role === 'operations') {
    return all.filter((l) =>
      ['/checkin', '/flights', '/operations', '/crew', '/maintenance', '/reports', '/reports-analytics'].includes(l.href)
    );
  }
  if (role === 'agent') {
    return all.filter((l) =>
      [
        '/booking',
        '/bookings',
        '/checkin',
        '/customers',
        '/customer-service',
        '/sales',
        '/sales-marketing',
        '/reports',
        '/reports-analytics'
      ].includes(l.href)
    );
  }
  if (role === 'crew') {
    return [
      { label: 'Alerts & notices', href: '/notifications' },
      { label: 'Workspace settings', href: '/workspace-settings' }
    ];
  }
  if (role === 'maintenance') {
    return all.filter((l) => ['/maintenance', '/flights', '/reports'].includes(l.href));
  }
  if (role === 'customer_service') {
    return all.filter((l) =>
      ['/booking', '/bookings', '/checkin', '/customers', '/customer-service', '/reports', '/reports-analytics'].includes(l.href)
    );
  }
  if (role === 'sales_manager') {
    return all.filter((l) =>
      ['/booking', '/bookings', '/checkin', '/sales', '/customers', '/reports', '/reports-analytics'].includes(l.href)
    );
  }
  return [];
}

/** Full ERP dashboard payload derived from live database rows. */
router.get('/summary', requireAuth, async (req, res) => {
  const role = req.user.role;
  const userId = req.user.userId;
  const today = new Date().toISOString().slice(0, 10);

  const include = {
    flights: userHasAnyRole(role, ['admin', 'operations', 'maintenance', 'agent', 'crew', 'customer_service', 'sales_manager']),
    operational: userHasAnyRole(role, ['admin', 'operations', 'maintenance']),
    checkin: userHasAnyRole(role, ['admin', 'operations', 'agent', 'customer_service', 'sales_manager']),
    crewRoster: userHasAnyRole(role, ['admin', 'operations']),
    finance: userHasAnyRole(role, ['admin', 'finance', 'sales_manager']),
    revenueChart: userHasAnyRole(role, ['admin', 'finance', 'sales_manager']),
    bookingPulse: userHasAnyRole(role, ['admin', 'agent', 'customer_service', 'sales_manager']),
    alerts: true
  };

  try {
    const settled = await Promise.allSettled([
      include.flights || include.operational
        ? pool.query(
            `SELECT f.id, f.flight_number, f.departure_airport, f.arrival_airport,
                f.departure_time, f.arrival_time, f.status, f.gate, f.boarding_gate,
                a.tail_number, a.model
             FROM flights f
             LEFT JOIN aircraft a ON a.id = f.aircraft_id
             WHERE DATE(f.departure_time) = DATE($1::date)
             ORDER BY f.departure_time ASC
             LIMIT 40`,
            [today]
          )
        : Promise.resolve({ rows: [] }),
      include.operational
        ? pool.query(
            `SELECT UPPER(TRIM(status)) AS status, COUNT(*)::int AS count
             FROM flights
             WHERE DATE(departure_time) = DATE($1::date)
             GROUP BY UPPER(TRIM(status))`,
            [today]
          )
        : Promise.resolve({ rows: [] }),
      include.checkin
        ? pool.query(
            `SELECT COUNT(*)::int AS c
             FROM booking_passengers bp
             JOIN booking_flights bf ON bf.booking_id = bp.booking_id
             JOIN flights f ON f.id = bf.flight_id
             WHERE DATE(f.departure_time) = DATE($1::date)`,
            [today]
          )
        : Promise.resolve({ rows: [{ c: 0 }] }),
      include.checkin
        ? pool.query(
            `SELECT COUNT(*)::int AS c
             FROM checkins c
             JOIN flights f ON f.id = c.flight_id
             WHERE DATE(f.departure_time) = DATE($1::date)`,
            [today]
          )
        : Promise.resolve({ rows: [{ c: 0 }] }),
      include.crewRoster
        ? pool.query(
            `SELECT f.flight_number, f.departure_time, u.full_name, ca.duty_role
             FROM crew_assignments ca
             JOIN flights f ON f.id = ca.flight_id
             JOIN users u ON u.id = ca.crew_user_id
             WHERE DATE(f.departure_time) = DATE($1::date)
             ORDER BY f.departure_time ASC, u.full_name ASC
             LIMIT 40`,
            [today]
          )
        : Promise.resolve({ rows: [] }),
      include.finance || userHasAnyRole(role, ['admin'])
        ? pool.query(
            `SELECT COALESCE(SUM(amount), 0)::float AS v
             FROM payments
             WHERE DATE(processed_at) = DATE($1::date)
               AND UPPER(COALESCE(payment_status, '')) NOT IN ('FAILED', 'DECLINED')`,
            [today]
          )
        : Promise.resolve({ rows: [{ v: 0 }] }),
      include.finance || userHasAnyRole(role, ['admin'])
        ? pool.query(
            `SELECT COALESCE(SUM(refund_amount), 0)::float AS v FROM refunds WHERE DATE(refunded_at) = DATE($1::date)`,
            [today]
          )
        : Promise.resolve({ rows: [{ v: 0 }] }),
      include.bookingPulse || userHasAnyRole(role, ['admin'])
        ? pool.query(`SELECT COUNT(*)::int AS c FROM bookings WHERE DATE(created_at) = DATE($1::date)`, [today])
        : Promise.resolve({ rows: [{ c: 0 }] }),
      include.bookingPulse || userHasAnyRole(role, ['admin'])
        ? pool.query(`SELECT COUNT(*)::int AS c FROM tickets WHERE DATE(issued_at) = DATE($1::date)`, [today])
        : Promise.resolve({ rows: [{ c: 0 }] }),
      include.bookingPulse || userHasAnyRole(role, ['admin'])
        ? pool.query(`SELECT COUNT(*)::int AS c FROM checkins WHERE DATE(checkin_time) = DATE($1::date)`, [today])
        : Promise.resolve({ rows: [{ c: 0 }] }),
      userHasAnyRole(role, ['admin'])
        ? pool.query(`SELECT COUNT(*)::int AS c FROM users WHERE is_active = TRUE`)
        : Promise.resolve({ rows: [{ c: 0 }] }),
      userHasAnyRole(role, ['admin']) || role === 'maintenance' || role === 'operations'
        ? pool.query(`SELECT COUNT(*)::int AS c FROM maintenance_logs WHERE status = 'OPEN'`)
        : Promise.resolve({ rows: [{ c: 0 }] }),
      include.finance || userHasAnyRole(role, ['admin'])
        ? pool.query(
            `SELECT COALESCE(SUM(amount), 0)::float AS v
             FROM payments
             WHERE DATE_TRUNC('month', processed_at) = DATE_TRUNC('month', DATE($1::date)::timestamp)
               AND UPPER(COALESCE(payment_status, '')) NOT IN ('FAILED', 'DECLINED')`,
            [today]
          )
        : Promise.resolve({ rows: [{ v: 0 }] }),
      include.finance || userHasAnyRole(role, ['admin'])
        ? pool.query(
            `SELECT COALESCE(SUM(refund_amount), 0)::float AS v
             FROM refunds
             WHERE DATE_TRUNC('month', refunded_at) = DATE_TRUNC('month', DATE($1::date)::timestamp)`,
            [today]
          )
        : Promise.resolve({ rows: [{ v: 0 }] }),
      include.finance || userHasAnyRole(role, ['admin'])
        ? pool.query(
            `SELECT COALESCE(SUM(total_amount), 0)::float AS v
             FROM bookings
             WHERE UPPER(booking_status) IN ('HOLD', 'PENDING')`
          )
        : Promise.resolve({ rows: [{ v: 0 }] }),
      include.revenueChart
        ? pool.query(
            `SELECT DATE(processed_at)::text AS d, COALESCE(SUM(amount), 0)::float AS amount
             FROM payments
             WHERE processed_at::date >= (DATE($1::date) - INTERVAL '6 days')
               AND processed_at::date <= DATE($1::date)
               AND UPPER(COALESCE(payment_status, '')) NOT IN ('FAILED', 'DECLINED')
             GROUP BY DATE(processed_at)
             ORDER BY d ASC`,
            [today]
          )
        : Promise.resolve({ rows: [] }),
      include.revenueChart
        ? pool.query(
            `SELECT payment_type, COALESCE(SUM(amount), 0)::float AS total
             FROM payments
             WHERE processed_at::date >= (DATE($1::date) - INTERVAL '6 days')
               AND processed_at::date <= DATE($1::date)
               AND UPPER(COALESCE(payment_status, '')) NOT IN ('FAILED', 'DECLINED')
             GROUP BY payment_type`,
            [today]
          )
        : Promise.resolve({ rows: [] }),
      include.alerts
        ? pool.query(
            `SELECT f.flight_number, f.departure_airport, f.arrival_airport, fd.delay_minutes, fd.reason, fd.created_at
             FROM flight_delays fd
             JOIN flights f ON f.id = fd.flight_id
             WHERE DATE(f.departure_time) = DATE($1::date)
             ORDER BY fd.created_at DESC
             LIMIT 8`,
            [today]
          )
        : Promise.resolve({ rows: [] }),
      include.alerts
        ? pool.query(
            `SELECT ml.id, ml.defect_description, ml.severity, a.tail_number, ml.opened_at
             FROM maintenance_logs ml
             JOIN aircraft a ON a.id = ml.aircraft_id
             WHERE ml.status = 'OPEN'
             ORDER BY ml.opened_at DESC
             LIMIT 6`
          )
        : Promise.resolve({ rows: [] }),
      include.alerts
        ? pool.query(
            `SELECT tail_number, model, release_status FROM aircraft WHERE UPPER(release_status) <> 'RELEASED' LIMIT 6`
          )
        : Promise.resolve({ rows: [] }),
      include.alerts
        ? pool.query(
            `SELECT mi.id, mi.inspection_type, mi.scheduled_for, a.tail_number
             FROM maintenance_inspections mi
             JOIN aircraft a ON a.id = mi.aircraft_id
             WHERE DATE(mi.scheduled_for) = DATE($1::date) AND mi.status = 'SCHEDULED'
             LIMIT 6`,
            [today]
          )
        : Promise.resolve({ rows: [] }),
      role === 'maintenance' || userHasAnyRole(role, ['admin']) || role === 'operations'
        ? pool.query(
            `SELECT COUNT(*)::int AS c
             FROM maintenance_inspections
             WHERE DATE(scheduled_for) = DATE($1::date) AND status = 'SCHEDULED'`,
            [today]
          )
        : Promise.resolve({ rows: [{ c: 0 }] }),
      role === 'maintenance' || userHasAnyRole(role, ['admin']) || role === 'operations'
        ? pool.query(`SELECT COUNT(*)::int AS c FROM aircraft WHERE UPPER(release_status) <> 'RELEASED'`)
        : Promise.resolve({ rows: [{ c: 0 }] }),
      userHasAnyRole(role, ['admin', 'agent', 'customer_service', 'sales_manager'])
        ? pool.query(
            `SELECT COUNT(*)::int AS c FROM bookings WHERE UPPER(booking_status) IN ('HOLD', 'PENDING')`
          )
        : Promise.resolve({ rows: [{ c: 0 }] }),
      role === 'crew'
        ? pool.query(
            `SELECT f.id, f.flight_number, f.departure_airport, f.arrival_airport,
                f.departure_time, f.status, ca.duty_role
             FROM crew_assignments ca
             JOIN flights f ON f.id = ca.flight_id
             WHERE ca.crew_user_id = $1 AND DATE(f.departure_time) = DATE($2::date)
             ORDER BY f.departure_time ASC`,
            [userId, today]
          )
        : Promise.resolve({ rows: [] })
    ]);

    const empty = { rows: [] };
    const q = (idx) => {
      const r = settled[idx];
      if (r.status === 'fulfilled') return r.value;
      console.warn('[dashboard/summary] query failed:', r.reason?.message || r.reason);
      return empty;
    };

    const flightsTodayRes = q(0);
    const statusBreakdownRes = q(1);
    const paxExpectedRes = q(2);
    const checkinsTodayFlightsRes = q(3);
    const crewOverviewRes = q(4);
    const paymentsTodayRes = q(5);
    const refundsTodayRes = q(6);
    const bookingsCreatedRes = q(7);
    const ticketsIssuedRes = q(8);
    const checkinsAllRes = q(9);
    const activeUsersRes = q(10);
    const openDefectsRes = q(11);
    const revenueMonthRes = q(12);
    const refundsMonthRes = q(13);
    const holdsRes = q(14);
    const revenue7dRes = q(15);
    const paymentMixRes = q(16);
    const delayedListRes = q(17);
    const mxOpenListRes = q(18);
    const aircraftHoldRes = q(19);
    const inspectionsDueRes = q(20);
    const inspectionsDueCountRes = q(21);
    const aircraftHoldCountRes = q(22);
    const holdPnrsRes = q(23);
    const myCrewFlightsRes = q(24);

    const statusMap = {};
    for (const row of statusBreakdownRes.rows) {
      statusMap[row.status || 'UNKNOWN'] = row.count;
    }

    const flights = flightsTodayRes.rows.map((r) => ({
      id: r.id,
      flightNumber: r.flight_number,
      dep: r.departure_airport,
      arr: r.arrival_airport,
      departureTime: r.departure_time,
      status: r.status,
      tail: r.tail_number,
      model: r.model
    }));

    const paxExpected = Number(paxExpectedRes.rows[0]?.c || 0);
    const checkinsOnToday = Number(checkinsTodayFlightsRes.rows[0]?.c || 0);

    const crewOverview = crewOverviewRes.rows.map((r) => ({
      flightNumber: r.flight_number,
      departureTime: r.departure_time,
      name: r.full_name,
      duty: r.duty_role
    }));

    const payToday = Number(paymentsTodayRes.rows[0]?.v || 0);
    const refToday = Number(refundsTodayRes.rows[0]?.v || 0);
    const bookingsToday = Number(bookingsCreatedRes.rows[0]?.c || 0);
    const ticketsToday = Number(ticketsIssuedRes.rows[0]?.c || 0);
    const checkinsAllToday = Number(checkinsAllRes.rows[0]?.c || 0);
    const activeUsers = Number(activeUsersRes.rows[0]?.c || 0);
    const openDefects = Number(openDefectsRes.rows[0]?.c || 0);
    const revenueMonth = Number(revenueMonthRes.rows[0]?.v || 0);
    const refundsMonth = Number(refundsMonthRes.rows[0]?.v || 0);
    const holdsOutstanding = Number(holdsRes.rows[0]?.v || 0);
    const inspectionsDueTotal = Number(inspectionsDueCountRes.rows[0]?.c || 0);
    const aircraftHoldTotal = Number(aircraftHoldCountRes.rows[0]?.c || 0);
    const holdPnrs = Number(holdPnrsRes.rows[0]?.c || 0);

    /** Executive / OCC expansion pack — extra queries are isolated so core dashboard still loads. */
    const dayWin = dateRangeToDepartureWindow(today, today);
    let lfSnap = {
      loadFactor: 0,
      totalSeatsSold: 0,
      totalSeatsAvailable: 0,
      flightLegCount: 0
    };
    try {
      lfSnap = await queryLoadFactorSnapshot(pool, dayWin.fromTs, dayWin.toExclusiveTs);
    } catch (e) {
      console.warn('[dashboard/summary] load factor snapshot:', e?.message || e);
    }

    const exS = await Promise.allSettled([
      pool.query(`SELECT COUNT(*)::int AS c FROM flights WHERE DATE(arrival_time) = DATE($1::date)`, [today]),
      pool.query(
        `SELECT COUNT(*)::int AS c
         FROM flights
         WHERE DATE(departure_time) = DATE($1::date)
           AND COALESCE(UPPER(REPLACE(TRIM(status), ' ', '_')), '') NOT LIKE '%CANCEL%'`,
        [today]
      ),
      pool.query(
        `SELECT COUNT(DISTINCT ca.flight_id)::int AS c
         FROM crew_assignments ca
         JOIN flights f ON f.id = ca.flight_id
         WHERE DATE(f.departure_time) = DATE($1::date)`,
        [today]
      ),
      pool.query(
        `SELECT COUNT(*) FILTER (WHERE COALESCE(UPPER(REPLACE(TRIM(status), ' ', '_')), '') LIKE '%DELAY%')::int AS delayed,
                COUNT(*) FILTER (WHERE COALESCE(UPPER(REPLACE(TRIM(status), ' ', '_')), '') LIKE '%CANCEL%')::int AS cancelled,
                COUNT(*)::int AS departures
         FROM flights
         WHERE DATE(departure_time) = DATE($1::date)`,
        [today]
      ),
      pool.query(
        `SELECT f.departure_airport AS o, f.arrival_airport AS d, COUNT(DISTINCT b.id)::int AS bookings
         FROM bookings b
         JOIN booking_flights bf ON bf.booking_id = b.id
         JOIN flights f ON f.id = bf.flight_id
         WHERE b.created_at::date >= (DATE($1::date) - INTERVAL '13 days')
           AND b.created_at::date <= DATE($1::date)
           AND UPPER(COALESCE(b.booking_status, '')) <> 'CANCELLED'
         GROUP BY f.departure_airport, f.arrival_airport
         ORDER BY bookings DESC
         LIMIT 6`,
        [today]
      ),
      pool.query(
        `SELECT COALESCE(SUM(CASE WHEN b.travel_agent_id IS NULL THEN p.amount ELSE 0 END), 0)::float AS direct_amt,
                COALESCE(SUM(CASE WHEN b.travel_agent_id IS NOT NULL THEN p.amount ELSE 0 END), 0)::float AS agent_amt
         FROM payments p
         JOIN bookings b ON b.id = p.booking_id
         WHERE DATE(p.processed_at) = DATE($1::date)
           AND UPPER(COALESCE(p.payment_status, '')) NOT IN ('FAILED', 'DECLINED')`,
        [today]
      ),
      pool.query(`SELECT COUNT(*)::int AS c FROM refund_requests WHERE UPPER(TRIM(status)) = 'PENDING'`),
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE UPPER(status) IN ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER'))::int AS open_cases,
           COUNT(*) FILTER (WHERE case_type = 'COMPLAINT' AND UPPER(status) IN ('OPEN', 'IN_PROGRESS'))::int AS complaints,
           COUNT(*) FILTER (WHERE case_type = 'LOST_BAGGAGE' AND UPPER(status) IN ('OPEN', 'IN_PROGRESS'))::int AS lost_bag
         FROM cs_service_cases`
      ),
      pool.query(
        `SELECT COALESCE(SUM(amount), 0)::float AS v
         FROM finance_expenses
         WHERE incurred_on::date >= DATE_TRUNC('month', DATE($1::date)::timestamp)
           AND incurred_on::date <= DATE($1::date)`,
        [today]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS c
         FROM crew_licenses
         WHERE is_active = TRUE
           AND expiry_date IS NOT NULL
           AND expiry_date <= (CURRENT_DATE + INTERVAL '60 days')
           AND expiry_date >= (CURRENT_DATE - INTERVAL '14 days')`
      ),
      pool.query(
        `SELECT COUNT(*)::int AS c, COALESCE(SUM(total_amount), 0)::float AS amt
         FROM bookings
         WHERE UPPER(TRIM(payment_status)) IN ('UNPAID', 'PARTIALLY_PAID')
           AND UPPER(TRIM(booking_status)) <> 'CANCELLED'`
      ),
      pool.query(`SELECT COUNT(*)::int AS c FROM bookings WHERE DATE(created_at) = DATE($1::date)`, [today]),
      pool.query(
        `SELECT COALESCE(SUM(amount), 0)::float AS v
         FROM payments
         WHERE DATE(processed_at) = DATE($1::date)
           AND UPPER(COALESCE(payment_status, '')) NOT IN ('FAILED', 'DECLINED')`,
        [today]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS c
         FROM flights
         WHERE DATE(departure_time) = DATE($1::date)
           AND UPPER(TRIM(status)) IN ('BOARDING', 'CHECKIN_OPEN')`,
        [today]
      ),
      pool.query(`SELECT COUNT(*)::int AS c FROM dispatch_logs WHERE DATE(dispatched_at) = DATE($1::date)`, [today]),
      pool.query(
        `SELECT COUNT(DISTINCT ca.crew_user_id)::int AS c
         FROM crew_assignments ca
         JOIN flights f ON f.id = ca.flight_id
         WHERE DATE(f.departure_time) = DATE($1::date)`,
        [today]
      ),
      pool.query(
        `SELECT COALESCE(AVG(fd.delay_minutes), 0)::float AS avg_delay,
                COUNT(*) FILTER (WHERE UPPER(COALESCE(fd.reason, '')) LIKE '%DIVERT%')::int AS diversions
         FROM flight_delays fd
         JOIN flights f ON f.id = fd.flight_id
         WHERE DATE(f.departure_time) = DATE($1::date)`,
        [today]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE UPPER(COALESCE(release_status, '')) = 'RELEASED')::int AS released
         FROM aircraft`
      ),
      pool.query(
        `SELECT DATE(f.departure_time)::text AS d,
                COUNT(*)::int AS departures,
                COUNT(*) FILTER (
                  WHERE COALESCE(UPPER(REPLACE(TRIM(f.status), ' ', '_')), '') LIKE '%DELAY%'
                )::int AS delayed,
                COUNT(*) FILTER (
                  WHERE COALESCE(UPPER(REPLACE(TRIM(f.status), ' ', '_')), '') LIKE '%CANCEL%'
                )::int AS cancelled,
                COALESCE(AVG(fd.delay_minutes), 0)::float AS avg_delay
         FROM flights f
         LEFT JOIN flight_delays fd ON fd.flight_id = f.id
         WHERE f.departure_time::date >= (DATE($1::date) - INTERVAL '6 days')
           AND f.departure_time::date <= DATE($1::date)
         GROUP BY DATE(f.departure_time)
         ORDER BY d ASC`,
        [today]
      )
    ]);

    const exRow = (idx) => {
      const r = exS[idx];
      if (r.status !== 'fulfilled' || !r.value?.rows?.[0]) {
        if (r.status === 'rejected') {
          console.warn(`[dashboard/summary] executive query[${idx}]:`, r.reason?.message || r.reason);
        }
        return {};
      }
      return r.value.rows[0];
    };

    const arrivalsToday = Number(exRow(0).c || 0);
    const activeDepartures = Number(exRow(1).c || 0);
    const crewFlightsWithRoster = Number(exRow(2).c || 0);
    const depStats = exRow(3);
    const delayedFlights = Number(depStats.delayed || 0);
    const cancelledFlights = Number(depStats.cancelled || 0);
    const departuresToday = Number(depStats.departures || flights.length || 0);
    const topRoutesRes = exS[4].status === 'fulfilled' ? exS[4].value?.rows || [] : [];
    const salesSplit = exRow(5);
    const refundQueueOpen = Number(exRow(6).c || 0);
    const csRow = exRow(7);
    const expenseMtd = Number(exRow(8).v || 0);
    const crewExpirySoon = Number(exRow(9).c || 0);
    const pendingPayRow = exRow(10);
    const pendingPaymentsCount = Number(pendingPayRow.c || 0);
    const pendingPaymentsAmount = Number(pendingPayRow.amt || 0);
    const bookingsTodayAllRoles = Number(exRow(11).c ?? bookingsToday);
    const revenueTodayRaw = exRow(12).v;
    const revenueTodayAllRoles =
      revenueTodayRaw != null && Number.isFinite(Number(revenueTodayRaw)) ? Number(revenueTodayRaw) : payToday;

    const boardingFlights = Number(exRow(13).c || 0);
    const dispatchReleases = Number(exRow(14).c || 0);
    const crewOnDuty = Number(exRow(15).c || 0);
    const delayRow = exRow(16);
    const avgDelayMinutes = Number(delayRow.avg_delay || 0);
    const diversionsToday = Number(delayRow.diversions || 0);
    const fleetRow = exRow(17);
    const aircraftTotal = Number(fleetRow.total || 0);
    const aircraftReleased = Number(fleetRow.released || 0);
    const aircraftActive = Math.max(0, Math.min(activeDepartures, aircraftReleased || activeDepartures));
    const otpTrend7d =
      exS[18]?.status === 'fulfilled' && exS[18].value?.rows ? exS[18].value.rows : [];

    const topRoutes = topRoutesRes.map((r) => ({
      route: `${r.o}→${r.d}`,
      bookings: Number(r.bookings || 0)
    }));

    const otpPct =
      departuresToday > 0 ? Math.round(((departuresToday - delayedFlights) / departuresToday) * 1000) / 10 : null;

    const crewReadinessPct =
      activeDepartures > 0 ? Math.min(100, Math.round((crewFlightsWithRoster / activeDepartures) * 1000) / 10) : null;

    const profitMarginPct =
      revenueMonth > 0
        ? Math.round(((revenueMonth - refundsMonth - expenseMtd) / revenueMonth) * 1000) / 10
        : null;

    const dailyNetCash = payToday - refToday;
    const updatedAt = new Date().toISOString();
    const loadFactorPctExec =
      lfSnap.totalSeatsAvailable > 0 ? Math.round(lfSnap.loadFactor * 1000) / 10 : null;

    const operationalIntel = buildOperationalIntel({
      flights,
      statusMap,
      delayedListRows: delayedListRes.rows,
      mxOpenListRows: mxOpenListRes.rows,
      crewExpirySoon,
      crewOverview,
      metrics: {
        departuresToday,
        arrivalsToday,
        delayedFlights,
        cancelledFlights,
        activeFlights: activeDepartures,
        boardingFlights,
        diversionsToday,
        dispatchReleases,
        crewOnDuty,
        avgDelayMinutes,
        otpPct,
        loadFactorPct: loadFactorPctExec,
        aircraftTotal,
        aircraftActive
      },
      lfSnap,
      updatedAt
    });

    const canOccPhase3 = userHasAnyRole(role, ['admin', 'super_admin', 'operations']);
    let occPhase3 = null;
    if (canOccPhase3) {
      try {
        occPhase3 = buildOccPhase3({
          flightRows: flightsTodayRes.rows,
          statusMap,
          delayedListRows: delayedListRes.rows,
          mxOpenListRows: mxOpenListRes.rows,
          aircraftHoldRows: aircraftHoldRes.rows,
          inspectionsRows: inspectionsDueRes.rows,
          metrics: {
            departuresToday,
            delayedFlights,
            cancelledFlights,
            activeFlights: activeDepartures,
            dispatchReleases,
            crewOnDuty,
            aircraftTotal,
            aircraftReleased,
            loadFactorPct: loadFactorPctExec
          },
          operationalIntel,
          revenueTrend7d: revenue7dRes.rows.map((r) => ({ date: r.d, amount: Number(r.amount) })),
          otpTrend7d,
          crewOverview,
          crewExpirySoon,
          updatedAt
        });
      } catch (occErr) {
        console.warn('[dashboard/summary] occPhase3 build failed, using demo state:', occErr?.message || occErr);
        occPhase3 = buildOccDemoPhase3(updatedAt);
      }
      if (occPhase3 && !flightsTodayRes.rows.length && !delayedListRes.rows.length) {
        occPhase3 = { ...buildOccDemoPhase3(updatedAt), ...occPhase3, demoMode: true };
      }
    }

    const executiveBoard = {
      kpis: {
        bookingsToday: bookingsTodayAllRoles,
        revenueToday: revenueTodayAllRoles,
        activeFlights: activeDepartures,
        loadFactorPct:
          lfSnap.totalSeatsAvailable > 0 ? Math.round(lfSnap.loadFactor * 1000) / 10 : null,
        checkInCompleted: checkinsOnToday,
        delayedFlights,
        cancelledFlights,
        pendingPaymentsCount,
        pendingPaymentsAmount
      },
      flightOperations: {
        departuresToday,
        arrivalsToday,
        aircraftInService: Math.max(0, activeDepartures),
        aircraftOnHold: aircraftHoldTotal,
        crewReadinessPct,
        onTimePerformancePct: otpPct,
        statusBreakdown: statusMap
      },
      salesInsight: {
        topRoutes,
        agentSales: Number(salesSplit.agent_amt || 0),
        directSales: Number(salesSplit.direct_amt || 0),
        refundRequestsOpen: refundQueueOpen,
        outstandingBalances: holdsOutstanding
      },
      customerService: {
        openCases: Number(csRow.open_cases || 0),
        complaintsOpen: Number(csRow.complaints || 0),
        lostBaggageOpen: Number(csRow.lost_bag || 0),
        refundQueueOpen: refundQueueOpen
      },
      financeInsight: {
        dailyNetCash,
        revenueTrend7d: revenue7dRes.rows.map((r) => ({ date: r.d, amount: Number(r.amount) })),
        expenseMtd,
        profitMarginPct,
        revenueMtd: revenueMonth,
        refundsMtd: refundsMonth
      },
      operationalAlertsExtra: {
        crewDocumentsExpiring: crewExpirySoon,
        pendingPaymentsCount
      },
      reportQuickLinks: [
        { label: 'Daily sales report', href: '/reports' },
        { label: 'Flight operations report', href: '/operations' },
        { label: 'Revenue & finance', href: '/finance' },
        { label: 'Passenger & bookings', href: '/bookings' }
      ],
      operationalIntel,
      occPhase3,
      occCommandCenter: occPhase3
    };

    const kpis = [];
    if (userHasAnyRole(role, ['admin'])) {
      kpis.push(
        { id: 'users', label: 'Active users', value: activeUsers, href: '/system-administration' },
        { id: 'flights', label: 'Flights today', value: flights.length, href: '/flights' },
        { id: 'defects', label: 'Open defects', value: openDefects, href: '/maintenance' },
        { id: 'revenue', label: 'Payments today (USD)', value: payToday, href: '/finance', format: 'money' },
        { id: 'hold', label: 'PNRs on hold / pending', value: holdPnrs, href: '/bookings' }
      );
    } else if (role === 'finance') {
      kpis.push(
        { id: 'pay', label: 'Payments today', value: payToday, href: '/finance', format: 'money' },
        { id: 'ref', label: 'Refunds today', value: refToday, href: '/finance', format: 'money' },
        { id: 'net', label: 'Net today', value: payToday - refToday, href: '/finance', format: 'money' },
        { id: 'month', label: 'Revenue MTD', value: revenueMonth, href: '/reports', format: 'money' }
      );
    } else if (role === 'operations') {
      kpis.push(
        { id: 'sched', label: 'Flights scheduled', value: flights.length, href: '/flights' },
        { id: 'del', label: 'Delayed', value: statusMap.DELAYED || 0, href: '/operations' },
        { id: 'pax', label: 'Passengers to board', value: paxExpected, href: '/checkin' },
        { id: 'ck', label: 'Checked in (today legs)', value: checkinsOnToday, href: '/checkin' }
      );
    } else if (role === 'agent' || role === 'customer_service' || role === 'sales_manager') {
      kpis.push(
        { id: 'bkg', label: 'Bookings today', value: bookingsToday, href: '/bookings' },
        { id: 'tix', label: 'Tickets issued', value: ticketsToday, href: '/bookings' },
        { id: 'ck', label: 'Check-ins today', value: checkinsAllToday, href: '/checkin' },
        { id: 'hold', label: 'PNRs on hold / pending', value: holdPnrs, href: '/bookings' }
      );
    } else if (role === 'crew') {
      kpis.push({
        id: 'mine',
        label: 'My flights today',
        value: myCrewFlightsRes.rows.length,
        href: '/dashboard'
      });
    } else if (role === 'maintenance') {
      kpis.push(
        { id: 'def', label: 'Open defects', value: openDefects, href: '/maintenance' },
        {
          id: 'insp',
          label: 'Inspections due today',
          value: inspectionsDueTotal,
          href: '/maintenance'
        },
        { id: 'hold', label: 'Aircraft not released', value: aircraftHoldTotal, href: '/maintenance' }
      );
    }

    const alerts = [];
    for (const d of delayedListRes.rows) {
      alerts.push({
        id: `delay-${d.flight_number}-${d.created_at}`,
        severity: 'warning',
        title: `Delay — ${d.flight_number}`,
        detail: `${d.departure_airport}→${d.arrival_airport}: ${d.delay_minutes} min — ${d.reason || 'Operational'}`,
        href: '/operations',
        time: d.created_at
      });
    }
    for (const m of mxOpenListRes.rows) {
      alerts.push({
        id: `mx-${m.id}`,
        severity: m.severity === 'AOG' || m.severity === 'CRITICAL' ? 'critical' : 'warning',
        title: `Maintenance — ${m.tail_number}`,
        detail: m.defect_description,
        href: '/maintenance',
        time: m.opened_at
      });
    }
    for (const a of aircraftHoldRes.rows) {
      alerts.push({
        id: `hold-${a.tail_number}`,
        severity: 'warning',
        title: `Aircraft hold — ${a.tail_number}`,
        detail: `${a.model} — status ${a.release_status}`,
        href: '/maintenance',
        time: null
      });
    }
    for (const i of inspectionsDueRes.rows) {
      alerts.push({
        id: `insp-${i.id}`,
        severity: 'info',
        title: `Inspection due — ${i.tail_number}`,
        detail: i.inspection_type,
        href: '/maintenance',
        time: i.scheduled_for
      });
    }
    if (pendingPaymentsCount > 0 && userHasAnyRole(role, ['admin', 'finance', 'sales_manager'])) {
      alerts.push({
        id: 'pending-payments',
        severity: 'warning',
        title: 'Payment exposure',
        detail: `${pendingPaymentsCount} booking(s) unpaid or partially paid (${pendingPaymentsAmount.toFixed(2)} USD outstanding).`,
        href: '/finance',
        time: null
      });
    }
    if (crewExpirySoon > 0 && userHasAnyRole(role, ['admin', 'operations'])) {
      alerts.push({
        id: 'crew-docs-expiry',
        severity: 'info',
        title: 'Crew credentials window',
        detail: `${crewExpirySoon} active crew license(s) in the 60-day expiry review window.`,
        href: '/crew',
        time: null
      });
    }

    const payload = {
      role,
      date: today,
      executive: executiveBoard,
      kpis,
      quickLinks: quickLinksForRole(role),
      alerts: alerts.slice(0, 12),
      todaysFlights: include.flights && role !== 'crew' ? flights : null,
      myFlights: role === 'crew' ? myCrewFlightsRes.rows : null,
      operationalSummary:
        include.operational
          ? {
              byStatus: statusMap,
              flightsCount: flights.length
            }
          : null,
      checkinStatus: include.checkin
        ? {
            passengersOnTodayFlights: paxExpected,
            checkedInOnTodayFlights: checkinsOnToday,
            outstanding: Math.max(0, paxExpected - checkinsOnToday)
          }
        : null,
      crewOverview: include.crewRoster ? crewOverview : null,
      bookingRevenue: userHasAnyRole(role, ['admin', 'finance', 'sales_manager'])
        ? {
            paymentsToday: payToday,
            refundsToday: refToday,
            bookingsToday,
            ticketsToday,
            series7d: revenue7dRes.rows.map((r) => ({ date: r.d, amount: Number(r.amount) })),
            paymentMix7d: paymentMixRes.rows.map((r) => ({ type: r.payment_type, amount: Number(r.total) }))
          }
        : null,
      financeSnapshot:
        include.finance || userHasAnyRole(role, ['admin'])
          ? {
              revenueMonth,
              refundsMonth,
              netMonth: revenueMonth - refundsMonth,
              holdsOutstanding
            }
          : null
    };

    return res.json(payload);
  } catch (error) {
    console.warn('[dashboard/summary] returning safe defaults:', error?.message || error);
    return res.status(200).json(emptyDashboardPayload(role, today));
  }
});

router.get('/:role', requireAuth, async (req, res) => {
  const targetRole = String(req.params.role || '').toLowerCase();
  if (
    !['admin', 'finance', 'operations', 'agent', 'crew', 'maintenance', 'super_admin', 'customer_service', 'sales_manager'].includes(
      targetRole
    )
  ) {
    return res.status(400).json({ message: 'Invalid role dashboard requested.' });
  }

  if (!canAccessRole(req.user.role, targetRole)) {
    return res.status(403).json({ message: 'Not authorized for this role dashboard.' });
  }

  try {
    const today = new Date().toISOString().slice(0, 10);

    if (targetRole === 'admin' || targetRole === 'super_admin') {
      const s = await Promise.allSettled([
        pool.query(`SELECT COUNT(*)::int AS count FROM users WHERE is_active = TRUE`),
        pool.query(`SELECT COUNT(*)::int AS count FROM flights WHERE DATE(departure_time) = DATE($1)`, [today]),
        pool.query(`SELECT COUNT(*)::int AS count FROM maintenance_logs WHERE status = 'OPEN'`),
        pool.query(`SELECT COALESCE(SUM(amount),0)::float AS value FROM payments`)
      ]);
      return res.json({
        role: targetRole,
        cards: [
          { label: 'Active Users', value: rowCountFromSettled(s, 0, 'admin') },
          { label: 'Flights Today', value: rowCountFromSettled(s, 1, 'admin') },
          { label: 'Open Defects', value: rowCountFromSettled(s, 2, 'admin') },
          { label: 'Total Revenue (USD)', value: rowValueFromSettled(s, 3, 'admin') }
        ]
      });
    }

    if (targetRole === 'sales_manager') {
      const s = await Promise.allSettled([
        pool.query(`SELECT COUNT(*)::int AS count FROM bookings WHERE DATE(created_at)=DATE($1)`, [today]),
        pool.query(`SELECT COALESCE(SUM(amount),0)::float AS value FROM payments WHERE DATE(processed_at)=DATE($1)`, [today])
      ]);
      return res.json({
        role: 'sales_manager',
        cards: [
          { label: 'Bookings Today', value: rowCountFromSettled(s, 0, 'sales') },
          { label: 'Payments Today (USD)', value: rowValueFromSettled(s, 1, 'sales') }
        ]
      });
    }

    if (targetRole === 'finance') {
      const s = await Promise.allSettled([
        pool.query(`SELECT COALESCE(SUM(amount),0)::float AS value FROM payments WHERE DATE(processed_at)=DATE($1)`, [today]),
        pool.query(`SELECT COALESCE(SUM(refund_amount),0)::float AS value FROM refunds WHERE DATE(refunded_at)=DATE($1)`, [today]),
        pool.query(
          `SELECT
             COALESCE((SELECT SUM(amount) FROM payments WHERE DATE(processed_at)=DATE($1)),0) -
             COALESCE((SELECT SUM(refund_amount) FROM refunds WHERE DATE(refunded_at)=DATE($1)),0)
           AS value`,
          [today]
        )
      ]);
      return res.json({
        role: 'finance',
        cards: [
          { label: 'Payments Today', value: rowValueFromSettled(s, 0, 'finance') },
          { label: 'Refunds Today', value: rowValueFromSettled(s, 1, 'finance') },
          { label: 'Net Today', value: rowValueFromSettled(s, 2, 'finance') }
        ]
      });
    }

    if (targetRole === 'operations') {
      const s = await Promise.allSettled([
        pool.query(`SELECT COUNT(*)::int AS count FROM flights WHERE DATE(departure_time)=DATE($1)`, [today]),
        pool.query(`SELECT COUNT(*)::int AS count FROM flights WHERE DATE(departure_time)=DATE($1) AND status='DELAYED'`, [today]),
        pool.query(`SELECT COUNT(*)::int AS count FROM dispatch_logs WHERE DATE(dispatched_at)=DATE($1)`, [today])
      ]);
      return res.json({
        role: 'operations',
        cards: [
          { label: 'Flights Scheduled Today', value: rowCountFromSettled(s, 0, 'ops') },
          { label: 'Delayed Flights Today', value: rowCountFromSettled(s, 1, 'ops') },
          { label: 'Dispatch Events Today', value: rowCountFromSettled(s, 2, 'ops') }
        ]
      });
    }

    if (targetRole === 'agent' || targetRole === 'customer_service') {
      const s = await Promise.allSettled([
        pool.query(`SELECT COUNT(*)::int AS count FROM bookings WHERE DATE(created_at)=DATE($1)`, [today]),
        pool.query(`SELECT COUNT(*)::int AS count FROM tickets WHERE DATE(issued_at)=DATE($1)`, [today]),
        pool.query(`SELECT COUNT(*)::int AS count FROM checkins WHERE DATE(checkin_time)=DATE($1)`, [today])
      ]);
      return res.json({
        role: targetRole,
        cards: [
          { label: 'Bookings Today', value: rowCountFromSettled(s, 0, 'agent') },
          { label: 'Tickets Issued Today', value: rowCountFromSettled(s, 1, 'agent') },
          { label: 'Check-ins Today', value: rowCountFromSettled(s, 2, 'agent') }
        ]
      });
    }

    if (targetRole === 'crew') {
      let count = 0;
      try {
        const assignedFlights = await pool.query(
          `SELECT COUNT(DISTINCT ca.flight_id)::int AS count
           FROM crew_assignments ca
           JOIN flights f ON f.id = ca.flight_id
           WHERE ca.crew_user_id = $1
             AND DATE(f.departure_time) = DATE($2)`,
          [req.user.userId, today]
        );
        count = Number(assignedFlights.rows[0]?.count ?? 0);
      } catch (e) {
        console.warn('[dashboard/crew]:', e?.message || e);
      }
      return res.json({
        role: 'crew',
        cards: [{ label: 'My Flights Today', value: count }]
      });
    }

    const s = await Promise.allSettled([
      pool.query(`SELECT COUNT(*)::int AS count FROM maintenance_logs WHERE status='OPEN'`),
      pool.query(`SELECT COUNT(*)::int AS count FROM maintenance_inspections WHERE DATE(scheduled_for)=DATE($1) AND status='SCHEDULED'`, [today]),
      pool.query(`SELECT COUNT(*)::int AS count FROM aircraft WHERE release_status <> 'RELEASED'`)
    ]);
    return res.json({
      role: 'maintenance',
      cards: [
        { label: 'Open Defects', value: rowCountFromSettled(s, 0, 'mx') },
        { label: 'Inspections Due Today', value: rowCountFromSettled(s, 1, 'mx') },
        { label: 'Aircraft Not Released', value: rowCountFromSettled(s, 2, 'mx') }
      ]
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load dashboard.', error: error.message });
  }
});

export default router;
