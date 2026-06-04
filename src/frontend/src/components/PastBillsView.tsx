import PrintInvoiceModal from "@/components/PrintInvoiceModal";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  buildExportFilename,
  downloadBatchAsPDF,
  downloadBatchAsPNG,
  downloadBatchAsSeparatePDFs,
  downloadBillAsPDF,
  downloadBillAsPNG,
} from "@/lib/exportBill";
import { deleteBill, loadBills, updateBill } from "@/lib/storage";
import type { Bill, PaymentEntry, PaymentStatus } from "@/types";
import jsPDF from "jspdf";
import {
  Bell,
  Building2,
  Check,
  ChevronDown,
  ChevronUp,
  FileImage,
  FileText,
  Filter,
  Pencil,
  Plus,
  Printer,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().split("T")[0];
}

function calculateHours(start: string, end: string): number {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let startMin = sh * 60 + sm;
  let endMin = eh * 60 + em;
  if (endMin <= startMin) endMin += 24 * 60;
  return (endMin - startMin) / 60;
}

function formatCurrency(amount: number): string {
  return `₹${amount.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function formatHours(h: number): string {
  return h.toFixed(2);
}

function deriveStatus(
  paid: number,
  total: number,
): "NOT PAID" | "PARTIALLY PAID" | "PAID" {
  if (paid <= 0) return "NOT PAID";
  if (paid >= total) return "PAID";
  return "PARTIALLY PAID";
}

function getBillPrintHtml(bill: Bill): string {
  const {
    customerName,
    customerContact,
    dateOfWork,
    paymentDate,
    rates,
    machines,
    amountPaid,
    grandTotal,
    bucketTotalHours,
    bucketTotalCost,
    breakerTotalHours,
    breakerTotalCost,
    paymentStatus,
  } = bill;

  const statusColor =
    paymentStatus === "PAID"
      ? "#166534"
      : paymentStatus === "PARTIALLY PAID"
        ? "#92400e"
        : "#991b1b";
  const statusBg =
    paymentStatus === "PAID"
      ? "#dcfce7"
      : paymentStatus === "PARTIALLY PAID"
        ? "#fef3c7"
        : "#fee2e2";

  const machinesHtml = machines
    .map((machine) => {
      const machineTotal = machine.entries.reduce((sum, entry) => {
        const h = calculateHours(entry.startTime, entry.endTime);
        return (
          sum + h * (entry.type === "bucket" ? rates.bucket : rates.breaker)
        );
      }, 0);
      const rows = machine.entries
        .map((entry) => {
          const h = calculateHours(entry.startTime, entry.endTime);
          const rate = entry.type === "bucket" ? rates.bucket : rates.breaker;
          return `<tr>
        <td style="padding:6px 10px;border:1px solid #e5e7eb;font-weight:600;text-transform:capitalize">${entry.type}</td>
        <td style="padding:6px 10px;border:1px solid #e5e7eb">${entry.startTime || "\u2014"}</td>
        <td style="padding:6px 10px;border:1px solid #e5e7eb">${entry.endTime || "\u2014"}</td>
        <td style="padding:6px 10px;border:1px solid #e5e7eb">${formatHours(h)} hrs</td>
        <td style="padding:6px 10px;border:1px solid #e5e7eb">\u20b9${rate.toLocaleString("en-IN")}</td>
        <td style="padding:6px 10px;border:1px solid #e5e7eb;font-weight:700">${formatCurrency(h * rate)}</td>
      </tr>`;
        })
        .join("");
      return `<div style="margin-bottom:20px">
      <div style="font-size:13px;font-weight:700;color:#1f2937;margin-bottom:8px;background:#f9fafb;padding:6px 12px;border-radius:4px;display:inline-block">Machine ${machine.number}</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:#fef3c7">
          ${["Type", "Start", "End", "Hours", "Rate/hr", "Cost"].map((h) => `<th style="padding:6px 10px;border:1px solid #e5e7eb;text-align:left;font-weight:600">${h}</th>`).join("")}
        </tr></thead>
        <tbody>${rows}
          <tr style="background:#f9fafb">
            <td colspan="5" style="padding:6px 10px;border:1px solid #e5e7eb;font-weight:700;text-align:right">Machine ${machine.number} Total</td>
            <td style="padding:6px 10px;border:1px solid #e5e7eb;font-weight:700">${formatCurrency(machineTotal)}</td>
          </tr>
        </tbody>
      </table>
    </div>`;
    })
    .join("");

  const summaryBoxes = [
    bucketTotalHours > 0
      ? `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:10px 14px"><div style="font-size:11px;color:#6b7280;margin-bottom:4px">BUCKET \u2014 ${formatHours(bucketTotalHours)} hrs @ \u20b9${rates.bucket}/hr</div><div style="font-weight:700;font-size:16px">${formatCurrency(bucketTotalCost)}</div></div>`
      : "",
    breakerTotalHours > 0
      ? `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:10px 14px"><div style="font-size:11px;color:#6b7280;margin-bottom:4px">BREAKER \u2014 ${formatHours(breakerTotalHours)} hrs @ \u20b9${rates.breaker}/hr</div><div style="font-weight:700;font-size:16px">${formatCurrency(breakerTotalCost)}</div></div>`
      : "",
  ]
    .filter(Boolean)
    .join("");

  return `<!DOCTYPE html><html><head>
    <meta charset="UTF-8">
    <title>JCB Bill - ${customerName || "Bill"}</title>
    <style>
      * { margin:0; padding:0; box-sizing:border-box; }
      body { font-family:Arial,sans-serif; font-size:13px; color:#111827; background:#fff; }
      .page { width:800px; padding:40px; margin:0 auto; }
      @media print { body { -webkit-print-color-adjust:exact; print-color-adjust:exact; } }
    </style>
  </head><body><div class="page">
    <div style="text-align:center;margin-bottom:24px">
      <div style="font-size:20px;font-weight:700;color:#111827;margin-bottom:6px">Matoshri Kamljadevi Earthmovers and Land Developers</div>
      <div style="font-size:13px;color:#4b5563">Contact: 9890989473 (Google Pay) &nbsp;|&nbsp; 7588623501</div>
    </div>
    <div style="border-top:3px solid #d97706;margin-bottom:20px"></div>
    <div style="display:flex;gap:40px;margin-bottom:20px;flex-wrap:wrap">
      ${[
        ["Customer Name", customerName || "-"],
        ["Contact", customerContact || "-"],
        ["Date of Work", dateOfWork || "-"],
        ["Payment Date", paymentDate || "-"],
      ]
        .map(
          ([l, v]) =>
            `<div><div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px">${l}</div><div style="font-weight:600">${v}</div></div>`,
        )
        .join("")}
    </div>
    <div style="border-top:1px solid #e5e7eb;margin-bottom:20px"></div>
    ${machinesHtml}
    <div style="border-top:1px solid #e5e7eb;margin:10px 0 16px"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">${summaryBoxes}</div>
    <div style="background:#fffbeb;border:2px solid #d97706;border-radius:8px;padding:14px 20px;display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <div style="font-weight:700;font-size:16px">GRAND TOTAL</div>
      <div style="font-weight:800;font-size:22px">${formatCurrency(grandTotal)}</div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 16px;background:${statusBg};border-radius:8px;border:1px solid ${statusColor}">
      <div style="display:flex;gap:32px">
        <div><div style="font-size:11px;color:#6b7280;margin-bottom:2px">AMOUNT PAID</div><div style="font-weight:700">${formatCurrency(amountPaid)}</div></div>
        <div><div style="font-size:11px;color:#6b7280;margin-bottom:2px">BALANCE</div><div style="font-weight:700">${formatCurrency(Math.max(0, grandTotal - amountPaid))}</div></div>
      </div>
      <div style="font-weight:700;font-size:14px;color:${statusColor};padding:6px 14px;border-radius:20px;border:1px solid ${statusColor};background:${statusBg}">${paymentStatus}</div>
    </div>
  </div></body></html>`;
}

// ─── Reminder storage ──────────────────────────────────────────────────────────

const LS_REMINDERS = "jcb_payment_reminders";

interface PaymentReminder {
  billId: string;
  reminderDate: string;
  note: string;
}

function loadReminders(): PaymentReminder[] {
  try {
    return JSON.parse(localStorage.getItem(LS_REMINDERS) || "[]");
  } catch {
    return [];
  }
}

function saveReminders(reminders: PaymentReminder[]): void {
  localStorage.setItem(LS_REMINDERS, JSON.stringify(reminders));
}

// ─── Payment history PDF export ─────────────────────────────────────────────

function exportPaymentHistoryAsPDF(bill: Bill): void {
  const history = bill.paymentHistory ?? [];
  const pdf = new jsPDF({
    orientation: "p",
    unit: "mm",
    format: "a4",
    compress: true,
  });
  const MARGIN = 14;
  const PAGE_W = 210;
  let y = MARGIN;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.setTextColor(17, 24, 39);
  pdf.text(
    "Matoshri Kamljadevi Earthmovers and Land Developers",
    PAGE_W / 2,
    y + 6,
    { align: "center" },
  );
  y += 10;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.setTextColor(107, 114, 128);
  pdf.text("Contact: 9890989473 (Google Pay) | 7588623501", PAGE_W / 2, y + 4, {
    align: "center",
  });
  y += 8;
  pdf.setDrawColor(217, 119, 6);
  pdf.setLineWidth(0.7);
  pdf.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 6;

  pdf.setFillColor(249, 250, 251);
  pdf.setDrawColor(229, 231, 235);
  pdf.setLineWidth(0.3);
  pdf.roundedRect(MARGIN, y, PAGE_W - MARGIN * 2, 20, 2, 2, "FD");
  pdf.setFontSize(7);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(107, 114, 128);
  pdf.text("CUSTOMER", MARGIN + 4, y + 5);
  pdf.text("DATE OF WORK", MARGIN + 70, y + 5);
  pdf.text("GRAND TOTAL", MARGIN + 120, y + 5);
  pdf.text("STATUS", MARGIN + 160, y + 5);
  pdf.setFontSize(9);
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(17, 24, 39);
  pdf.text(bill.customerName || "-", MARGIN + 4, y + 13);
  pdf.text(bill.dateOfWork || "-", MARGIN + 70, y + 13);
  pdf.text(
    `\u20b9${(bill.grandTotal || 0).toLocaleString("en-IN")}`,
    MARGIN + 120,
    y + 13,
  );
  pdf.text(bill.paymentStatus || "-", MARGIN + 160, y + 13);
  y += 26;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.setTextColor(17, 24, 39);
  pdf.text("Payment History", MARGIN, y + 5);
  y += 10;

  if (history.length === 0) {
    pdf.setFont("helvetica", "italic");
    pdf.setFontSize(9);
    pdf.setTextColor(107, 114, 128);
    pdf.text("No payment records found.", MARGIN, y + 5);
  } else {
    const COL_WIDTHS = [10, 38, 40, 90];
    const COL_LABELS = ["#", "Date", "Amount", "Note"];
    const TABLE_W = COL_WIDTHS.reduce((s, w) => s + w, 0);
    const ROW_H = 8;
    const HEADER_H = 9;

    pdf.setFillColor(254, 243, 199);
    pdf.rect(MARGIN, y, TABLE_W, HEADER_H, "F");
    pdf.setDrawColor(217, 119, 6);
    pdf.setLineWidth(0.3);
    let hx = MARGIN;
    for (const w of COL_WIDTHS) {
      pdf.rect(hx, y, w, HEADER_H, "S");
      hx += w;
    }
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7);
    pdf.setTextColor(146, 64, 14);
    let lx = MARGIN;
    for (let i = 0; i < COL_LABELS.length; i++) {
      pdf.text(COL_LABELS[i], lx + COL_WIDTHS[i] / 2, y + HEADER_H / 2 + 1.8, {
        align: "center",
      });
      lx += COL_WIDTHS[i];
    }
    y += HEADER_H;

    let runningTotal = 0;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    for (let i = 0; i < history.length; i++) {
      const entry = history[i];
      runningTotal += entry.amount;
      const bg: [number, number, number] =
        i % 2 === 0 ? [255, 255, 255] : [250, 250, 250];
      pdf.setFillColor(...bg);
      pdf.rect(MARGIN, y, TABLE_W, ROW_H, "F");
      pdf.setDrawColor(229, 231, 235);
      pdf.setLineWidth(0.2);
      let rx = MARGIN;
      for (const w of COL_WIDTHS) {
        pdf.rect(rx, y, w, ROW_H, "S");
        rx += w;
      }
      pdf.setTextColor(17, 24, 39);
      const cells = [
        String(i + 1),
        entry.date || "-",
        `\u20b9${entry.amount.toLocaleString("en-IN")}`,
        entry.note || "-",
      ];
      const aligns: Array<"center" | "left" | "right"> = [
        "center",
        "center",
        "right",
        "left",
      ];
      let cx = MARGIN;
      for (let ci = 0; ci < cells.length; ci++) {
        const tx =
          aligns[ci] === "right"
            ? cx + COL_WIDTHS[ci] - 1.5
            : aligns[ci] === "center"
              ? cx + COL_WIDTHS[ci] / 2
              : cx + 1.5;
        pdf.text(cells[ci], tx, y + ROW_H / 2 + 1.8, { align: aligns[ci] });
        cx += COL_WIDTHS[ci];
      }
      y += ROW_H;
    }

    const totalH = ROW_H + 2;
    pdf.setFillColor(255, 251, 235);
    pdf.rect(MARGIN, y, TABLE_W, totalH, "F");
    pdf.setDrawColor(217, 119, 6);
    pdf.setLineWidth(0.4);
    let sx = MARGIN;
    for (const w of COL_WIDTHS) {
      pdf.rect(sx, y, w, totalH, "S");
      sx += w;
    }
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7.5);
    pdf.setTextColor(146, 64, 14);
    pdf.text(
      "TOTAL PAID",
      MARGIN + COL_WIDTHS[0] + COL_WIDTHS[1] / 2,
      y + totalH / 2 + 1.8,
      { align: "center" },
    );
    pdf.setTextColor(22, 101, 52);
    pdf.text(
      `\u20b9${runningTotal.toLocaleString("en-IN")}`,
      MARGIN + COL_WIDTHS[0] + COL_WIDTHS[1] + COL_WIDTHS[2] - 1.5,
      y + totalH / 2 + 1.8,
      { align: "right" },
    );
    const remaining = Math.max(0, bill.grandTotal - runningTotal);
    if (remaining > 0) {
      y += totalH + 6;
      pdf.setTextColor(185, 28, 28);
      pdf.setFontSize(8);
      pdf.text(
        `Outstanding Balance: \u20b9${remaining.toLocaleString("en-IN")}`,
        MARGIN,
        y + 3,
      );
    }
  }

  const safeName = (bill.customerName || "Bill")
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 30);
  pdf.save(`payment-history-${safeName}-${bill.dateOfWork || today()}.pdf`);
  toast.success("Payment history exported as PDF!");
}

// ─── Payment Reminder Modal ──────────────────────────────────────────────────

interface PaymentReminderModalProps {
  bill: Bill | null;
  onClose: () => void;
}

function PaymentReminderModal({ bill, onClose }: PaymentReminderModalProps) {
  const [reminderDate, setReminderDate] = useState(() => today());
  const [note, setNote] = useState("");
  const [existingReminder, setExistingReminder] = useState<{
    reminderDate: string;
    note: string;
  } | null>(null);

  useEffect(() => {
    if (!bill) return;
    setReminderDate(today());
    setNote("");
    const reminders = loadReminders();
    const existing = reminders.find((r) => r.billId === bill.id);
    if (existing) {
      setExistingReminder({
        reminderDate: existing.reminderDate,
        note: existing.note,
      });
      setReminderDate(existing.reminderDate);
      setNote(existing.note);
    } else {
      setExistingReminder(null);
    }
  }, [bill]);

  const handleSave = useCallback(() => {
    if (!bill) return;
    const reminders = loadReminders().filter((r) => r.billId !== bill.id);
    reminders.push({ billId: bill.id, reminderDate, note: note.trim() });
    saveReminders(reminders);
    toast.success(`Reminder set for ${reminderDate}!`);
    onClose();
  }, [bill, reminderDate, note, onClose]);

  const handleRemove = useCallback(() => {
    if (!bill) return;
    const reminders = loadReminders().filter((r) => r.billId !== bill.id);
    saveReminders(reminders);
    toast.success("Reminder removed.");
    onClose();
  }, [bill, onClose]);

  return (
    <Dialog open={!!bill} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm" data-ocid="reminder.dialog">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <Bell className="w-4 h-4 text-primary" />
            Schedule Payment Reminder
          </DialogTitle>
        </DialogHeader>
        {bill && (
          <div className="space-y-4">
            <div className="bg-secondary/50 rounded-lg p-3 space-y-1 text-sm">
              <div className="font-semibold">
                {bill.customerName || "\u2014"}
              </div>
              <div className="text-muted-foreground text-xs">
                {bill.dateOfWork} &middot; Outstanding:{" "}
                <strong className="text-red-600 dark:text-red-400">
                  \u20b9
                  {Math.max(
                    0,
                    bill.grandTotal - bill.amountPaid,
                  ).toLocaleString("en-IN")}
                </strong>
              </div>
            </div>
            {existingReminder && (
              <div className="flex items-center gap-2 text-xs bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg px-3 py-2 text-amber-700 dark:text-amber-400">
                <Bell className="w-3.5 h-3.5 shrink-0" />
                <span>
                  Reminder already set for{" "}
                  <strong>{existingReminder.reminderDate}</strong>
                </span>
              </div>
            )}
            <div>
              <Label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
                Reminder Date
              </Label>
              <Input
                type="date"
                value={reminderDate}
                onChange={(e) => setReminderDate(e.target.value)}
                min={today()}
                data-ocid="reminder.input"
              />
            </div>
            <div>
              <Label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
                Note (optional)
              </Label>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Call before payment due"
                data-ocid="reminder.input"
              />
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                className="flex-1 bg-primary text-primary-foreground"
                onClick={handleSave}
                data-ocid="reminder.confirm_button"
              >
                <Bell className="w-4 h-4 mr-2" /> Set Reminder
              </Button>
              {existingReminder && (
                <Button
                  variant="destructive"
                  onClick={handleRemove}
                  data-ocid="reminder.delete_button"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
              <Button
                variant="outline"
                onClick={onClose}
                data-ocid="reminder.cancel_button"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Due Reminders Alert ────────────────────────────────────────────────────

function DueRemindersAlert({ bills }: { bills: Bill[] }) {
  const [dismissed, setDismissed] = useState(false);
  const todayStr = today();

  const dueReminders = loadReminders().filter(
    (r) => r.reminderDate <= todayStr && bills.find((b) => b.id === r.billId),
  );

  if (dueReminders.length === 0 || dismissed) return null;

  return (
    <div
      className="flex items-start gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-xl p-4 mb-2"
      data-ocid="reminders.alert"
    >
      <Bell className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-1">
          {dueReminders.length} Payment Reminder
          {dueReminders.length !== 1 ? "s" : ""} Due
        </div>
        <div className="space-y-1">
          {dueReminders.map((r) => {
            const bill = bills.find((b) => b.id === r.billId);
            if (!bill) return null;
            return (
              <div
                key={r.billId}
                className="text-xs text-amber-700 dark:text-amber-400"
              >
                <span className="font-medium">{bill.customerName}</span> — due{" "}
                {r.reminderDate}
                {r.note && (
                  <span className="text-amber-600 dark:text-amber-500">
                    {" "}
                    ({r.note})
                  </span>
                )}{" "}
                — Outstanding:{" "}
                <strong>
                  \u20b9
                  {Math.max(
                    0,
                    bill.grandTotal - bill.amountPaid,
                  ).toLocaleString("en-IN")}
                </strong>
              </div>
            );
          })}
        </div>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="text-amber-600 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-200 p-1 rounded"
        aria-label="Dismiss reminders"
        data-ocid="reminders.close_button"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

// ─── Payment Badge ─────────────────────────────────────────────────────────────

function PaymentBadge({ status }: { status: PaymentStatus }) {
  if (status === "PAID")
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-700 border border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700">
        \u2713 PAID
      </span>
    );
  if (status === "PARTIALLY PAID")
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700">
        \u25d0 PARTIAL
      </span>
    );
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700 border border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-700">
      \u2715 NOT PAID
    </span>
  );
}

// ─── BillCard ───────────────────────────────────────────────────────────────────

function BillCard({
  children,
  className = "",
}: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`bg-card border border-border rounded-xl shadow-sm p-5 ${className}`}
    >
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-4">
      {children}
    </h2>
  );
}

// ─── Revenue Stats ───────────────────────────────────────────────────────────────

function RevenueStats({ bills }: { bills: Bill[] }) {
  const totalRevenue = bills.reduce((s, b) => s + b.grandTotal, 0);
  const totalPaidAmount = bills.reduce((s, b) => s + b.amountPaid, 0);
  const totalOutstanding = bills.reduce(
    (s, b) => s + Math.max(0, b.grandTotal - b.amountPaid),
    0,
  );
  return (
    <div
      className="grid grid-cols-2 sm:grid-cols-4 gap-3"
      data-ocid="pastbills.section"
    >
      {[
        {
          label: "Total Bills",
          val: String(bills.length),
          color: "text-foreground",
        },
        {
          label: "Total Revenue",
          val: formatCurrency(totalRevenue),
          color: "text-foreground",
        },
        {
          label: "Total Paid",
          val: formatCurrency(totalPaidAmount),
          color: "text-green-600 dark:text-green-400",
        },
        {
          label: "Outstanding",
          val: formatCurrency(totalOutstanding),
          color: "text-red-600 dark:text-red-400",
        },
      ].map(({ label, val, color }) => (
        <BillCard key={label} className="!p-4 text-center">
          <div className={`text-lg font-bold truncate ${color}`}>{val}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
        </BillCard>
      ))}
    </div>
  );
}

// ─── Edit Payment Modal ─────────────────────────────────────────────────────────

interface EditPaymentModalProps {
  bill: Bill | null;
  onClose: () => void;
  onSaved: () => void;
  canisterUpdateBill?: (bill: Bill) => void;
}

function EditPaymentModal({
  bill,
  onClose,
  onSaved,
  canisterUpdateBill,
}: EditPaymentModalProps) {
  const [amountPaid, setAmountPaid] = useState("");
  const [paymentDate, setPaymentDate] = useState("");

  useEffect(() => {
    if (bill) {
      setAmountPaid(String(bill.amountPaid));
      setPaymentDate(bill.paymentDate || today());
    }
  }, [bill]);

  const handleSave = useCallback(() => {
    if (!bill) return;
    const paid = Number.parseFloat(amountPaid) || 0;
    const newStatus = deriveStatus(paid, bill.grandTotal);
    const patch = { amountPaid: paid, paymentDate, paymentStatus: newStatus };
    updateBill(bill.id, patch);
    const updatedBill: Bill = { ...bill, ...patch };
    canisterUpdateBill?.(updatedBill);
    toast.success("Payment updated!");
    onClose();
    setTimeout(() => onSaved(), 0);
  }, [bill, amountPaid, paymentDate, canisterUpdateBill, onClose, onSaved]);

  return (
    <Dialog open={!!bill} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm" data-ocid="payment.dialog">
        <DialogHeader>
          <DialogTitle className="font-display">Edit Payment</DialogTitle>
        </DialogHeader>
        {bill && (
          <div className="space-y-4">
            <div className="bg-secondary/50 rounded-lg p-3 space-y-1 text-sm">
              <div className="font-semibold">
                {bill.customerName || "\u2014"}
              </div>
              <div className="text-muted-foreground text-xs">
                {bill.dateOfWork} &middot; Grand Total:{" "}
                <strong className="text-foreground">
                  {formatCurrency(bill.grandTotal)}
                </strong>
              </div>
            </div>
            <div>
              <Label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
                Amount Paid (\u20b9)
              </Label>
              <Input
                type="number"
                value={amountPaid}
                onChange={(e) => setAmountPaid(e.target.value)}
                placeholder="0"
                min="0"
                data-ocid="payment.input"
              />
            </div>
            <div>
              <Label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
                Payment Date
              </Label>
              <Input
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                data-ocid="payment.input"
              />
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                className="flex-1 bg-primary text-primary-foreground"
                onClick={handleSave}
                data-ocid="payment.confirm_button"
              >
                <Check className="w-4 h-4 mr-2" /> Save Payment
              </Button>
              <Button
                variant="outline"
                onClick={onClose}
                data-ocid="payment.cancel_button"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Delete Confirm Modal ──────────────────────────────────────────────────

function DeleteConfirmModal({
  open,
  onConfirm,
  onCancel,
}: { open: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-xs" data-ocid="delete.dialog">
        <DialogHeader>
          <DialogTitle className="font-display text-destructive">
            Delete Bill?
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          This action cannot be undone. The bill will be permanently removed
          from device storage.
        </p>
        <div className="flex gap-2 pt-2">
          <Button
            variant="destructive"
            className="flex-1"
            onClick={onConfirm}
            data-ocid="delete.confirm_button"
          >
            <Trash2 className="w-4 h-4 mr-2" /> Delete
          </Button>
          <Button
            variant="outline"
            className="flex-1"
            onClick={onCancel}
            data-ocid="delete.cancel_button"
          >
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Bill Row ───────────────────────────────────────────────────────────────────

interface BillRowProps {
  bill: Bill;
  idx: number;
  isSelected: boolean;
  isExpanded: boolean;
  isExporting: boolean;
  onSelect: () => void;
  onToggleExpand: () => void;
  onEditPayment: () => void;
  onDelete: () => void;
  onExportPNG: () => void;
  onExportPDF: () => void;
  onPrint: () => void;
  onAddPaymentEntry: (entry: PaymentEntry) => void;
  onScheduleReminder: () => void;
}

function BillRow({
  bill,
  idx,
  isSelected,
  isExpanded,
  isExporting,
  onSelect,
  onToggleExpand,
  onEditPayment,
  onDelete,
  onExportPNG,
  onExportPDF,
  onPrint,
  onAddPaymentEntry,
  onScheduleReminder,
}: BillRowProps) {
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [newPayDate, setNewPayDate] = useState(today());
  const [newPayAmount, setNewPayAmount] = useState("");
  const [newPayNote, setNewPayNote] = useState("");

  const handleAddPaymentSave = () => {
    const amount = Number.parseFloat(newPayAmount) || 0;
    if (amount <= 0) return;
    const entry: PaymentEntry = {
      id: `${Date.now()}-${idx}`,
      date: newPayDate,
      amount,
      note: newPayNote.trim() || undefined,
    };
    onAddPaymentEntry(entry);
    setShowAddPayment(false);
    setNewPayAmount("");
    setNewPayNote("");
    setNewPayDate(today());
  };

  const history = bill.paymentHistory ?? [];

  return (
    <div
      className="bg-card border border-border rounded-xl overflow-hidden shadow-sm"
      data-ocid={`pastbills.item.${idx + 1}`}
    >
      <div className="flex items-start gap-3 p-4">
        <Checkbox
          checked={isSelected}
          onCheckedChange={onSelect}
          className="mt-0.5"
          data-ocid={`pastbills.checkbox.${idx + 1}`}
        />
        <div className="flex-1 min-w-0 flex flex-col gap-2">
          {/* Row 1: customer info — always full width, no overflow */}
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span className="font-bold text-sm text-foreground truncate min-w-0 max-w-[160px] sm:max-w-none">
              {bill.customerName || "\u2014"}
            </span>
            {bill.customerContact && (
              <span className="text-xs text-muted-foreground truncate">
                {bill.customerContact}
              </span>
            )}
            <PaymentBadge status={bill.paymentStatus} />
          </div>
          {/* Row 2: action buttons — 2-column grid, no overlap on mobile */}
          <div className="grid grid-cols-2 gap-1.5">
            {/* Pay button */}
            <Button
              size="sm"
              variant="outline"
              className="text-xs h-8 px-2 border-primary/40 text-primary hover:bg-primary/10 font-semibold w-full justify-center"
              onClick={onEditPayment}
              data-ocid={`pastbills.edit_button.${idx + 1}`}
            >
              <Pencil className="w-3 h-3 mr-1" />
              Pay
            </Button>
            {/* Export PNG */}
            <Button
              size="sm"
              variant="outline"
              className="text-xs h-8 px-2 w-full justify-center"
              onClick={onExportPNG}
              disabled={isExporting}
              title="Export as PNG"
              aria-label="Export as PNG"
              data-ocid={`pastbills.primary_button.${idx + 1}`}
            >
              <FileImage className="w-3.5 h-3.5 mr-1" />
              PNG
            </Button>
            {/* Export PDF */}
            <Button
              size="sm"
              variant="outline"
              className="text-xs h-8 px-2 w-full justify-center"
              onClick={onExportPDF}
              disabled={isExporting}
              title="Export as PDF"
              aria-label="Export as PDF"
              data-ocid={`pastbills.secondary_button.${idx + 1}`}
            >
              <FileText className="w-3.5 h-3.5 mr-1" />
              PDF
            </Button>
            {/* Print */}
            <Button
              size="sm"
              variant="outline"
              className="text-xs h-8 px-2 border-primary/30 text-primary hover:bg-primary/10 w-full justify-center"
              onClick={onPrint}
              title="Print Invoice"
              aria-label="Print Invoice"
              data-ocid={`pastbills.print_button.${idx + 1}`}
            >
              <Printer className="w-3.5 h-3.5 mr-1" />
              Print
            </Button>
            {/* Reminder — only for unpaid bills */}
            {bill.paymentStatus !== "PAID" ? (
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-8 px-2 border-amber-400/60 text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-900/20 w-full justify-center"
                onClick={onScheduleReminder}
                title="Schedule payment reminder"
                aria-label="Schedule payment reminder"
                data-ocid={`pastbills.reminder_button.${idx + 1}`}
              >
                <Bell className="w-3 h-3 mr-1" />
                Remind
              </Button>
            ) : (
              <div />
            )}
            {/* Delete */}
            <Button
              size="sm"
              variant="outline"
              className="text-xs h-8 px-2 text-destructive border-destructive/30 hover:bg-destructive/10 w-full justify-center"
              onClick={onDelete}
              title="Delete bill"
              aria-label="Delete bill"
              data-ocid={`pastbills.delete_button.${idx + 1}`}
            >
              <Trash2 className="w-3.5 h-3.5 mr-1" />
              Delete
            </Button>
            {/* Toggle expand — spans both columns */}
            <Button
              size="sm"
              variant="ghost"
              className="col-span-2 h-7 w-full text-xs text-muted-foreground"
              onClick={onToggleExpand}
              title={isExpanded ? "Collapse" : "Expand"}
              aria-label={isExpanded ? "Collapse details" : "Expand details"}
              data-ocid={`pastbills.toggle.${idx + 1}`}
            >
              {isExpanded ? (
                <>
                  <ChevronUp className="w-4 h-4 mr-1" />
                  Collapse
                </>
              ) : (
                <>
                  <ChevronDown className="w-4 h-4 mr-1" />
                  Details
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {isExpanded && (
        <div className="border-t border-border p-4 bg-secondary/20">
          <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">
            Machine Details
          </div>
          {bill.machines.length === 0 ? (
            <p className="text-xs text-muted-foreground">No machine entries.</p>
          ) : (
            bill.machines.map((machine) => {
              const machineTotal = machine.entries.reduce((sum, entry) => {
                const h = calculateHours(entry.startTime, entry.endTime);
                return (
                  sum +
                  h *
                    (entry.type === "bucket"
                      ? bill.rates.bucket
                      : bill.rates.breaker)
                );
              }, 0);
              return (
                <div key={machine.id} className="mb-4">
                  <div className="text-xs font-semibold text-foreground bg-primary/10 border border-primary/20 rounded px-2 py-1 mb-2 inline-block">
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
                            "Rate",
                            "Cost",
                          ].map((h) => (
                            <th
                              key={h}
                              className="px-3 py-1.5 text-left font-semibold text-muted-foreground border border-border"
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {machine.entries.map((entry) => {
                          const h = calculateHours(
                            entry.startTime,
                            entry.endTime,
                          );
                          const rate =
                            entry.type === "bucket"
                              ? bill.rates.bucket
                              : bill.rates.breaker;
                          return (
                            <tr key={entry.id}>
                              <td className="px-3 py-1.5 border border-border font-semibold capitalize">
                                {entry.type}
                              </td>
                              <td className="px-3 py-1.5 border border-border">
                                {entry.startTime || "\u2014"}
                              </td>
                              <td className="px-3 py-1.5 border border-border">
                                {entry.endTime || "\u2014"}
                              </td>
                              <td className="px-3 py-1.5 border border-border">
                                {formatHours(h)} hrs
                              </td>
                              <td className="px-3 py-1.5 border border-border">
                                \u20b9{rate.toLocaleString("en-IN")}/hr
                              </td>
                              <td className="px-3 py-1.5 border border-border font-semibold">
                                {formatCurrency(h * rate)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex justify-end mt-1">
                    <span className="text-xs font-bold">
                      Machine Total: {formatCurrency(machineTotal)}
                    </span>
                  </div>
                </div>
              );
            })
          )}
          <Separator className="my-3" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            {[
              {
                label: "Bucket Hours",
                val: `${formatHours(bill.bucketTotalHours)} hrs`,
              },
              {
                label: "Bucket Cost",
                val: formatCurrency(bill.bucketTotalCost),
              },
              {
                label: "Breaker Hours",
                val: `${formatHours(bill.breakerTotalHours)} hrs`,
              },
              {
                label: "Breaker Cost",
                val: formatCurrency(bill.breakerTotalCost),
              },
            ].map(({ label, val }) => (
              <div key={label} className="bg-secondary rounded px-3 py-2">
                <div className="text-muted-foreground mb-0.5">{label}</div>
                <div className="font-bold">{val}</div>
              </div>
            ))}
          </div>

          {/* Payment History */}
          <Separator className="my-4" />
          <div
            className="space-y-3"
            data-ocid={`pastbills.payment_history.${idx + 1}`}
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Payment History
                {history.length > 0 && (
                  <span className="ml-2 text-foreground">
                    ({history.length})
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {history.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-7 px-2 border-primary/30 text-primary hover:bg-primary/10"
                    onClick={() => exportPaymentHistoryAsPDF(bill)}
                    title="Export payment history as PDF"
                    data-ocid={`pastbills.export_history_button.${idx + 1}`}
                  >
                    <FileText className="w-3.5 h-3.5 mr-1" />
                    Export PDF
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-7 px-2 border-primary/30 text-primary hover:bg-primary/10"
                  onClick={() => setShowAddPayment((v) => !v)}
                  data-ocid={`pastbills.add_payment_button.${idx + 1}`}
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Add Payment
                </Button>
              </div>
            </div>

            {/* Inline Add Payment Form */}
            {showAddPayment && (
              <div className="bg-secondary/30 border border-border rounded-lg p-3 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label
                      htmlFor={`pay-date-${idx}`}
                      className="text-xs font-semibold text-muted-foreground block mb-1"
                    >
                      Date
                    </label>
                    <input
                      id={`pay-date-${idx}`}
                      type="date"
                      value={newPayDate}
                      onChange={(e) => setNewPayDate(e.target.value)}
                      className="w-full h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                      data-ocid={`pastbills.payment_date_input.${idx + 1}`}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor={`pay-amount-${idx}`}
                      className="text-xs font-semibold text-muted-foreground block mb-1"
                    >
                      Amount (\u20b9)
                    </label>
                    <input
                      id={`pay-amount-${idx}`}
                      type="number"
                      min="0"
                      value={newPayAmount}
                      onChange={(e) => setNewPayAmount(e.target.value)}
                      placeholder="0"
                      className="w-full h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                      data-ocid={`pastbills.payment_amount_input.${idx + 1}`}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor={`pay-note-${idx}`}
                      className="text-xs font-semibold text-muted-foreground block mb-1"
                    >
                      Note (optional)
                    </label>
                    <input
                      id={`pay-note-${idx}`}
                      type="text"
                      value={newPayNote}
                      onChange={(e) => setNewPayNote(e.target.value)}
                      placeholder="e.g. Cash payment"
                      className="w-full h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                      data-ocid={`pastbills.payment_note_input.${idx + 1}`}
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="text-xs h-7 bg-primary text-primary-foreground"
                    onClick={handleAddPaymentSave}
                    disabled={
                      !newPayAmount || Number.parseFloat(newPayAmount) <= 0
                    }
                    data-ocid={`pastbills.payment_save_button.${idx + 1}`}
                  >
                    <Check className="w-3.5 h-3.5 mr-1" /> Save
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-7"
                    onClick={() => {
                      setShowAddPayment(false);
                      setNewPayAmount("");
                      setNewPayNote("");
                    }}
                    data-ocid={`pastbills.payment_cancel_button.${idx + 1}`}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* History list */}
            {history.length === 0 && !showAddPayment ? (
              <p
                className="text-xs text-muted-foreground italic"
                data-ocid={`pastbills.payment_empty.${idx + 1}`}
              >
                No payment records yet.
              </p>
            ) : (
              <div className="space-y-1.5">
                {history.map((entry, ei) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between text-xs bg-secondary/40 border border-border rounded-lg px-3 py-2"
                    data-ocid={`pastbills.payment_entry.${idx + 1}.${ei + 1}`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-muted-foreground shrink-0">
                        {entry.date}
                      </span>
                      {entry.note && (
                        <span className="text-muted-foreground italic truncate">
                          {entry.note}
                        </span>
                      )}
                    </div>
                    <span className="font-semibold text-foreground shrink-0 ml-2">
                      {formatCurrency(entry.amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PastBillsView ─────────────────────────────────────────────────────────────

interface PastBillsViewProps {
  onRefreshNeeded?: () => void;
  canisterDeleteBill?: (id: string) => void;
  canisterUpdateBill?: (bill: Bill) => void;
  pauseSync?: () => void;
  resumeSync?: () => void;
}

export default function PastBillsView({
  onRefreshNeeded,
  canisterDeleteBill,
  canisterUpdateBill,
  pauseSync,
  resumeSync,
}: PastBillsViewProps) {
  const [bills, setBills] = useState<Bill[]>(() => [...loadBills()].reverse());
  const [searchName, setSearchName] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filterStatus, setFilterStatus] = useState<
    "ALL" | "NOT PAID" | "PARTIALLY PAID" | "PAID"
  >("ALL");

  // Stable refs for UI state — survive polling re-renders
  const expandedIdsRef = useRef<Set<string>>(new Set());
  const selectedIdsRef = useRef<Set<string>>(new Set());
  // Render mirrors — updated only on user interaction, never by polling
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [exportingBillIds, setExportingBillIds] = useState<Set<string>>(
    new Set(),
  );
  const [isBatchExporting, setIsBatchExporting] = useState(false);
  const [editPaymentBill, setEditPaymentBill] = useState<Bill | null>(null);
  const [deleteBillId, setDeleteBillId] = useState<string | null>(null);
  const [printBill, setPrintBill] = useState<Bill | null>(null);
  const [reminderBill, setReminderBill] = useState<Bill | null>(null);

  // ── Pause sync whenever the user has active selections or open modals ──────
  // We track the previous "is active" state to avoid mismatched pause/resume calls.
  const wasActiveRef = useRef(false);
  const isActive =
    selectedIds.size > 0 ||
    !!editPaymentBill ||
    !!deleteBillId ||
    !!printBill ||
    !!reminderBill;

  useEffect(() => {
    if (isActive && !wasActiveRef.current) {
      pauseSync?.();
      wasActiveRef.current = true;
    } else if (!isActive && wasActiveRef.current) {
      resumeSync?.();
      wasActiveRef.current = false;
    }
  }, [isActive, pauseSync, resumeSync]);

  // Resume on unmount in case component is removed while active
  useEffect(() => {
    return () => {
      if (wasActiveRef.current) {
        resumeSync?.();
        wasActiveRef.current = false;
      }
    };
  }, [resumeSync]);

  // Merge-update: only replace bill objects whose data actually changed.
  // This preserves React reconciliation so existing row components stay stable.
  const refreshBills = useCallback(() => {
    const fresh = [...loadBills()].reverse();
    setBills((prev) => {
      const prevMap = new Map(prev.map((b) => [b.id, b]));
      let changed = fresh.length !== prev.length;
      const next = fresh.map((b) => {
        const existing = prevMap.get(b.id);
        if (!existing) {
          changed = true;
          return b;
        }
        if (JSON.stringify(existing) !== JSON.stringify(b)) {
          changed = true;
          return b;
        }
        return existing; // same reference => React skips re-render for this row
      });
      return changed ? next : prev; // same array ref if nothing changed
    });
  }, []);

  const handleAddPaymentEntry = useCallback(
    (billId: string, entry: PaymentEntry) => {
      const bill = bills.find((b) => b.id === billId);
      if (!bill) return;
      const updatedHistory = [entry, ...(bill.paymentHistory ?? [])];
      // Auto-calculate amountPaid as sum of all payment history entries
      const totalFromHistory = updatedHistory.reduce(
        (sum, e) => sum + e.amount,
        0,
      );
      const newStatus = deriveStatus(totalFromHistory, bill.grandTotal);
      updateBill(billId, {
        paymentHistory: updatedHistory,
        amountPaid: totalFromHistory,
        paymentStatus: newStatus,
      });
      canisterUpdateBill?.({
        ...bill,
        paymentHistory: updatedHistory,
        amountPaid: totalFromHistory,
        paymentStatus: newStatus,
      });
      refreshBills();
      toast.success(
        `Payment record added! Total paid: \u20b9${totalFromHistory.toLocaleString("en-IN")} — Status: ${newStatus}`,
      );
    },
    [bills, refreshBills, canisterUpdateBill],
  );

  const filteredBills = bills.filter((b) => {
    if (
      searchName.trim() &&
      !b.customerName.toLowerCase().includes(searchName.trim().toLowerCase())
    )
      return false;
    if (filterFrom && b.dateOfWork < filterFrom) return false;
    if (filterTo && b.dateOfWork > filterTo) return false;
    if (filterStatus !== "ALL" && b.paymentStatus !== filterStatus)
      return false;
    return true;
  });

  const clearFilters = () => {
    setSearchName("");
    setFilterFrom("");
    setFilterTo("");
    setFilterStatus("ALL");
  };

  const toggleExpand = (id: string) => {
    const next = new Set(expandedIdsRef.current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expandedIdsRef.current = next;
    setExpandedIds(new Set(next));
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIdsRef.current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selectedIdsRef.current = next;
    setSelectedIds(new Set(next));
  };

  const selectAll = () => {
    const next = new Set(filteredBills.map((b) => b.id));
    selectedIdsRef.current = next;
    setSelectedIds(new Set(next));
  };
  const deselectAll = () => {
    selectedIdsRef.current = new Set();
    setSelectedIds(new Set());
  };

  const confirmDelete = (id: string) => setDeleteBillId(id);

  const handleDeleteConfirmed = () => {
    if (!deleteBillId) return;
    deleteBill(deleteBillId);
    canisterDeleteBill?.(deleteBillId);
    refreshBills();
    const next = new Set(selectedIdsRef.current);
    next.delete(deleteBillId);
    selectedIdsRef.current = next;
    setSelectedIds(new Set(next));
    setDeleteBillId(null);
    toast.success("Bill deleted");
    onRefreshNeeded?.();
  };

  const handleExportSingle = async (bill: Bill, format: "png" | "pdf") => {
    setExportingBillIds((prev) => new Set(prev).add(bill.id));
    try {
      const html = getBillPrintHtml(bill);
      const filename = buildExportFilename(
        bill.customerName,
        bill.dateOfWork,
        format,
      );
      if (format === "png") {
        await downloadBillAsPNG(html, filename, bill);
        toast.success("Bill downloaded as PNG!");
      } else {
        await downloadBillAsPDF(html, filename, bill);
        toast.success("Bill downloaded as PDF!");
      }
    } catch (e) {
      toast.error("Export failed. Please try again.");
      console.error(e);
    } finally {
      setExportingBillIds((prev) => {
        const n = new Set(prev);
        n.delete(bill.id);
        return n;
      });
    }
  };

  const handleBatchExport = async (format: "png" | "pdf" | "pdf-separate") => {
    const selected = bills.filter((b) => selectedIds.has(b.id));
    if (selected.length === 0) {
      toast.error("No bills selected. Please check at least one bill first.");
      return;
    }
    setIsBatchExporting(true);
    try {
      if (format === "png") {
        const count = await downloadBatchAsPNG(selected, (done, total) => {
          void done;
          void total;
        });
        toast.success(
          `Downloaded ${count} customer image${count !== 1 ? "s" : ""} (grouped by customer)!`,
        );
      } else if (format === "pdf") {
        await downloadBatchAsPDF(selected);
        toast.success(
          `Downloaded single PDF with all ${selected.length} bill${
            selected.length !== 1 ? "s" : ""
          } grouped by customer!`,
        );
      } else {
        const count = await downloadBatchAsSeparatePDFs(
          selected,
          (done, total) => {
            void done;
            void total;
          },
        );
        toast.success(
          `Downloaded ${count} separate PDF${count !== 1 ? "s" : ""} (one per customer)!`,
        );
      }
    } catch (e) {
      toast.error("Batch export failed. Please try again.");
      console.error(e);
    } finally {
      setIsBatchExporting(false);
    }
  };

  return (
    <div className="space-y-5">
      <EditPaymentModal
        bill={editPaymentBill}
        onClose={() => setEditPaymentBill(null)}
        onSaved={refreshBills}
        canisterUpdateBill={canisterUpdateBill}
      />
      <DeleteConfirmModal
        open={!!deleteBillId}
        onConfirm={handleDeleteConfirmed}
        onCancel={() => setDeleteBillId(null)}
      />
      <PrintInvoiceModal bill={printBill} onClose={() => setPrintBill(null)} />
      <PaymentReminderModal
        bill={reminderBill}
        onClose={() => setReminderBill(null)}
      />

      {/* Due reminders alert */}
      <DueRemindersAlert bills={bills} />

      {/* Stats Row */}
      <RevenueStats bills={bills} />

      {/* Filters */}
      <BillCard>
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <SectionTitle>Filters</SectionTitle>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
          <div>
            <Label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
              Customer Name
            </Label>
            <Input
              data-ocid="pastbills.search_input"
              placeholder="Search by name..."
              value={searchName}
              onChange={(e) => setSearchName(e.target.value)}
              className="text-sm"
            />
          </div>
          <div>
            <Label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
              From Date
            </Label>
            <Input
              data-ocid="pastbills.input"
              type="date"
              value={filterFrom}
              onChange={(e) => setFilterFrom(e.target.value)}
              className="text-sm"
            />
          </div>
          <div>
            <Label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
              To Date
            </Label>
            <Input
              data-ocid="pastbills.input"
              type="date"
              value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)}
              className="text-sm"
            />
          </div>
          <div>
            <Label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
              Payment Status
            </Label>
            <Select
              value={filterStatus}
              onValueChange={(v) =>
                setFilterStatus(
                  v as "ALL" | "NOT PAID" | "PARTIALLY PAID" | "PAID",
                )
              }
            >
              <SelectTrigger data-ocid="pastbills.select" className="text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Statuses</SelectItem>
                <SelectItem value="NOT PAID">Not Paid</SelectItem>
                <SelectItem value="PARTIALLY PAID">Partially Paid</SelectItem>
                <SelectItem value="PAID">Paid</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={clearFilters}
          data-ocid="pastbills.secondary_button"
          className="text-xs"
        >
          <X className="w-3.5 h-3.5 mr-1.5" />
          Clear Filters
        </Button>
      </BillCard>

      {/* Bills List */}
      {filteredBills.length === 0 ? (
        <div
          className="border-2 border-dashed border-border rounded-xl p-12 text-center"
          data-ocid="pastbills.empty_state"
        >
          <Building2 className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm font-medium text-muted-foreground">
            {bills.length === 0
              ? "No bills saved yet."
              : "No bills match the filters."}
          </p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            {bills.length === 0
              ? "Create your first bill in the New Bill tab."
              : "Try adjusting or clearing your filters."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Batch toolbar */}
          <div className="flex flex-wrap items-center gap-2 bg-secondary/40 border border-border rounded-xl px-4 py-2.5">
            <span className="text-xs font-semibold text-muted-foreground">
              {selectedIds.size} selected
            </span>
            <Button
              size="sm"
              variant="outline"
              className="text-xs h-7"
              onClick={selectAll}
              data-ocid="pastbills.primary_button"
            >
              Select All
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-xs h-7"
              onClick={deselectAll}
              data-ocid="pastbills.secondary_button"
            >
              Deselect All
            </Button>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button
                size="sm"
                className="text-xs h-7 bg-primary text-primary-foreground"
                onClick={() => handleBatchExport("png")}
                disabled={isBatchExporting || selectedIds.size === 0}
                title={
                  selectedIds.size === 0
                    ? "Select bills first"
                    : `Export ${selectedIds.size} bill(s) as PNG`
                }
                data-ocid="pastbills.primary_button"
              >
                <FileImage className="w-3.5 h-3.5 mr-1.5" />
                {isBatchExporting
                  ? "Exporting..."
                  : `Batch PNG (${selectedIds.size})`}
              </Button>
              <Button
                size="sm"
                className="text-xs h-7 bg-primary text-primary-foreground"
                onClick={() => handleBatchExport("pdf")}
                disabled={isBatchExporting || selectedIds.size === 0}
                title={
                  selectedIds.size === 0
                    ? "Select bills first"
                    : "Download all selected bills in one PDF file"
                }
                data-ocid="pastbills.secondary_button"
              >
                <FileText className="w-3.5 h-3.5 mr-1.5" />
                {isBatchExporting
                  ? "Exporting..."
                  : `Single PDF (${selectedIds.size})`}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-7 border-primary/40 text-primary hover:bg-primary/10"
                onClick={() => handleBatchExport("pdf-separate")}
                disabled={isBatchExporting || selectedIds.size === 0}
                title={
                  selectedIds.size === 0
                    ? "Select bills first"
                    : "Download one PDF per customer"
                }
                data-ocid="pastbills.secondary_button"
              >
                <FileText className="w-3.5 h-3.5 mr-1.5" />
                {isBatchExporting
                  ? "Exporting..."
                  : `Separate PDFs (${selectedIds.size})`}
              </Button>
            </div>
          </div>

          {filteredBills.map((bill, idx) => (
            <BillRow
              key={bill.id}
              bill={bill}
              idx={idx}
              isSelected={selectedIds.has(bill.id)}
              isExpanded={expandedIds.has(bill.id)}
              isExporting={exportingBillIds.has(bill.id)}
              onSelect={() => toggleSelect(bill.id)}
              onToggleExpand={() => toggleExpand(bill.id)}
              onEditPayment={() => setEditPaymentBill(bill)}
              onDelete={() => confirmDelete(bill.id)}
              onExportPNG={() => handleExportSingle(bill, "png")}
              onExportPDF={() => handleExportSingle(bill, "pdf")}
              onPrint={() => setPrintBill(bill)}
              onAddPaymentEntry={(entry) =>
                handleAddPaymentEntry(bill.id, entry)
              }
              onScheduleReminder={() => setReminderBill(bill)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
