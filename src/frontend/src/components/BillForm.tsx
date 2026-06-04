import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  buildExportFilename,
  downloadBillAsPDF,
  downloadBillAsPNG,
} from "@/lib/exportBill";
import {
  DEFAULT_RATES,
  appendBill,
  loadCustomers,
  loadRates,
  saveRates,
  upsertCustomer,
} from "@/lib/storage";
import type { Bill, Customer, Entry, Machine, Rates } from "@/types";
import {
  ChevronRight,
  FileImage,
  FileText,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function genId(): string {
  return Math.random().toString(36).slice(2);
}

function todayStr(): string {
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

function createMachine(num: number): Machine {
  return { id: genId(), number: num, entries: [] };
}

// ─── Export ───────────────────────────────────────────────────────────────────

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

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionCard({
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-4">
      {children}
    </h3>
  );
}

function PaymentStatusBadge({
  status,
}: { status: "NOT PAID" | "PARTIALLY PAID" | "PAID" }) {
  if (status === "PAID")
    return (
      <Badge className="bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700 font-bold">
        ✓ PAID
      </Badge>
    );
  if (status === "PARTIALLY PAID")
    return (
      <Badge className="bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700 font-bold">
        ◐ PARTIAL
      </Badge>
    );
  return (
    <Badge className="bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-700 font-bold">
      ✕ NOT PAID
    </Badge>
  );
}

// ─── Entry Row ────────────────────────────────────────────────────────────────

interface EntryRowProps {
  entry: Entry;
  rate: number;
  entryIndex: number;
  machineIndex: number;
  onUpdateStart: (v: string) => void;
  onUpdateEnd: (v: string) => void;
  onRemove: () => void;
}

function EntryRow({
  entry,
  rate,
  entryIndex,
  machineIndex,
  onUpdateStart,
  onUpdateEnd,
  onRemove,
}: EntryRowProps) {
  const hours = calculateHours(entry.startTime, entry.endTime);
  const cost = hours * rate;
  const ocidPrefix = `billform.machine.${machineIndex}.entry.${entryIndex}`;

  return (
    <div
      className="flex flex-wrap items-center gap-2 p-3 bg-secondary/40 rounded-lg border border-border/50 group"
      data-ocid={ocidPrefix}
    >
      <span
        className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
        style={{
          background:
            entry.type === "bucket"
              ? "oklch(0.76 0.18 85 / 0.15)"
              : "oklch(0.6 0.118 185 / 0.15)",
          color:
            entry.type === "bucket"
              ? "oklch(0.55 0.18 85)"
              : "oklch(0.4 0.118 185)",
        }}
      >
        {entry.type}
      </span>
      <div className="flex items-center gap-1.5">
        <Label className="text-[10px] font-semibold text-muted-foreground w-8">
          Start
        </Label>
        <Input
          type="time"
          value={entry.startTime}
          onChange={(e) => onUpdateStart(e.target.value)}
          className="h-7 text-xs w-[110px]"
          data-ocid={`${ocidPrefix}.start_input`}
        />
      </div>
      <div className="flex items-center gap-1.5">
        <Label className="text-[10px] font-semibold text-muted-foreground w-6">
          End
        </Label>
        <Input
          type="time"
          value={entry.endTime}
          onChange={(e) => onUpdateEnd(e.target.value)}
          className="h-7 text-xs w-[110px]"
          data-ocid={`${ocidPrefix}.end_input`}
        />
      </div>
      <ChevronRight className="w-3 h-3 text-muted-foreground/40" />
      <span className="text-xs font-semibold text-muted-foreground">
        {formatHours(hours)} hrs
      </span>
      {hours > 0 && (
        <>
          <span className="text-xs text-muted-foreground/60">→</span>
          <span className="text-xs font-bold text-primary">
            {formatCurrency(cost)}
          </span>
        </>
      )}
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-6 w-6 text-destructive hover:bg-destructive/10 ml-auto opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={onRemove}
        aria-label="Remove entry"
        data-ocid={`${ocidPrefix}.delete_button`}
      >
        <Trash2 className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}

// ─── Machine Card ─────────────────────────────────────────────────────────────

interface MachineCardProps {
  machine: Machine;
  machineIndex: number;
  rates: Rates;
  canRemove: boolean;
  onRemoveMachine: () => void;
  onAddEntry: (type: "bucket" | "breaker") => void;
  onRemoveEntry: (entryId: string) => void;
  onUpdateEntry: (
    entryId: string,
    field: "startTime" | "endTime",
    value: string,
  ) => void;
}

function MachineCard({
  machine,
  machineIndex,
  rates,
  canRemove,
  onRemoveMachine,
  onAddEntry,
  onRemoveEntry,
  onUpdateEntry,
}: MachineCardProps) {
  const machineTotal = machine.entries.reduce((sum, entry) => {
    const h = calculateHours(entry.startTime, entry.endTime);
    return sum + h * (entry.type === "bucket" ? rates.bucket : rates.breaker);
  }, 0);

  return (
    <div
      className="bg-card border border-border rounded-xl overflow-hidden"
      data-ocid={`billform.machine.${machineIndex}`}
    >
      {/* Machine header */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ background: "oklch(0.76 0.18 85 / 0.08)" }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
            style={{
              background: "oklch(0.76 0.18 85)",
              color: "oklch(0.1 0.02 50)",
            }}
          >
            {machine.number}
          </div>
          <span className="text-sm font-bold text-foreground">
            Machine {machine.number}
          </span>
          {machineTotal > 0 && (
            <span className="text-xs font-semibold text-primary">
              {formatCurrency(machineTotal)}
            </span>
          )}
        </div>
        {canRemove && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-destructive hover:bg-destructive/10"
            onClick={onRemoveMachine}
            aria-label="Remove machine"
            data-ocid={`billform.machine.${machineIndex}.delete_button`}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        )}
      </div>

      {/* Entries */}
      <div className="p-4 space-y-2">
        {machine.entries.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-2">
            No entries yet. Add a bucket or breaker entry below.
          </p>
        )}
        {machine.entries.map((entry, entryIdx) => (
          <EntryRow
            key={entry.id}
            entry={entry}
            rate={entry.type === "bucket" ? rates.bucket : rates.breaker}
            entryIndex={entryIdx + 1}
            machineIndex={machineIndex}
            onUpdateStart={(v) => onUpdateEntry(entry.id, "startTime", v)}
            onUpdateEnd={(v) => onUpdateEntry(entry.id, "endTime", v)}
            onRemove={() => onRemoveEntry(entry.id)}
          />
        ))}
        {/* Add entry buttons */}
        <div className="flex gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-xs h-8 border-dashed hover:border-primary/50 hover:bg-primary/5"
            onClick={() => onAddEntry("bucket")}
            data-ocid={`billform.machine.${machineIndex}.add_bucket_button`}
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Bucket
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-xs h-8 border-dashed hover:border-primary/50 hover:bg-primary/5"
            onClick={() => onAddEntry("breaker")}
            data-ocid={`billform.machine.${machineIndex}.add_breaker_button`}
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Breaker
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── BillForm Component ───────────────────────────────────────────────────────

export interface BillFormProps {
  onBillSaved?: () => void;
  canisterCreateBill?: (bill: Bill) => void;
  canisterUpsertCustomer?: (c: Customer) => void;
  canisterSetRates?: (r: Rates) => void;
}

export default function BillForm({
  onBillSaved,
  canisterCreateBill,
  canisterUpsertCustomer,
  canisterSetRates,
}: BillFormProps) {
  // Customer
  const [customerName, setCustomerName] = useState("");
  const [customerContact, setCustomerContact] = useState("");
  const [dateOfWork, setDateOfWork] = useState(todayStr);
  const [paymentDate, setPaymentDate] = useState(todayStr);
  const [notes, setNotes] = useState("");
  const [allCustomers, setAllCustomers] = useState<Customer[]>(() =>
    loadCustomers(),
  );
  const [suggestions, setSuggestions] = useState<Customer[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Rates
  const [rates, setRates] = useState<Rates>(loadRates);
  const [editingBreaker, setEditingBreaker] = useState(false);
  const [editingBucket, setEditingBucket] = useState(false);
  const [tempBreaker, setTempBreaker] = useState("");
  const [tempBucket, setTempBucket] = useState("");

  // Machines — default 1 pre-added
  const [machines, setMachines] = useState<Machine[]>(() => [createMachine(1)]);
  const [machineCounter, setMachineCounter] = useState(1);

  // Payment
  const [amountPaid, setAmountPaid] = useState("");

  // Export state
  const [isExporting, setIsExporting] = useState(false);

  const nameInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Close suggestions on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        nameInputRef.current &&
        !nameInputRef.current.contains(e.target as Node) &&
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node)
      )
        setShowSuggestions(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // ─── Autocomplete ───────────────────────────────────────────────────────────

  const handleNameChange = useCallback(
    (val: string) => {
      setCustomerName(val);
      if (val.trim().length === 0) {
        setSuggestions([]);
        setShowSuggestions(false);
        return;
      }
      const filtered = allCustomers
        .filter((c) => c.name.toLowerCase().includes(val.toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name));
      setSuggestions(filtered);
      setShowSuggestions(filtered.length > 0);
    },
    [allCustomers],
  );

  const selectSuggestion = useCallback((c: Customer) => {
    setCustomerName(c.name);
    setCustomerContact(c.contact);
    setShowSuggestions(false);
  }, []);

  // ─── Machines ───────────────────────────────────────────────────────────────

  const addMachine = () => {
    const num = machineCounter + 1;
    setMachineCounter(num);
    setMachines((prev) => [...prev, createMachine(num)]);
  };

  const removeMachine = (id: string) =>
    setMachines((prev) => prev.filter((m) => m.id !== id));

  const addEntry = (machineId: string, type: "bucket" | "breaker") => {
    setMachines((prev) =>
      prev.map((m) =>
        m.id === machineId
          ? {
              ...m,
              entries: [
                ...m.entries,
                { id: genId(), type, startTime: "", endTime: "" },
              ],
            }
          : m,
      ),
    );
  };

  const removeEntry = (machineId: string, entryId: string) => {
    setMachines((prev) =>
      prev.map((m) =>
        m.id === machineId
          ? { ...m, entries: m.entries.filter((e) => e.id !== entryId) }
          : m,
      ),
    );
  };

  const updateEntry = (
    machineId: string,
    entryId: string,
    field: "startTime" | "endTime",
    value: string,
  ) => {
    setMachines((prev) =>
      prev.map((m) =>
        m.id === machineId
          ? {
              ...m,
              entries: m.entries.map((e) =>
                e.id === entryId ? { ...e, [field]: value } : e,
              ),
            }
          : m,
      ),
    );
  };

  // ─── Rates ──────────────────────────────────────────────────────────────────

  const applyBreaker = () => {
    const v = Number.parseFloat(tempBreaker);
    if (!Number.isNaN(v) && v > 0) setRates((r) => ({ ...r, breaker: v }));
    setEditingBreaker(false);
  };

  const applyBucket = () => {
    const v = Number.parseFloat(tempBucket);
    if (!Number.isNaN(v) && v > 0) setRates((r) => ({ ...r, bucket: v }));
    setEditingBucket(false);
  };

  const saveDefaultRates = () => {
    saveRates(rates);
    canisterSetRates?.(rates);
    toast.success("Default rates saved permanently");
  };

  // ─── Calculations ────────────────────────────────────────────────────────────

  const allEntries = machines.flatMap((m) => m.entries);
  const bucketTotalHours = allEntries
    .filter((e) => e.type === "bucket")
    .reduce((s, e) => s + calculateHours(e.startTime, e.endTime), 0);
  const bucketTotalCost = bucketTotalHours * rates.bucket;
  const breakerTotalHours = allEntries
    .filter((e) => e.type === "breaker")
    .reduce((s, e) => s + calculateHours(e.startTime, e.endTime), 0);
  const breakerTotalCost = breakerTotalHours * rates.breaker;
  const grandTotal = bucketTotalCost + breakerTotalCost;
  const paid = Number.parseFloat(amountPaid) || 0;
  const paymentStatus = deriveStatus(paid, grandTotal);

  // ─── Build bill ──────────────────────────────────────────────────────────────

  const buildBill = useCallback(
    (): Bill => ({
      id: genId(),
      savedAt: new Date().toISOString(),
      customerName,
      customerContact,
      dateOfWork,
      paymentDate,
      rates,
      machines,
      amountPaid: paid,
      grandTotal,
      bucketTotalHours,
      bucketTotalCost,
      breakerTotalHours,
      breakerTotalCost,
      paymentStatus,
    }),
    [
      customerName,
      customerContact,
      dateOfWork,
      paymentDate,
      rates,
      machines,
      paid,
      grandTotal,
      bucketTotalHours,
      bucketTotalCost,
      breakerTotalHours,
      breakerTotalCost,
      paymentStatus,
    ],
  );

  // ─── Clear form ──────────────────────────────────────────────────────────────

  const clearForm = useCallback(() => {
    setCustomerName("");
    setCustomerContact("");
    setDateOfWork(todayStr());
    setPaymentDate(todayStr());
    setNotes("");
    setMachines([createMachine(1)]);
    setMachineCounter(1);
    setAmountPaid("");
  }, []);

  const doSaveCustomer = useCallback(() => {
    if (customerName.trim()) {
      const c: Customer = {
        name: customerName.trim(),
        contact: customerContact.trim(),
        updatedAt: Date.now(),
      };
      upsertCustomer(c);
      canisterUpsertCustomer?.(c);
    }
    setAllCustomers(loadCustomers());
  }, [customerName, customerContact, canisterUpsertCustomer]);

  // ─── Actions ─────────────────────────────────────────────────────────────────

  const handleSave = () => {
    doSaveCustomer();
    const bill = buildBill();
    appendBill(bill);
    canisterCreateBill?.(bill);
    toast.success("Bill saved to device storage!");
    clearForm();
    onBillSaved?.();
  };

  const handleExportPNG = async () => {
    doSaveCustomer();
    setIsExporting(true);
    try {
      const bill = buildBill();
      const html = getBillPrintHtml(bill);
      const filename = buildExportFilename(
        bill.customerName,
        bill.dateOfWork,
        "png",
      );
      await downloadBillAsPNG(html, filename, bill);
      appendBill(bill);
      canisterCreateBill?.(bill);
      toast.success("Bill downloaded as PNG!");
      clearForm();
      onBillSaved?.();
    } catch (e) {
      toast.error("Export failed. Please try again.");
      console.error(e);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportPDF = async () => {
    doSaveCustomer();
    setIsExporting(true);
    try {
      const bill = buildBill();
      const html = getBillPrintHtml(bill);
      const filename = buildExportFilename(
        bill.customerName,
        bill.dateOfWork,
        "pdf",
      );
      await downloadBillAsPDF(html, filename, bill);
      appendBill(bill);
      canisterCreateBill?.(bill);
      toast.success("Bill downloaded as PDF!");
      clearForm();
      onBillSaved?.();
    } catch (e) {
      toast.error("Export failed. Please try again.");
      console.error(e);
    } finally {
      setIsExporting(false);
    }
  };

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5" data-ocid="billform.page">
      {/* Customer Details */}
      <SectionCard>
        <SectionLabel>Customer Details</SectionLabel>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Customer name with autocomplete */}
          <div className="relative">
            <Label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
              Customer Name
            </Label>
            <Input
              ref={nameInputRef}
              value={customerName}
              onChange={(e) => handleNameChange(e.target.value)}
              onFocus={() => {
                if (suggestions.length > 0) setShowSuggestions(true);
              }}
              placeholder="e.g. Ravi Construction"
              data-ocid="billform.customer_name.input"
              autoComplete="off"
            />
            {showSuggestions && suggestions.length > 0 && (
              <div
                ref={suggestionsRef}
                className="absolute left-0 right-0 top-full mt-1 z-50 bg-popover border border-border rounded-lg shadow-lg overflow-hidden"
                data-ocid="billform.suggestions.popover"
              >
                {suggestions.map((c) => (
                  <button
                    type="button"
                    key={c.name}
                    className="w-full text-left px-3 py-2.5 text-sm hover:bg-accent transition-colors flex items-center justify-between gap-2"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectSuggestion(c);
                    }}
                  >
                    <span className="font-medium truncate">{c.name}</span>
                    {c.contact && (
                      <span className="text-xs text-muted-foreground flex-shrink-0">
                        {c.contact}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <Label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
              Contact Number
            </Label>
            <Input
              value={customerContact}
              onChange={(e) => setCustomerContact(e.target.value)}
              placeholder="e.g. 9876543210"
              data-ocid="billform.customer_contact.input"
            />
          </div>
          <div>
            <Label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
              Date of Work
            </Label>
            <Input
              type="date"
              value={dateOfWork}
              onChange={(e) => setDateOfWork(e.target.value)}
              data-ocid="billform.date_of_work.input"
            />
          </div>
          <div>
            <Label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
              Notes / Description
            </Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Site name, work description..."
              data-ocid="billform.notes.input"
            />
          </div>
        </div>
      </SectionCard>

      {/* Rates */}
      <SectionCard>
        <div className="flex items-center justify-between mb-4">
          <SectionLabel>Rates per Hour</SectionLabel>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-xs h-7 border-primary/30 text-primary hover:bg-primary/10"
            onClick={saveDefaultRates}
            data-ocid="billform.save_rates.button"
          >
            <Save className="w-3 h-3 mr-1.5" />
            Save as Default
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-4">
          {/* Bucket Rate */}
          <div
            className="rounded-lg border border-border p-3 space-y-2"
            style={{ background: "oklch(0.76 0.18 85 / 0.05)" }}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-foreground">
                Bucket
              </span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-5 w-5 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setTempBucket(String(rates.bucket));
                  setEditingBucket(true);
                }}
                aria-label="Edit bucket rate"
                data-ocid="billform.edit_bucket_rate.button"
              >
                <Pencil className="w-3 h-3" />
              </Button>
            </div>
            {editingBucket ? (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-sm">₹</span>
                <Input
                  type="number"
                  value={tempBucket}
                  onChange={(e) => setTempBucket(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyBucket()}
                  className="h-7 text-xs flex-1"
                  autoFocus
                  data-ocid="billform.bucket_rate.input"
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 text-primary"
                  onClick={applyBucket}
                  data-ocid="billform.bucket_rate.confirm_button"
                >
                  <Save className="w-3.5 h-3.5" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 text-muted-foreground"
                  onClick={() => setEditingBucket(false)}
                  data-ocid="billform.bucket_rate.cancel_button"
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            ) : (
              <div className="text-lg font-bold text-foreground">
                ₹{rates.bucket.toLocaleString("en-IN")}
                <span className="text-xs font-normal text-muted-foreground ml-1">
                  /hr
                </span>
              </div>
            )}
          </div>

          {/* Breaker Rate */}
          <div className="rounded-lg border border-border p-3 space-y-2 bg-secondary/30">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-foreground">
                Breaker
              </span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-5 w-5 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setTempBreaker(String(rates.breaker));
                  setEditingBreaker(true);
                }}
                aria-label="Edit breaker rate"
                data-ocid="billform.edit_breaker_rate.button"
              >
                <Pencil className="w-3 h-3" />
              </Button>
            </div>
            {editingBreaker ? (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-sm">₹</span>
                <Input
                  type="number"
                  value={tempBreaker}
                  onChange={(e) => setTempBreaker(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyBreaker()}
                  className="h-7 text-xs flex-1"
                  autoFocus
                  data-ocid="billform.breaker_rate.input"
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 text-primary"
                  onClick={applyBreaker}
                  data-ocid="billform.breaker_rate.confirm_button"
                >
                  <Save className="w-3.5 h-3.5" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 text-muted-foreground"
                  onClick={() => setEditingBreaker(false)}
                  data-ocid="billform.breaker_rate.cancel_button"
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            ) : (
              <div className="text-lg font-bold text-foreground">
                ₹{rates.breaker.toLocaleString("en-IN")}
                <span className="text-xs font-normal text-muted-foreground ml-1">
                  /hr
                </span>
              </div>
            )}
          </div>
        </div>
      </SectionCard>

      {/* Machines */}
      <SectionCard>
        <div className="flex items-center justify-between mb-4">
          <SectionLabel>Machines &amp; Entries</SectionLabel>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-xs h-7 border-dashed border-primary/40 hover:border-primary hover:bg-primary/5"
            onClick={addMachine}
            data-ocid="billform.add_machine.button"
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Add Machine
          </Button>
        </div>
        <div className="space-y-4" data-ocid="billform.machines.list">
          {machines.map((machine, idx) => (
            <MachineCard
              key={machine.id}
              machine={machine}
              machineIndex={idx + 1}
              rates={rates}
              canRemove={machines.length > 1}
              onRemoveMachine={() => removeMachine(machine.id)}
              onAddEntry={(type) => addEntry(machine.id, type)}
              onRemoveEntry={(entryId) => removeEntry(machine.id, entryId)}
              onUpdateEntry={(entryId, field, value) =>
                updateEntry(machine.id, entryId, field, value)
              }
            />
          ))}
        </div>
      </SectionCard>

      {/* Totals Summary */}
      {grandTotal > 0 && (
        <SectionCard>
          <SectionLabel>Summary</SectionLabel>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {bucketTotalHours > 0 && (
              <div className="rounded-lg p-3 border border-border bg-secondary/60">
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                  Bucket
                </div>
                <div className="text-sm font-bold text-foreground">
                  {formatHours(bucketTotalHours)} hrs
                </div>
                <div className="text-xs text-primary font-semibold">
                  {formatCurrency(bucketTotalCost)}
                </div>
              </div>
            )}
            {breakerTotalHours > 0 && (
              <div className="rounded-lg p-3 border border-border bg-secondary/60">
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                  Breaker
                </div>
                <div className="text-sm font-bold text-foreground">
                  {formatHours(breakerTotalHours)} hrs
                </div>
                <div className="text-xs text-primary font-semibold">
                  {formatCurrency(breakerTotalCost)}
                </div>
              </div>
            )}
            <div
              className="rounded-lg p-3 border-2 col-span-2 flex items-center justify-between"
              style={{
                background: "oklch(0.76 0.18 85 / 0.08)",
                borderColor: "oklch(0.76 0.18 85 / 0.4)",
              }}
            >
              <span className="text-sm font-bold text-foreground">
                Grand Total
              </span>
              <span className="text-xl font-extrabold text-primary">
                {formatCurrency(grandTotal)}
              </span>
            </div>
          </div>
        </SectionCard>
      )}

      {/* Payment */}
      <SectionCard>
        <SectionLabel>Payment</SectionLabel>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <Label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
              Amount Paid (₹)
            </Label>
            <Input
              type="number"
              value={amountPaid}
              onChange={(e) => setAmountPaid(e.target.value)}
              placeholder="0"
              min="0"
              data-ocid="billform.amount_paid.input"
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
              data-ocid="billform.payment_date.input"
            />
          </div>
        </div>

        {/* Payment status preview */}
        <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-secondary/30">
          <span className="text-xs text-muted-foreground">Payment Status:</span>
          <PaymentStatusBadge status={paymentStatus} />
          {grandTotal > 0 && paid > 0 && paid < grandTotal && (
            <span className="text-xs text-muted-foreground ml-auto">
              Balance:{" "}
              <strong className="text-foreground">
                {formatCurrency(grandTotal - paid)}
              </strong>
            </span>
          )}
        </div>
      </SectionCard>

      <Separator />

      {/* Actions */}
      <div className="flex flex-wrap gap-3 pb-4">
        <Button
          type="button"
          className="flex-1 sm:flex-none bg-primary text-primary-foreground hover:bg-primary/90 font-semibold shadow-sm"
          onClick={handleSave}
          data-ocid="billform.save.primary_button"
        >
          <Save className="w-4 h-4 mr-2" />
          Save Bill
        </Button>
        <Button
          type="button"
          variant="outline"
          className="flex-1 sm:flex-none border-primary/30 text-primary hover:bg-primary/10"
          onClick={handleExportPDF}
          disabled={isExporting}
          data-ocid="billform.export_pdf.button"
        >
          <FileText className="w-4 h-4 mr-2" />
          Export PDF
        </Button>
        <Button
          type="button"
          variant="outline"
          className="flex-1 sm:flex-none border-primary/30 text-primary hover:bg-primary/10"
          onClick={handleExportPNG}
          disabled={isExporting}
          data-ocid="billform.export_png.button"
        >
          <FileImage className="w-4 h-4 mr-2" />
          Export PNG
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="text-muted-foreground hover:text-foreground"
          onClick={clearForm}
          data-ocid="billform.clear.button"
        >
          <X className="w-4 h-4 mr-2" />
          Clear Form
        </Button>
      </div>
    </div>
  );
}
