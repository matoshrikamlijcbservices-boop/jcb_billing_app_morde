import CloudSyncPanel, { LS_PENDING_SYNC } from "@/components/CloudSyncPanel";
import PastBillsView from "@/components/PastBillsView";
import RemindersView from "@/components/RemindersView";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Toaster } from "@/components/ui/sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCanisterSync } from "@/hooks/useCanisterSync";
import {
  buildExportFilename,
  downloadBillAsPDF,
  downloadBillAsPNG,
} from "@/lib/exportBill";
import {
  appendBill,
  loadBills,
  loadCustomers,
  loadRates,
  saveRates,
  upsertCustomer,
} from "@/lib/storage";
import type { Bill, Customer, Rates } from "@/types";
import { useInternetIdentity } from "@caffeineai/core-infrastructure";
import {
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Cloud,
  CloudOff,
  Download,
  FileImage,
  FileText,
  Filter,
  LogIn,
  LogOut,
  Moon,
  Pencil,
  Phone,
  Plus,
  Save,
  Sun,
  Trash2,
  WifiOff,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

// ─── Constants ──────────────────────────────────────────────────────────────────

const LS_THEME = "jcb_theme";
const DEFAULT_RATES: Rates = { breaker: 1700, bucket: 1200 };

// ─── Helpers ───────────────────────────────────────────────────────────────────

function genId(): string {
  return Math.random().toString(36).slice(2);
}

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

function createDefaultMachine(counter: number): Bill["machines"][0] {
  return { id: genId(), number: counter, entries: [] };
}

const LS_STABLE_USER_ID = "jcb_stable_user_id";

function truncatePrincipal(p: string): string {
  if (p.length <= 16) return p;
  return `${p.slice(0, 8)}…${p.slice(-6)}`;
}

/**
 * Returns a stable display ID for the top-right corner.
 * On first login: stores the principal in localStorage and returns it truncated.
 * On subsequent logins (even with a different principal): returns the stored ID.
 * This prevents users from thinking their data is lost when the principal changes.
 */
function getStableDisplayId(currentPrincipal: string): string {
  if (!currentPrincipal) return "";
  const stored = localStorage.getItem(LS_STABLE_USER_ID);
  if (stored) return stored;
  // First time: store current principal as the stable ID
  const truncated = truncatePrincipal(currentPrincipal);
  localStorage.setItem(LS_STABLE_USER_ID, truncated);
  return truncated;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function PaymentBadge({
  status,
}: { status: "NOT PAID" | "PARTIALLY PAID" | "PAID" }) {
  if (status === "PAID")
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-700 border border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700">
        ✓ PAID
      </span>
    );
  if (status === "PARTIALLY PAID")
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700">
        ◐ PARTIAL
      </span>
    );
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700 border border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-700">
      ✕ NOT PAID
    </span>
  );
}

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

function TotalBox({
  label,
  value,
  highlight = false,
}: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      className={`rounded-lg p-3 border ${
        highlight
          ? "bg-primary/10 border-primary/30"
          : "bg-secondary/60 border-border/50"
      }`}
    >
      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
        {label}
      </div>
      <div className="text-base font-bold text-foreground">{value}</div>
    </div>
  );
}

interface EntryRowProps {
  entry: Bill["machines"][0]["entries"][0];
  hours: number;
  cost: number;
  index: number;
  onUpdateStart: (v: string) => void;
  onUpdateEnd: (v: string) => void;
  onRemove: () => void;
}

