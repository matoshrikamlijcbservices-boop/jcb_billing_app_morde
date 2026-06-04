// ─── localStorage utility functions for JCB Billing App ────────────────────

import type { Bill, Customer, Rates } from "@/types";

const LS_CUSTOMERS = "jcb_customers";
const LS_RATES = "jcb_rates";
const LS_SAVED_BILLS = "jcb_bills";
const LS_THEME = "jcb_theme";

export const DEFAULT_RATES: Rates = { breaker: 1700, bucket: 1200 };

// ─── Customers ───────────────────────────────────────────────────────────────

export function loadCustomers(): Customer[] {
  try {
    return JSON.parse(localStorage.getItem(LS_CUSTOMERS) || "[]");
  } catch {
    return [];
  }
}

export function saveCustomers(customers: Customer[]): void {
  localStorage.setItem(LS_CUSTOMERS, JSON.stringify(customers));
}

export function upsertCustomer(customer: Customer): void {
  const existing = loadCustomers();
  const idx = existing.findIndex(
    (c) => c.name.toLowerCase() === customer.name.toLowerCase(),
  );
  if (idx >= 0) existing[idx] = customer;
  else existing.push(customer);
  saveCustomers(existing);
}

// ─── Rates ───────────────────────────────────────────────────────────────────

export function loadRates(): Rates {
  try {
    const r = JSON.parse(localStorage.getItem(LS_RATES) || "null");
    return r || DEFAULT_RATES;
  } catch {
    return DEFAULT_RATES;
  }
}

export function saveRates(rates: Rates): void {
  localStorage.setItem(LS_RATES, JSON.stringify(rates));
}

// ─── Bills ───────────────────────────────────────────────────────────────────

export function loadBills(): Bill[] {
  try {
    return JSON.parse(localStorage.getItem(LS_SAVED_BILLS) || "[]");
  } catch {
    return [];
  }
}

export function saveBills(bills: Bill[]): void {
  localStorage.setItem(LS_SAVED_BILLS, JSON.stringify(bills));
}

export function appendBill(bill: Bill): void {
  const existing = loadBills();
  existing.push(bill);
  saveBills(existing);
}

export function deleteBill(id: string): void {
  saveBills(loadBills().filter((b) => b.id !== id));
}

export function updateBill(id: string, patch: Partial<Bill>): void {
  saveBills(loadBills().map((b) => (b.id === id ? { ...b, ...patch } : b)));
}

// ─── Dark Mode ───────────────────────────────────────────────────────────────

export function loadDarkMode(): boolean {
  const saved = localStorage.getItem(LS_THEME);
  return saved ? saved === "dark" : false;
}

export function saveDarkMode(isDark: boolean): void {
  localStorage.setItem(LS_THEME, isDark ? "dark" : "light");
}

// ─── Pending ops queue (for offline support) ──────────────────────────────────────────────

export const LS_PENDING_SYNC = "jcb_pendingSync";

export function setPendingSync(pending: boolean): void {
  if (pending) localStorage.setItem(LS_PENDING_SYNC, "true");
  else localStorage.removeItem(LS_PENDING_SYNC);
}

export function hasPendingSync(): boolean {
  return localStorage.getItem(LS_PENDING_SYNC) === "true";
}
