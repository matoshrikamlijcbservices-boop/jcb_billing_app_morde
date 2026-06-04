import type { Principal } from "@icp-sdk/core/principal";
export interface Some<T> {
    __kind__: "Some";
    value: T;
}
export interface None {
    __kind__: "None";
}
export type Option<T> = Some<T> | None;
export interface PaymentReminder {
    id: string;
    customerName: string;
    createdAt: bigint;
    dueDate: bigint;
    notes: string;
    billNumber: string;
    amountDue: number;
    billId: string;
}
export interface Bill {
    id: string;
    breakerTotalHours: number;
    customerName: string;
    customerContact: string;
    paymentStatus: string;
    bucketTotalHours: number;
    bucketTotalCost: number;
    amountPaid: number;
    grandTotal: number;
    paymentDate?: string;
    savedAt: bigint;
    breakerTotalCost: number;
    machines: Array<Machine>;
    rates: Rates;
    dateOfWork: string;
}
export interface Entry {
    id: string;
    startTime: string;
    entryType: string;
    endTime: string;
}
export interface Rates {
    bucket: number;
    breaker: number;
}
export interface Customer {
    contact: string;
    name: string;
    updatedAt: bigint;
}
export interface Machine {
    id: string;
    entries: Array<Entry>;
    number: string;
}
export interface backendInterface {
    createBill(bill: Bill): Promise<void>;
    createReminder(reminder: PaymentReminder): Promise<boolean>;
    deleteBill(id: string): Promise<void>;
    deleteCustomer(nameContact: string): Promise<void>;
    deleteReminder(id: string): Promise<boolean>;
    getBills(): Promise<Array<Bill>>;
    getCustomers(): Promise<Array<Customer>>;
    getRates(): Promise<Rates | null>;
    getReminders(): Promise<Array<PaymentReminder>>;
    getServerTime(): Promise<bigint>;
    setRates(r: Rates): Promise<void>;
    updateBill(bill: Bill): Promise<void>;
    upsertCustomer(customer: Customer): Promise<void>;
}
