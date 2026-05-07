// Renders an EodSectionsPayload as Slack mrkdwn. Pure — no I/O. Output must
// remain byte-identical with the legacy inline buildMessage; see
// scripts/verify-eod-parity.mts for the regression check.

import { formatKES, formatUSD } from '@/lib/utils/currency';
import type { EodSectionsPayload } from '@/lib/eod/sections';

function fxRate(rate: number): string {
  return new Intl.NumberFormat('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rate);
}

export function renderEodSlackMessage(
  payload: EodSectionsPayload,
  sender: string,
  sentAtEat: string,
): string {
  const [expenses, withdrawals, cashReceived, budgetActions] = payload.sections;

  let msg = `*IO Finance — End of Day Report*\n`;
  msg += `${payload.header.reportDateFormatted} | Prepared by: ${sender}\n\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  msg += `*${expenses.title}*\n`;
  if (expenses.rows.length === 0) {
    msg += `_${expenses.emptyState}_\n`;
  } else {
    for (const r of expenses.rows) {
      msg += `• ${r.project} — ${r.category} — ${formatKES(r.amountKes)} — ${r.description}\n`;
    }
    msg += `_Total: ${formatKES(expenses.totals.kes)}_\n`;
  }
  msg += `\n`;

  msg += `*${withdrawals.title}*\n`;
  if (withdrawals.rows.length === 0) {
    msg += `_${withdrawals.emptyState}_\n`;
  } else {
    for (const r of withdrawals.rows) {
      msg += `• ${r.director} — ${formatUSD(r.amountUsd)} @ ${fxRate(r.exchangeRate)} = ${formatKES(r.amountKes)} — ${r.forexBureau}\n`;
    }
    msg += `_Total: ${formatUSD(withdrawals.totals.usd)} (${formatKES(withdrawals.totals.kes)})_\n`;
  }
  msg += `\n`;

  msg += `*${cashReceived.title}*\n`;
  if (cashReceived.rows.length === 0) {
    msg += `_${cashReceived.emptyState}_\n`;
  } else {
    for (const r of cashReceived.rows) {
      msg += `• ${r.project} — ${r.invoiceNumber} — ${formatUSD(r.amountUsd)} (${formatKES(r.amountKes)}) — Ref: ${r.reference}\n`;
    }
    msg += `_Total: ${formatUSD(cashReceived.totals.usd)} (${formatKES(cashReceived.totals.kes)})_\n`;
  }
  msg += `\n`;

  msg += `*${budgetActions.title}*\n`;
  if (budgetActions.rows.length === 0) {
    msg += `_${budgetActions.emptyState}_\n`;
  } else {
    for (const r of budgetActions.rows) {
      msg += `• ${r.scope} — ${r.statusLabel}\n`;
    }
  }
  msg += `\n`;

  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `Sent by ${sender} at ${sentAtEat} EAT`;

  return msg;
}