function EntryRow({
  entry,
  hours,
  cost,
  index,
  onUpdateStart,
  onUpdateEnd,
  onRemove,
}: EntryRowProps) {
  return (
    <div
      className="flex flex-wrap items-center gap-2 p-2.5 bg-secondary/40 rounded-lg border border-border/50"
      data-ocid={`machines.row.${index}`}
    >
      <div className="flex items-center gap-1.5">
        <Label className="text-[10px] font-semibold text-muted-foreground w-10">
          Start
        </Label>
        <Input
          type="time"
          value={entry.startTime}
          onChange={(e) => onUpdateStart(e.target.value)}
          className="h-7 text-xs w-32"
          data-ocid={`machines.input.${index}`}
        />
      </div>
      <div className="flex items-center gap-1.5">
        <Label className="text-[10px] font-semibold text-muted-foreground w-10">
          End
        </Label>
        <Input
          type="time"
          value={entry.endTime}
          onChange={(e) => onUpdateEnd(e.target.value)}
          className="h-7 text-xs w-32"
          data-ocid={`machines.input.${index}`}
        />
      </div>
      <ChevronRight className="w-3 h-3 text-muted-foreground/50" />
      <span className="text-xs font-semibold text-foreground">
        {formatHours(hours)} hrs
      </span>
      <span className="text-xs text-muted-foreground">→</span>
      <span className="text-xs font-bold text-primary">
        {formatCurrency(cost)}
      </span>
      <Button
        size="icon"
        variant="ghost"
        className="h-6 w-6 text-destructive hover:bg-destructive/10 ml-auto"
        onClick={onRemove}
        data-ocid={`machines.delete_button.${index}`}
      >
        <Trash2 className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}

// ─── Export helper (bill print HTML) ────────────────────────────────────────────────

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

// ─── Main App ──────────────────────────────────────────────────────────────────────

export default function App() {
  // Theme
  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem(LS_THEME);
    return saved ? saved === "dark" : false;
  });

  // Online status
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  // PWA install
  const [installPrompt, setInstallPrompt] = useState<
    | (Event & {
        prompt?: () => Promise<void>;
        userChoice?: Promise<{ outcome: string }>;
      })
    | null
  >(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSHint, setShowIOSHint] = useState(false);
  const [showSync, setShowSync] = useState(false);

  // II identity
  const { loginStatus, identity, login, clear } = useInternetIdentity();
  const isLoggedIn = loginStatus === "success";
  const principal = identity?.getPrincipal().toText();

  // Canister sync
  const refreshFromStorage = useCallback(() => {
    setSavedBills(loadBills());
    setAllCustomers(loadCustomers());
    // Do NOT call setRefreshKey here — it would cause App to re-render and
    // propagate new prop references into PastBillsView, resetting its UI state.
  }, []);

  const {
    syncStatus,
    syncNow,
    pauseSync,
    resumeSync,
    canisterCreateBill,
    canisterUpdateBill: _canisterUpdateBill,
    canisterDeleteBill: _canisterDeleteBill,
    canisterUpsertCustomer,
    canisterSetRates,
  } = useCanisterSync(refreshFromStorage);

  // Stable refs for canister callbacks so PastBillsView never gets
  // new prop references on App re-renders caused by sync status changes.
  const canisterUpdateBillRef = useRef(_canisterUpdateBill);
  const canisterDeleteBillRef = useRef(_canisterDeleteBill);
  useEffect(() => {
    canisterUpdateBillRef.current = _canisterUpdateBill;
  }, [_canisterUpdateBill]);
  useEffect(() => {
    canisterDeleteBillRef.current = _canisterDeleteBill;
  }, [_canisterDeleteBill]);
  const stableCanisterUpdateBill = useCallback(
    (bill: Bill) => canisterUpdateBillRef.current(bill),
    [],
  );
  const stableCanisterDeleteBill = useCallback(
    (id: string) => canisterDeleteBillRef.current(id),
    [],
  );

  // Bills state
  const [_savedBills, setSavedBills] = useState<Bill[]>(() => loadBills());
  const [allCustomers, setAllCustomers] = useState<Customer[]>(() =>
    loadCustomers(),
  );

  // Customer form fields
  const [customerName, setCustomerName] = useState("");
  const [customerContact, setCustomerContact] = useState("");
  const [dateOfWork, setDateOfWork] = useState(() => today());
  const [paymentDate, setPaymentDate] = useState(() => today());
  const [suggestions, setSuggestions] = useState<Customer[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Rates
  const [rates, setRates] = useState<Rates>(() => loadRates() || DEFAULT_RATES);
  const [editingBreaker, setEditingBreaker] = useState(false);
  const [editingBucket, setEditingBucket] = useState(false);
  const [tempBreaker, setTempBreaker] = useState("");
  const [tempBucket, setTempBucket] = useState("");

  // Machines
  const [machines, setMachines] = useState<Bill["machines"]>(() => [
    createDefaultMachine(1),
  ]);
  const [machineCounter, setMachineCounter] = useState(1);

  // Payment
  const [amountPaid, setAmountPaid] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [activeTab, setActiveTab] = useState("new-bill");

  const nameInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // ─── Effects ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    const ios =
      /iPad|iPhone|iPod/.test(navigator.userAgent) &&
      !(window as Window & { MSStream?: unknown }).MSStream;
    setIsIOS(ios);
    if (ios && !window.matchMedia("(display-mode: standalone)").matches) {
      if (!localStorage.getItem("jcb_ios_hint_dismissed")) setShowIOSHint(true);
    }
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(
        e as Event & {
          prompt?: () => Promise<void>;
          userChoice?: Promise<{ outcome: string }>;
        },
      );
      setShowInstallBanner(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", () => {
      setShowInstallBanner(false);
      setInstallPrompt(null);
    });
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  useEffect(() => {
    const html = document.documentElement;
    if (isDark) html.classList.add("dark");
    else html.classList.remove("dark");
    localStorage.setItem(LS_THEME, isDark ? "dark" : "light");
  }, [isDark]);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

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

  useEffect(() => {
    if (activeTab === "new-bill" && machines.length === 0) {
      setMachines([createDefaultMachine(1)]);
      setMachineCounter(1);
    }
  }, [activeTab, machines.length]);

  // ─── Handlers ─────────────────────────────────────────────────────────────────

  const handleInstall = async () => {
    if (!installPrompt?.prompt) return;
    await installPrompt.prompt();
    const result = await installPrompt.userChoice;
    if (result?.outcome === "accepted") {
      setShowInstallBanner(false);
      setInstallPrompt(null);
    }
  };

  const handleNameChange = useCallback(
    (val: string) => {
      setCustomerName(val);
      if (!val.trim()) {
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

  const addMachine = () => {
    const num = machineCounter + 1;
    setMachineCounter(num);
    setMachines((prev) => [...prev, { id: genId(), number: num, entries: [] }]);
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

  // Calculations
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

  const saveRatesPermanently = () => {
    saveRates(rates);
    canisterSetRates(rates);
    toast.success("Default rates saved permanently");
  };

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

  const clearForm = useCallback(() => {
    setCustomerName("");
    setCustomerContact("");
    setDateOfWork(today());
    setPaymentDate(today());
    setMachines([createDefaultMachine(1)]);
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
      canisterUpsertCustomer(c);
    }
    setAllCustomers(loadCustomers());
  }, [customerName, customerContact, canisterUpsertCustomer]);

  const handleSave = () => {
    doSaveCustomer();
    const bill = buildBill();
    appendBill(bill);
    canisterCreateBill(bill);
    toast.success("Bill saved!");
    clearForm();
    if (!navigator.onLine) {
      localStorage.setItem(LS_PENDING_SYNC, "true");
    }
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
      canisterCreateBill(bill);
      toast.success("Bill downloaded as PNG!");
      clearForm();
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
      canisterCreateBill(bill);
      toast.success("Bill downloaded as PDF!");
      clearForm();
    } catch (e) {
      toast.error("Export failed. Please try again.");
      console.error(e);
    } finally {
      setIsExporting(false);
    }
  };

  // ─── Render ─────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background">
      <Toaster richColors position="top-right" />

      {/* PWA Install Banner */}
      {showInstallBanner && !isIOS && (
        <div
          className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs font-semibold"
          style={{
            background: "oklch(0.76 0.18 85)",
            color: "oklch(0.15 0.02 50)",
          }}
          data-ocid="pwa.install_banner"
        >
          <div className="flex items-center gap-2">
            <Download className="w-3.5 h-3.5 flex-shrink-0" />
            <span>
              Install JCB Billing as an app for quick access from your home
              screen
            </span>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              type="button"
              onClick={handleInstall}
              className="px-3 py-1 rounded-md font-bold text-xs transition-opacity hover:opacity-80"
              style={{
                background: "oklch(0.15 0.02 50)",
                color: "oklch(0.76 0.18 85)",
              }}
              data-ocid="pwa.install_button"
            >
              Install App
            </button>
            <button
              type="button"
              onClick={() => setShowInstallBanner(false)}
              className="p-1 rounded-md hover:opacity-70"
              aria-label="Dismiss install banner"
              data-ocid="pwa.close_button"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* iOS Install Hint */}
      {showIOSHint && (
        <div
          className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs font-semibold"
          style={{
            background: "oklch(0.76 0.18 85)",
            color: "oklch(0.15 0.02 50)",
          }}
          data-ocid="pwa.ios_hint_banner"
        >
          <div className="flex items-center gap-2">
            <Download className="w-3.5 h-3.5 flex-shrink-0" />
            <span>
              Tap <strong>Share ⬆</strong> → <strong>Add to Home Screen</strong>{" "}
              to install
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setShowIOSHint(false);
              localStorage.setItem("jcb_ios_hint_dismissed", "1");
            }}
            className="p-1 rounded-md hover:opacity-70"
            aria-label="Dismiss iOS install hint"
            data-ocid="pwa.ios_close_button"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Offline Banner */}
      {!isOnline && (
        <div
          className="bg-amber-500 text-white text-xs font-semibold py-2 px-4 text-center flex items-center justify-center gap-2"
          data-ocid="app.toast"
        >
          <WifiOff className="w-3.5 h-3.5" />
          Offline — Changes are saved locally and will sync when you reconnect.
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-border/80">
        {/* Internet Identity Login Bar */}
        <div
          className="px-4 py-2 border-b border-white/10 flex items-center justify-end gap-2"
          style={{
            background: isDark
              ? "oklch(0.18 0.025 250)"
              : "oklch(0.22 0.035 50)",
          }}
        >
          {isLoggedIn ? (
            <div className="flex items-center gap-2 text-xs text-white/80">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
              <span
                className="font-mono text-[11px] text-white/70 truncate max-w-[140px]"
                title="Your stable account ID — this stays the same so your saved bills are always linked to your account"
              >
                {getStableDisplayId(principal ?? "")}
              </span>
              <button
                type="button"
                onClick={clear}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                data-ocid="auth.sign_out_button"
              >
                <LogOut className="w-3 h-3" />
                Logout
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={login}
              className="flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-semibold transition-colors"
              style={{
                background: "oklch(0.76 0.18 85)",
                color: "oklch(0.1 0.02 50)",
              }}
              data-ocid="auth.sign_in_button"
            >
              <LogIn className="w-3 h-3" />
              Login with Internet Identity
            </button>
          )}
        </div>

        {/* Main header bar */}
        <div
          className="relative overflow-hidden"
          style={{
            background: isDark
              ? "linear-gradient(135deg, oklch(0.2 0.03 240) 0%, oklch(0.17 0.025 250) 100%)"
              : "linear-gradient(135deg, oklch(0.25 0.04 50) 0%, oklch(0.18 0.03 45) 100%)",
          }}
        >
          <div
            className="absolute top-0 left-0 right-0 h-1"
            style={{
              background:
                "linear-gradient(90deg, oklch(0.76 0.18 85), oklch(0.65 0.2 55))",
            }}
          />
          <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
            <div
              className="flex items-center justify-center w-10 h-10 rounded-xl flex-shrink-0"
              style={{ background: "oklch(0.76 0.18 85)" }}
            >
              <Building2
                className="w-5 h-5"
                style={{ color: "oklch(0.15 0.02 50)" }}
              />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-sm font-bold text-white leading-tight truncate">
                Matoshri Kamljadevi Earthmovers
              </h1>
              <div className="flex items-center gap-3 mt-0.5">
                <span className="flex items-center gap-1 text-xs text-white/70">
                  <Phone className="w-3 h-3" /> 9890989473
                  <span className="text-[10px] bg-green-500/30 text-green-300 px-1.5 py-0.5 rounded-full font-medium ml-1">
                    GPay
                  </span>
                </span>
                <span className="flex items-center gap-1 text-xs text-white/70">
                  <Phone className="w-3 h-3" /> 7588623501
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShowSync((s) => !s)}
                className={`p-2 rounded-lg transition-colors relative ${
                  showSync
                    ? "bg-white/20 text-white"
                    : "text-white/60 hover:bg-white/10 hover:text-white"
                }`}
                title={
                  isLoggedIn ? "Canister Sync (Connected)" : "Canister Sync"
                }
                data-ocid="app.toggle"
              >
                {isLoggedIn ? (
                  <>
                    <Cloud className="w-4 h-4" />
                    <span className="absolute top-0.5 right-0.5 w-2 h-2 bg-green-400 rounded-full border border-white/30" />
                  </>
                ) : (
                  <CloudOff className="w-4 h-4 opacity-50" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setIsDark((d) => !d)}
                className="p-2 rounded-lg text-white/60 hover:bg-white/10 hover:text-white transition-colors"
                title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
                data-ocid="app.toggle"
              >
                {isDark ? (
                  <Sun className="w-4 h-4" />
                ) : (
                  <Moon className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        {/* Sync Panel */}
        {showSync && (
          <div className="mb-5">
            <CloudSyncPanel
              syncStatus={syncStatus}
              syncNow={syncNow}
              isLoggedIn={isLoggedIn}
            />
          </div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList
            className="mb-6 p-1 bg-secondary/60 rounded-xl"
            data-ocid="app.tab"
          >
            <TabsTrigger
              value="new-bill"
              className="rounded-lg text-sm font-semibold flex-1"
              data-ocid="app.tab"
            >
              New Bill
            </TabsTrigger>
            <TabsTrigger
              value="past-bills"
              className="rounded-lg text-sm font-semibold flex-1"
              data-ocid="app.tab"
            >
              Past Bills
            </TabsTrigger>
            <TabsTrigger
              value="reminders"
              className="rounded-lg text-sm font-semibold flex-1"
              data-ocid="app.tab"
            >
              Reminders
            </TabsTrigger>
          </TabsList>

          {/* ─── New Bill ─── */}
          <TabsContent value="new-bill" className="space-y-5">
            {/* Customer */}
            <BillCard>
              <SectionTitle>Customer Details</SectionTitle>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="relative sm:col-span-2 lg:col-span-1">
                  <Label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
                    Customer Name
                  </Label>
                  <Input
                    ref={nameInputRef}
                    data-ocid="customer.input"
                    value={customerName}
                    onChange={(e) => handleNameChange(e.target.value)}
                    onFocus={() =>
                      customerName &&
                      suggestions.length > 0 &&
                      setShowSuggestions(true)
                    }
                    placeholder="Enter customer name"
                    className="text-sm"
                    autoComplete="off"
                  />
                  {showSuggestions && (
                    <div
                      ref={suggestionsRef}
                      className="absolute top-full left-0 right-0 z-50 mt-1 bg-popover border border-border rounded-xl shadow-lg overflow-hidden"
                    >
                      {suggestions.map((s) => (
                        <button
                          key={s.name}
                          type="button"
                          className="w-full text-left px-3 py-2.5 text-sm hover:bg-accent transition-colors flex justify-between items-center"
                          onMouseDown={() => selectSuggestion(s)}
                        >
                          <span className="font-medium">{s.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {s.contact}
                          </span>
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
                    data-ocid="customer.input"
                    value={customerContact}
                    onChange={(e) => setCustomerContact(e.target.value)}
                    placeholder="Enter contact"
                    className="text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
                    Date of Work
                  </Label>
                  <Input
                    data-ocid="customer.input"
                    type="date"
                    value={dateOfWork}
                    onChange={(e) => setDateOfWork(e.target.value)}
                    className="text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
                    Payment Date
                  </Label>
                  <Input
                    data-ocid="customer.input"
                    type="date"
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                    className="text-sm"
                  />
                </div>
              </div>
            </BillCard>

            {/* Rates */}
            <BillCard>
              <div className="flex items-center justify-between mb-4">
                <SectionTitle>Work Rates</SectionTitle>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs -mt-1"
                  onClick={saveRatesPermanently}
                  data-ocid="rates.save_button"
                >
                  <Save className="w-3.5 h-3.5 mr-1.5" />
                  Save as Default
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {/* Breaker */}
                <div className="bg-secondary/60 rounded-xl p-4 border border-border/50">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    Breaker Rate
                  </div>
                  {editingBreaker ? (
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">₹</span>
                      <Input
                        type="number"
                        value={tempBreaker}
                        onChange={(e) => setTempBreaker(e.target.value)}
                        className="h-8 text-sm w-24"
                        autoFocus
                        onKeyDown={(e) => e.key === "Enter" && applyBreaker()}
                      />
                      <span className="text-xs text-muted-foreground">/hr</span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={applyBreaker}
                      >
                        <Check className="w-3.5 h-3.5 text-green-500" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => setEditingBreaker(false)}
                      >
                        <X className="w-3.5 h-3.5 text-destructive" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-bold text-foreground">
                        ₹{rates.breaker.toLocaleString("en-IN")}
                      </span>
                      <span className="text-xs text-muted-foreground">/hr</span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 ml-auto"
                        onClick={() => {
                          setTempBreaker(String(rates.breaker));
                          setEditingBreaker(true);
                        }}
                        data-ocid="rates.edit_button"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
                {/* Bucket */}
                <div className="bg-secondary/60 rounded-xl p-4 border border-border/50">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    Bucket Rate
                  </div>
                  {editingBucket ? (
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">₹</span>
                      <Input
                        type="number"
                        value={tempBucket}
                        onChange={(e) => setTempBucket(e.target.value)}
                        className="h-8 text-sm w-24"
                        autoFocus
                        onKeyDown={(e) => e.key === "Enter" && applyBucket()}
                      />
                      <span className="text-xs text-muted-foreground">/hr</span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={applyBucket}
                      >
                        <Check className="w-3.5 h-3.5 text-green-500" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => setEditingBucket(false)}
                      >
                        <X className="w-3.5 h-3.5 text-destructive" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-bold text-foreground">
                        ₹{rates.bucket.toLocaleString("en-IN")}
                      </span>
                      <span className="text-xs text-muted-foreground">/hr</span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 ml-auto"
                        onClick={() => {
                          setTempBucket(String(rates.bucket));
                          setEditingBucket(true);
                        }}
                        data-ocid="rates.edit_button"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </BillCard>

            {/* Machines */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <SectionTitle>Machines</SectionTitle>
                <Button
                  size="sm"
                  className="bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-semibold rounded-lg"
                  onClick={addMachine}
                  data-ocid="machines.primary_button"
                >
                  <Plus className="w-3.5 h-3.5 mr-1.5" />
                  Add Machine
                </Button>
              </div>
              <div className="space-y-4">
                {machines.map((machine) => {
                  const machineBucket = machine.entries.filter(
                    (e) => e.type === "bucket",
                  );
                  const machineBreaker = machine.entries.filter(
                    (e) => e.type === "breaker",
                  );
                  const machineTotal = machine.entries.reduce((sum, entry) => {
                    const h = calculateHours(entry.startTime, entry.endTime);
                    return (
                      sum +
                      h *
                        (entry.type === "bucket" ? rates.bucket : rates.breaker)
                    );
                  }, 0);

                  return (
                    <BillCard key={machine.id}>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold text-primary-foreground"
                            style={{ background: "oklch(0.76 0.18 85)" }}
                          >
                            {machine.number}
                          </div>
                          <h3 className="text-sm font-bold text-foreground">
                            Machine {machine.number}
                          </h3>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs h-7 px-3 rounded-lg"
                            onClick={() => addEntry(machine.id, "bucket")}
                            data-ocid={`machines.primary_button.${machine.number}`}
                          >
                            <Plus className="w-3 h-3 mr-1" />
                            Bucket
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs h-7 px-3 rounded-lg"
                            onClick={() => addEntry(machine.id, "breaker")}
                            data-ocid={`machines.secondary_button.${machine.number}`}
                          >
                            <Plus className="w-3 h-3 mr-1" />
                            Breaker
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive hover:bg-destructive/10"
                            onClick={() => removeMachine(machine.id)}
                            data-ocid={`machines.delete_button.${machine.number}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>

                      {machine.entries.length === 0 && (
                        <div className="text-center py-6 text-xs text-muted-foreground/60 border-2 border-dashed border-border/40 rounded-lg">
                          Add Bucket or Breaker entries to log work hours
                        </div>
                      )}

                      {machineBucket.length > 0 && (
                        <div className="mb-3">
                          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1.5">
                            <span className="inline-block w-2 h-2 rounded-full bg-blue-400" />
                            Bucket
                          </div>
                          <div className="space-y-2">
                            {machineBucket.map((entry, idx) => {
                              const h = calculateHours(
                                entry.startTime,
                                entry.endTime,
                              );
                              return (
                                <EntryRow
                                  key={entry.id}
                                  entry={entry}
                                  hours={h}
                                  cost={h * rates.bucket}
                                  index={idx + 1}
                                  onUpdateStart={(v) =>
                                    updateEntry(
                                      machine.id,
                                      entry.id,
                                      "startTime",
                                      v,
                                    )
                                  }
                                  onUpdateEnd={(v) =>
                                    updateEntry(
                                      machine.id,
                                      entry.id,
                                      "endTime",
                                      v,
                                    )
                                  }
                                  onRemove={() =>
                                    removeEntry(machine.id, entry.id)
                                  }
                                />
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {machineBreaker.length > 0 && (
                        <div className="mb-3">
                          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1.5">
                            <span className="inline-block w-2 h-2 rounded-full bg-orange-400" />
                            Breaker
                          </div>
                          <div className="space-y-2">
                            {machineBreaker.map((entry, idx) => {
                              const h = calculateHours(
                                entry.startTime,
                                entry.endTime,
                              );
                              return (
                                <EntryRow
                                  key={entry.id}
                                  entry={entry}
                                  hours={h}
                                  cost={h * rates.breaker}
                                  index={idx + 1}
                                  onUpdateStart={(v) =>
                                    updateEntry(
                                      machine.id,
                                      entry.id,
                                      "startTime",
                                      v,
                                    )
                                  }
                                  onUpdateEnd={(v) =>
                                    updateEntry(
                                      machine.id,
                                      entry.id,
                                      "endTime",
                                      v,
                                    )
                                  }
                                  onRemove={() =>
                                    removeEntry(machine.id, entry.id)
                                  }
                                />
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {machine.entries.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-border flex justify-end items-center gap-2">
                          <span className="text-xs font-semibold text-muted-foreground uppercase">
                            Machine {machine.number} Total
                          </span>
                          <span className="text-base font-bold text-foreground">
                            {formatCurrency(machineTotal)}
                          </span>
                        </div>
                      )}
                    </BillCard>
                  );
                })}
              </div>
            </div>

            {/* Totals */}
            {(bucketTotalHours > 0 || breakerTotalHours > 0) && (
              <BillCard>
                <SectionTitle>Summary Totals</SectionTitle>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                  <TotalBox
                    label="Bucket Hours"
                    value={`${formatHours(bucketTotalHours)} hrs`}
                  />
                  <TotalBox
                    label="Bucket Cost"
                    value={formatCurrency(bucketTotalCost)}
                    highlight
                  />
                  <TotalBox
                    label="Breaker Hours"
                    value={`${formatHours(breakerTotalHours)} hrs`}
                  />
                  <TotalBox
                    label="Breaker Cost"
                    value={formatCurrency(breakerTotalCost)}
                    highlight
                  />
                </div>
                <div
                  className="rounded-xl p-4 flex items-center justify-between border-2"
                  style={{
                    background: isDark
                      ? "oklch(0.2 0.04 85 / 0.3)"
                      : "oklch(0.97 0.06 85)",
                    borderColor: "oklch(0.76 0.18 85 / 0.5)",
                  }}
                >
                  <span className="text-sm font-bold uppercase tracking-wide">
                    Grand Total
                  </span>
                  <span className="text-2xl font-bold">
                    {formatCurrency(grandTotal)}
                  </span>
                </div>
              </BillCard>
            )}

            {/* Payment */}
            <BillCard>
              <SectionTitle>Payment</SectionTitle>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
                <div>
                  <Label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
                    Grand Total
                  </Label>
                  <div className="h-9 flex items-center px-3 bg-secondary/60 rounded-lg text-sm font-bold">
                    {formatCurrency(grandTotal)}
                  </div>
                </div>
                <div>
                  <Label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
                    Amount Paid (₹)
                  </Label>
                  <Input
                    data-ocid="payment.input"
                    type="number"
                    value={amountPaid}
                    onChange={(e) => setAmountPaid(e.target.value)}
                    placeholder="0"
                    className="text-sm"
                    min="0"
                  />
                </div>
                <div>
                  <Label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
                    Balance Due
                  </Label>
                  <div className="h-9 flex items-center px-3 bg-secondary/60 rounded-lg text-sm font-bold text-red-600 dark:text-red-400">
                    {formatCurrency(Math.max(0, grandTotal - paid))}
                  </div>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-3">
                <span className="text-xs font-semibold text-muted-foreground">
                  Status:
                </span>
                <PaymentBadge status={paymentStatus} />
              </div>
            </BillCard>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row gap-3 pb-6">
              <Button
                className="flex-1 font-semibold rounded-xl"
                variant="outline"
                onClick={handleSave}
                data-ocid="bill.save_button"
              >
                <Save className="w-4 h-4 mr-2" />
                Save Bill
              </Button>
              <Button
                className="flex-1 font-semibold rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={handleExportPNG}
                disabled={isExporting}
                data-ocid="bill.primary_button"
              >
                <FileImage className="w-4 h-4 mr-2" />
                {isExporting ? "Exporting..." : "Export PNG"}
              </Button>
              <Button
                className="flex-1 font-semibold rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={handleExportPDF}
                disabled={isExporting}
                data-ocid="bill.secondary_button"
              >
                <FileText className="w-4 h-4 mr-2" />
                {isExporting ? "Exporting..." : "Export PDF"}
              </Button>
            </div>
          </TabsContent>

          {/* ─── Past Bills ─── */}
          <TabsContent value="past-bills">
            <PastBillsView
              onRefreshNeeded={refreshFromStorage}
              canisterDeleteBill={stableCanisterDeleteBill}
              canisterUpdateBill={stableCanisterUpdateBill}
              pauseSync={pauseSync}
              resumeSync={resumeSync}
            />
          </TabsContent>

          {/* ─── Reminders ─── */}
          <TabsContent value="reminders">
            <RemindersView bills={_savedBills} />
          </TabsContent>
        </Tabs>
      </main>

      <footer className="border-t border-border bg-card py-4 mt-6">
        <div className="max-w-4xl mx-auto px-4 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} Matoshri Kamljadevi Earthmovers and Land
          Developers.
        </div>
      </footer>
    </div>
  );
}
