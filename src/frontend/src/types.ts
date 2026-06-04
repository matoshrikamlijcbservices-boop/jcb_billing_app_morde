// ─── Shared TypeScript types for JCB Billing App ───────────────────────────

export interface Customer {
  name: string;
  contact: string;
  updatedAt?: number; // timestamp (ms) when last edited — used for Drive merge
}

export interface Rates {
  breaker: number;
  bucket: number;
}

export interface Entry {
  id: string;
  type: "bucket" | "breaker";
  startTime: string;
  endTime: string;
}

export interface Machine {
  id: string;
  number: number;
  entries: Entry[];
}

export interface PaymentEntry {
  id: string;
  date: string;
  amount: number;
  note?: string;
}

export type PaymentStatus = "NOT PAID" | "PARTIALLY PAID" | "PAID";

export interface Bill {
  id: string;
  savedAt: string;
  customerName: string;
  customerContact: string;
  dateOfWork: string;
  paymentDate?: string;
  rates: Rates;
  machines: Machine[];
  amountPaid: number;
  grandTotal: number;
  bucketTotalHours: number;
  bucketTotalCost: number;
  breakerTotalHours: number;
  breakerTotalCost: number;
  paymentStatus: PaymentStatus;
  paymentHistory?: PaymentEntry[];
}

// Canister sync status — replaces Google Drive CloudConfig/SyncStatus
export interface PaymentReminder {
  id: string;
  billId: string;
  billNumber: string;
  customerName: string;
  amountDue: number;
  dueDate: number;
  notes: string;
  createdAt: number;
}

export interface CanisterSyncStatus {
  status: "idle" | "syncing" | "success" | "error";
  lastSynced: Date | null;
  error: string | null;
}
