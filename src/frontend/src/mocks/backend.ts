import type { backendInterface } from "../backend";

// Mock data uses the canister (backend.d.ts) shape:
// - Entry uses `entryType` (not `type`)
// - Machine.number is a string (not number)
// - savedAt is bigint nanoseconds (not string ISO date)
// The sync layer (billFromCanister) maps these to frontend types.ts shape.

export const mockBackend: backendInterface = {
  createBill: async () => undefined,
  deleteBill: async () => undefined,
  deleteCustomer: async () => undefined,
  getBills: async () => [
    {
      id: "bill-001",
      customerName: "Ramesh Patil",
      customerContact: "9876543210",
      dateOfWork: "2026-05-01",
      paymentDate: "2026-05-02",
      rates: { bucket: 1200, breaker: 1700 },
      machines: [
        {
          id: "m1",
          number: "1",
          entries: [
            { id: "e1", entryType: "bucket", startTime: "08:00", endTime: "12:00" },
            { id: "e2", entryType: "breaker", startTime: "13:00", endTime: "16:00" },
          ],
        },
        {
          id: "m2",
          number: "2",
          entries: [
            { id: "e3", entryType: "bucket", startTime: "07:00", endTime: "11:30" },
          ],
        },
      ],
      bucketTotalHours: 8.5,
      bucketTotalCost: 10200,
      breakerTotalHours: 3,
      breakerTotalCost: 5100,
      grandTotal: 15300,
      amountPaid: 15300,
      paymentStatus: "PAID",
      savedAt: BigInt(Date.now() - 7 * 24 * 60 * 60 * 1000) * BigInt(1_000_000),
    },
    {
      id: "bill-002",
      customerName: "Sunil Deshmukh",
      customerContact: "9823456780",
      dateOfWork: "2026-05-03",
      paymentDate: "",
      rates: { bucket: 1200, breaker: 1700 },
      machines: [
        {
          id: "m3",
          number: "1",
          entries: [
            { id: "e4", entryType: "breaker", startTime: "09:00", endTime: "14:00" },
          ],
        },
      ],
      bucketTotalHours: 0,
      bucketTotalCost: 0,
      breakerTotalHours: 5,
      breakerTotalCost: 8500,
      grandTotal: 8500,
      amountPaid: 0,
      paymentStatus: "NOT PAID",
      savedAt: BigInt(Date.now() - 5 * 24 * 60 * 60 * 1000) * BigInt(1_000_000),
    },
    {
      id: "bill-003",
      customerName: "Ramesh Patil",
      customerContact: "9876543210",
      dateOfWork: "2026-05-05",
      paymentDate: "2026-05-06",
      rates: { bucket: 1200, breaker: 1700 },
      machines: [
        {
          id: "m4",
          number: "1",
          entries: [
            { id: "e5", entryType: "bucket", startTime: "08:00", endTime: "10:00" },
          ],
        },
      ],
      bucketTotalHours: 2,
      bucketTotalCost: 2400,
      breakerTotalHours: 0,
      breakerTotalCost: 0,
      grandTotal: 2400,
      amountPaid: 1200,
      paymentStatus: "PARTIALLY PAID",
      savedAt: BigInt(Date.now() - 2 * 24 * 60 * 60 * 1000) * BigInt(1_000_000),
    },
  ],
  getCustomers: async () => [
    { name: "Ramesh Patil", contact: "9876543210", updatedAt: BigInt(Date.now() - 7 * 24 * 60 * 60 * 1000) * BigInt(1_000_000) },
    { name: "Sunil Deshmukh", contact: "9823456780", updatedAt: BigInt(Date.now() - 5 * 24 * 60 * 60 * 1000) * BigInt(1_000_000) },
  ],
  getRates: async () => ({ bucket: 1200, breaker: 1700 }),
  getServerTime: async () => BigInt(Date.now()) * BigInt(1_000_000),
  setRates: async () => undefined,
  updateBill: async () => undefined,
  upsertCustomer: async () => undefined,
  createReminder: async () => true,
  deleteReminder: async () => true,
  getReminders: async () => [],
};
