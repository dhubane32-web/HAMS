/**
 * Branded finance report PDFs (server-generated).
 */

import { readOptionalBrandLogoPng, drawStandardDocumentHeader, drawStandardPdfFooter } from '../lib/hawanaBranding.js';
import { pdfLetterFromBuilder, buildBrandedTablePdfBuffer } from './brandedTablePdf.js';

function fmt(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x.toFixed(2) : '—';
}

/**
 * Daily finance snapshot (payments & refunds for a single calendar day).
 */
export async function buildFinanceDailyReportPdfBuffer(ctx) {
  const {
    reportDate,
    totalCollected,
    totalRefunded,
    netRevenue,
    paymentCount,
    refundCount
  } = ctx;
  const logoBuf = readOptionalBrandLogoPng();

  return pdfLetterFromBuilder((doc) => {
    const bh = drawStandardDocumentHeader(doc, 'Daily finance report', { logoBuf });
    doc.fillColor('#111').fontSize(11);
    doc.x = 48;
    doc.y = bh + 16;

    doc.font('Helvetica-Bold').text(`Report date: ${reportDate}`);
    doc.moveDown(0.75);
    doc.font('Helvetica').fontSize(10);
    doc.text(`Total collected: ${fmt(totalCollected)}`);
    doc.text(`Total refunded: ${fmt(totalRefunded)}`);
    doc.font('Helvetica-Bold').text(`Net revenue: ${fmt(netRevenue)}`);
    doc.moveDown(0.5);
    doc.font('Helvetica').text(`Payment rows (day): ${paymentCount}`);
    doc.text(`Refund rows (day): ${refundCount}`);
    doc.moveDown();
    doc.fontSize(8).fillColor('#64748b').text('Amounts reflect stored payment and refund rows for the report date.');

    drawStandardPdfFooter(doc, 48, doc.page.height - 88, doc.page.width - 96, { withLogo: true, logoBuf });
  }, { title: 'Daily finance report' });
}

/** Net collected by payment processing day. */
export async function buildFinanceDailyRevenuePdfBuffer({ from, to, series }) {
  const rows = (series || []).map((r) => [r.day, fmt(r.net_collected)]);
  return buildBrandedTablePdfBuffer({
    title: 'Daily revenue report',
    subtitles: [`Period: ${from} to ${to}`, 'Net collected = payment amount less linked refunds (by processed date).'],
    columns: [
      { label: 'Day', width: 92 },
      { label: 'Net collected', width: 120 }
    ],
    rows
  });
}

/** Cash movement: inflows and outflows by calendar day. */
export async function buildFinanceCashReportPdfBuffer({ from, to, paymentsByDay, refundsByDay }) {
  const rowsA = (paymentsByDay || []).map((r) => [
    r.day,
    fmt(r.gross_in),
    fmt(r.other_payment_rows || 0)
  ]);
  const rowsB = (refundsByDay || []).map((r) => [r.day, fmt(r.out)]);
  const blank = ['', '', ''];
  const join = [
    ['— Collections (payment rows) —', '', ''],
    ['Day', 'Paid in (est.)', 'Other status rows'],
    ...rowsA,
    blank,
    ['— Refunds issued —', '', ''],
    ['Day', 'Refunded out', ''],
    ...rowsB.map((x) => [x[0], x[1], ''])
  ];
  return buildBrandedTablePdfBuffer({
    title: 'Cash report',
    subtitles: [`Period: ${from} to ${to}`],
    columns: [
      { label: 'Day / section', width: 120 },
      { label: 'Amount 1', width: 110 },
      { label: 'Amount 2', width: 110 }
    ],
    rows: join
  });
}

/** Agent sales (bookings created by agents in range). */
export async function buildFinanceAgentSalesPdfBuffer({ from, to, agentSales }) {
  const rows = (agentSales || []).map((r) => [
    r.agent_name || '—',
    r.booking_count,
    fmt(r.booked_gross),
    fmt(r.net_payments)
  ]);
  return buildBrandedTablePdfBuffer({
    title: 'Agent sales report',
    subtitles: [`Period: ${from} to ${to}`, 'Bookings where creating user role is agent/booking_agent (finance view).'],
    columns: [
      { label: 'Agent', width: 160 },
      { label: 'Bookings', width: 70 },
      { label: 'Booked gross', width: 92 },
      { label: 'Net payments', width: 92 }
    ],
    rows
  });
}

/** Refund lines in period (finance register). */
export async function buildFinanceRefundRegisterPdfBuffer({ from, to, rows }) {
  const data = (rows || []).slice(0, 2000).map((r) => [
    String(r.refunded_at || '').slice(0, 19),
    r.pnr || '—',
    fmt(r.refund_amount)
  ]);
  return buildBrandedTablePdfBuffer({
    title: 'Refund report',
    subtitles: [`Period: ${from} to ${to}`, `Rows: ${data.length} (max 2000)`],
    columns: [
      { label: 'Refunded at', width: 130 },
      { label: 'PNR', width: 72 },
      { label: 'Amount', width: 72 }
    ],
    rows: data
  });
}

/** Expense trend rollup. */
export async function buildFinanceExpenseTrendPdfBuffer({ from, to, series }) {
  const rows = (series || []).map((r) => [r.day, r.category || '—', fmt(r.total)]);
  return buildBrandedTablePdfBuffer({
    title: 'Expense report',
    subtitles: [`Period: ${from} to ${to}`],
    columns: [
      { label: 'Day', width: 92 },
      { label: 'Category', width: 140 },
      { label: 'Total', width: 80 }
    ],
    rows
  });
}
