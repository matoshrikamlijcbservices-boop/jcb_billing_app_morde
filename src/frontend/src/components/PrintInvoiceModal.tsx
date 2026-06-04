import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { Bill } from "@/types";
import { Printer, X } from "lucide-react";
import { useEffect } from "react";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function calcHours(start: string, end: string): number {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let s = sh * 60 + sm;
  let e = eh * 60 + em;
  if (e <= s) e += 24 * 60;
  return (e - s) / 60;
}

function fmt(amount: number): string {
  return `₹${amount.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

// ─── Print Invoice Modal ──────────────────────────────────────────────────────

interface PrintInvoiceModalProps {
  bill: Bill | null;
  onClose: () => void;
}

export default function PrintInvoiceModal({
  bill,
  onClose,
}: PrintInvoiceModalProps) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  if (!bill) return null;

  const balance = Math.max(0, bill.grandTotal - bill.amountPaid);

  const statusClasses =
    bill.paymentStatus === "PAID"
      ? "bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700"
      : bill.paymentStatus === "PARTIALLY PAID"
        ? "bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700"
        : "bg-red-100 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-400 dark:border-red-700";

  return (
    <>
      {/* @media print styles injected via style tag */}
      <style>{`
        @media print {
          body > *:not(#print-invoice-overlay) { display: none !important; }
          #print-invoice-overlay { position: static !important; overflow: visible !important; }
          #print-invoice-controls { display: none !important; }
          #print-invoice-content {
            box-shadow: none !important;
            border: none !important;
            padding: 0 !important;
            max-width: 100% !important;
          }
        }
      `}</style>

      {/* Fullscreen overlay */}
      <div
        id="print-invoice-overlay"
        className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm overflow-y-auto"
        data-ocid="print.dialog"
      >
        {/* Controls bar */}
        <div
          id="print-invoice-controls"
          className="sticky top-0 z-10 bg-card border-b border-border flex items-center justify-between px-4 py-3 shadow-sm"
        >
          <div className="flex items-center gap-2">
            <Printer className="w-4 h-4 text-primary" />
            <span className="font-semibold text-sm text-foreground">
              Print Invoice — {bill.customerName || "Customer"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="bg-primary text-primary-foreground"
              onClick={() => window.print()}
              data-ocid="print.primary_button"
            >
              <Printer className="w-3.5 h-3.5 mr-1.5" />
              Print
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={onClose}
              aria-label="Close print preview"
              data-ocid="print.close_button"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Invoice Content */}
        <div className="flex justify-center py-8 px-4">
          <div
            id="print-invoice-content"
            className="w-full max-w-2xl bg-card border border-border rounded-xl shadow-md p-8 space-y-6"
          >
            {/* Header */}
            <div className="text-center space-y-1">
              <h1 className="text-xl font-bold text-foreground font-display">
                Matoshri Kamljadevi Earthmovers
              </h1>
              <p className="text-sm text-muted-foreground">
                and Land Developers
              </p>
              <p className="text-xs text-muted-foreground">
                Contact: 9890989473 (Google Pay) · 7588623501
              </p>
            </div>

            <div className="h-0.5 bg-primary rounded-full" />

            {/* Customer Info */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                ["Customer", bill.customerName || "—"],
                ["Contact", bill.customerContact || "—"],
                ["Date of Work", bill.dateOfWork || "—"],
                ["Payment Date", bill.paymentDate || "—"],
              ].map(([label, value]) => (
                <div key={label}>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-0.5">
                    {label}
                  </div>
                  <div className="text-sm font-semibold text-foreground">
                    {value}
                  </div>
                </div>
              ))}
            </div>

            <Separator />

            {/* Machines */}
            {bill.machines.map((machine) => {
              const machineTotal = machine.entries.reduce((sum, entry) => {
                const h = calcHours(entry.startTime, entry.endTime);
                return (
                  sum +
                  h *
                    (entry.type === "bucket"
                      ? bill.rates.bucket
                      : bill.rates.breaker)
                );
              }, 0);
              return (
                <div key={machine.id}>
                  <div className="text-xs font-bold text-foreground bg-primary/10 border border-primary/20 rounded px-2 py-1 inline-block mb-3">
                    Machine {machine.number}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-secondary">
                          {[
                            "Type",
                            "Start",
                            "End",
                            "Hours",
                            "Rate/hr",
                            "Cost",
                          ].map((h) => (
                            <th
                              key={h}
                              className="px-3 py-2 text-left font-semibold text-muted-foreground border border-border"
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {machine.entries.map((entry) => {
                          const h = calcHours(entry.startTime, entry.endTime);
                          const rate =
                            entry.type === "bucket"
                              ? bill.rates.bucket
                              : bill.rates.breaker;
                          return (
                            <tr key={entry.id}>
                              <td className="px-3 py-1.5 border border-border capitalize font-medium">
                                {entry.type}
                              </td>
                              <td className="px-3 py-1.5 border border-border">
                                {entry.startTime || "—"}
                              </td>
                              <td className="px-3 py-1.5 border border-border">
                                {entry.endTime || "—"}
                              </td>
                              <td className="px-3 py-1.5 border border-border">
                                {h.toFixed(2)} hrs
                              </td>
                              <td className="px-3 py-1.5 border border-border">
                                ₹{rate.toLocaleString("en-IN")}/hr
                              </td>
                              <td className="px-3 py-1.5 border border-border font-semibold">
                                {fmt(h * rate)}
                              </td>
                            </tr>
                          );
                        })}
                        <tr className="bg-secondary/50">
                          <td
                            colSpan={5}
                            className="px-3 py-1.5 border border-border font-bold text-right"
                          >
                            Machine {machine.number} Total
                          </td>
                          <td className="px-3 py-1.5 border border-border font-bold">
                            {fmt(machineTotal)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}

            <Separator />

            {/* Summary boxes */}
            <div className="grid grid-cols-2 gap-3">
              {bill.bucketTotalHours > 0 && (
                <div className="bg-secondary/50 border border-border rounded-lg px-4 py-3">
                  <div className="text-xs text-muted-foreground mb-1">
                    BUCKET — {bill.bucketTotalHours.toFixed(2)} hrs @ ₹
                    {bill.rates.bucket}/hr
                  </div>
                  <div className="font-bold text-base text-foreground">
                    {fmt(bill.bucketTotalCost)}
                  </div>
                </div>
              )}
              {bill.breakerTotalHours > 0 && (
                <div className="bg-secondary/50 border border-border rounded-lg px-4 py-3">
                  <div className="text-xs text-muted-foreground mb-1">
                    BREAKER — {bill.breakerTotalHours.toFixed(2)} hrs @ ₹
                    {bill.rates.breaker}/hr
                  </div>
                  <div className="font-bold text-base text-foreground">
                    {fmt(bill.breakerTotalCost)}
                  </div>
                </div>
              )}
            </div>

            {/* Grand Total */}
            <div className="bg-primary/10 border-2 border-primary/40 rounded-xl px-5 py-4 flex items-center justify-between">
              <span className="font-bold text-base text-foreground">
                GRAND TOTAL
              </span>
              <span className="font-extrabold text-2xl text-foreground">
                {fmt(bill.grandTotal)}
              </span>
            </div>

            {/* Payment summary */}
            <div
              className={`rounded-xl border px-5 py-4 flex items-center justify-between ${statusClasses}`}
            >
              <div className="flex gap-8">
                <div>
                  <div className="text-[10px] uppercase tracking-widest opacity-70 mb-0.5">
                    Amount Paid
                  </div>
                  <div className="font-bold">{fmt(bill.amountPaid)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest opacity-70 mb-0.5">
                    Balance Due
                  </div>
                  <div className="font-bold">{fmt(balance)}</div>
                </div>
              </div>
              <span
                className={`text-sm font-bold px-3 py-1 rounded-full border ${statusClasses}`}
              >
                {bill.paymentStatus}
              </span>
            </div>

            {/* Payment History (if any) */}
            {bill.paymentHistory && bill.paymentHistory.length > 0 && (
              <div>
                <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">
                  Payment History
                </div>
                <div className="space-y-2">
                  {bill.paymentHistory.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between text-sm bg-secondary/40 border border-border rounded-lg px-3 py-2"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-muted-foreground text-xs">
                          {entry.date}
                        </span>
                        {entry.note && (
                          <span className="text-muted-foreground text-xs italic">
                            {entry.note}
                          </span>
                        )}
                      </div>
                      <span className="font-semibold text-foreground">
                        {fmt(entry.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="text-center text-xs text-muted-foreground pt-2 border-t border-border">
              Thank you for your business!
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
