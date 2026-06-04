import { createActor } from "@/backend";
import type { PaymentReminder as CanisterReminder } from "@/backend";
import { Button } from "@/components/ui/button";
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
import type { Bill, PaymentReminder } from "@/types";
import { useActor } from "@caffeineai/core-infrastructure";
import { AlertCircle, Bell, Calendar, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().split("T")[0];
}

function genId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function formatCurrency(amount: number): string {
  return `\u20b9${amount.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function formatDate(ts: number): string {
  if (!ts) return "-";
  const d = new Date(ts);
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function isOverdue(dueDate: number): boolean {
  return dueDate < Date.now();
}

function reminderToCanister(r: PaymentReminder): CanisterReminder {
  return {
    id: r.id,
    billId: r.billId,
    billNumber: r.billNumber,
    customerName: r.customerName,
    amountDue: r.amountDue,
    dueDate: BigInt(r.dueDate) * 1_000_000n, // ms → ns
    notes: r.notes,
    createdAt: BigInt(r.createdAt) * 1_000_000n,
  };
}

function reminderFromCanister(r: CanisterReminder): PaymentReminder {
  return {
    id: r.id,
    billId: r.billId,
    billNumber: r.billNumber,
    customerName: r.customerName,
    amountDue: r.amountDue,
    dueDate: Number(r.dueDate / 1_000_000n),
    notes: r.notes,
    createdAt: Number(r.createdAt / 1_000_000n),
  };
}

// ─── Create Reminder Modal ─────────────────────────────────────────────────────

interface CreateReminderModalProps {
  open: boolean;
  bills: Bill[];
  onClose: () => void;
  onCreated: (reminder: PaymentReminder) => void;
}

function CreateReminderModal({
  open,
  bills,
  onClose,
  onCreated,
}: CreateReminderModalProps) {
  const [selectedBillId, setSelectedBillId] = useState("");
  const [dueDate, setDueDate] = useState(today());
  const [notes, setNotes] = useState("");

  const selectedBill = bills.find((b) => b.id === selectedBillId);
  const amountDue = selectedBill
    ? Math.max(0, selectedBill.grandTotal - selectedBill.amountPaid)
    : 0;

  const handleSave = useCallback(() => {
    if (!selectedBill || !dueDate) {
      toast.error("Please select a bill and due date.");
      return;
    }
    const reminder: PaymentReminder = {
      id: genId(),
      billId: selectedBill.id,
      billNumber: selectedBill.id.slice(0, 8).toUpperCase(),
      customerName: selectedBill.customerName,
      amountDue,
      dueDate: new Date(dueDate).getTime(),
      notes: notes.trim(),
      createdAt: Date.now(),
    };
    onCreated(reminder);
    setSelectedBillId("");
    setDueDate(today());
    setNotes("");
    onClose();
  }, [selectedBill, dueDate, notes, amountDue, onCreated, onClose]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm" data-ocid="reminders.dialog">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <Bell className="w-4 h-4 text-primary" />
            Create Reminder
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
              Select Bill
            </Label>
            <Select value={selectedBillId} onValueChange={setSelectedBillId}>
              <SelectTrigger data-ocid="reminders.select" className="text-sm">
                <SelectValue placeholder="Choose a bill..." />
              </SelectTrigger>
              <SelectContent>
                {bills.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.customerName || "—"} — {b.dateOfWork} (
                    {formatCurrency(Math.max(0, b.grandTotal - b.amountPaid))}{" "}
                    due)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedBill && (
            <div className="bg-secondary/50 rounded-lg p-3 text-xs space-y-1">
              <div className="font-semibold">{selectedBill.customerName}</div>
              <div className="text-muted-foreground">
                Outstanding:{" "}
                <strong className="text-red-600 dark:text-red-400">
                  {formatCurrency(amountDue)}
                </strong>
              </div>
            </div>
          )}

          <div>
            <Label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
              Due Date
            </Label>
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              min={today()}
              data-ocid="reminders.input"
            />
          </div>

          <div>
            <Label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
              Notes (optional)
            </Label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Call customer before visit"
              rows={3}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
              data-ocid="reminders.textarea"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <Button
              className="flex-1 bg-primary text-primary-foreground"
              onClick={handleSave}
              disabled={!selectedBillId || !dueDate}
              data-ocid="reminders.confirm_button"
            >
              <Bell className="w-4 h-4 mr-2" /> Save Reminder
            </Button>
            <Button
              variant="outline"
              onClick={onClose}
              data-ocid="reminders.cancel_button"
            >
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Reminder Row ─────────────────────────────────────────────────────────────

function ReminderRow({
  reminder,
  idx,
  onDelete,
}: { reminder: PaymentReminder; idx: number; onDelete: () => void }) {
  const overdue = isOverdue(reminder.dueDate);
  return (
    <div
      className={`bg-card border rounded-xl shadow-sm p-4 flex flex-wrap items-start gap-3 ${
        overdue ? "border-red-300 dark:border-red-700" : "border-border"
      }`}
      data-ocid={`reminders.item.${idx + 1}`}
    >
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold text-sm text-foreground">
            {reminder.customerName || "—"}
          </span>
          <span className="text-xs text-muted-foreground font-mono">
            #{reminder.billNumber}
          </span>
          {overdue ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700 border border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-700">
              <AlertCircle className="w-3 h-3" /> OVERDUE
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700">
              <Bell className="w-3 h-3" /> PENDING
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            Due:{" "}
            <strong
              className={
                overdue ? "text-red-600 dark:text-red-400" : "text-foreground"
              }
            >
              {formatDate(reminder.dueDate)}
            </strong>
          </span>
          <span>
            💰 Amount Due:{" "}
            <strong className="text-foreground">
              {formatCurrency(reminder.amountDue)}
            </strong>
          </span>
        </div>
        {reminder.notes && (
          <p className="text-xs text-muted-foreground italic">
            {reminder.notes}
          </p>
        )}
      </div>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7 text-destructive hover:bg-destructive/10 flex-shrink-0"
        onClick={onDelete}
        title="Delete reminder"
        aria-label="Delete reminder"
        data-ocid={`reminders.delete_button.${idx + 1}`}
      >
        <Trash2 className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}

// ─── RemindersView ────────────────────────────────────────────────────────────

interface RemindersViewProps {
  bills: Bill[];
}

export default function RemindersView({ bills }: RemindersViewProps) {
  const [reminders, setReminders] = useState<PaymentReminder[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const { actor } = useActor(createActor);

  const loadReminders = useCallback(async () => {
    if (!actor) return;
    setIsLoading(true);
    try {
      const raw = await actor.getReminders();
      const parsed = raw.map(reminderFromCanister);
      parsed.sort((a, b) => a.dueDate - b.dueDate);
      setReminders(parsed);
    } catch (e) {
      console.error("getReminders failed:", e);
    } finally {
      setIsLoading(false);
    }
  }, [actor]);

  useEffect(() => {
    loadReminders();
  }, [loadReminders]);

  const handleCreate = useCallback(
    async (reminder: PaymentReminder) => {
      if (!actor) {
        toast.error("Please log in to save reminders to the canister.");
        // Still add locally
        setReminders((prev) =>
          [...prev, reminder].sort((a, b) => a.dueDate - b.dueDate),
        );
        toast.success("Reminder created (local).");
        return;
      }
      try {
        await actor.createReminder(reminderToCanister(reminder));
        setReminders((prev) =>
          [...prev, reminder].sort((a, b) => a.dueDate - b.dueDate),
        );
        toast.success("Reminder saved!");
      } catch (e) {
        console.error("createReminder failed:", e);
        toast.error("Failed to save reminder.");
      }
    },
    [actor],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (actor) {
        try {
          await actor.deleteReminder(id);
        } catch (e) {
          console.error("deleteReminder failed:", e);
        }
      }
      setReminders((prev) => prev.filter((r) => r.id !== id));
      toast.success("Reminder deleted.");
    },
    [actor],
  );

  const overdue = reminders.filter((r) => isOverdue(r.dueDate));
  const upcoming = reminders.filter((r) => !isOverdue(r.dueDate));

  return (
    <div className="space-y-5">
      <CreateReminderModal
        open={showCreate}
        bills={bills}
        onClose={() => setShowCreate(false)}
        onCreated={handleCreate}
      />

      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-foreground">
            Payment Reminders
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {reminders.length} reminder{reminders.length !== 1 ? "s" : ""} ·{" "}
            {overdue.length} overdue
          </p>
        </div>
        <Button
          className="bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-semibold"
          onClick={() => setShowCreate(true)}
          data-ocid="reminders.open_modal_button"
        >
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          Create Reminder
        </Button>
      </div>

      {isLoading && (
        <div
          className="text-center py-8 text-sm text-muted-foreground"
          data-ocid="reminders.loading_state"
        >
          Loading reminders…
        </div>
      )}

      {!isLoading && reminders.length === 0 && (
        <div
          className="border-2 border-dashed border-border rounded-xl p-12 text-center"
          data-ocid="reminders.empty_state"
        >
          <Bell className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm font-medium text-muted-foreground">
            No reminders yet.
          </p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Click "Create Reminder" to schedule a payment follow-up.
          </p>
        </div>
      )}

      {overdue.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-500" />
            <h3 className="text-xs font-bold uppercase tracking-widest text-red-600 dark:text-red-400">
              Overdue ({overdue.length})
            </h3>
          </div>
          {overdue.map((r, i) => (
            <ReminderRow
              key={r.id}
              reminder={r}
              idx={i}
              onDelete={() => handleDelete(r.id)}
            />
          ))}
        </div>
      )}

      {upcoming.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-amber-500" />
            <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Upcoming ({upcoming.length})
            </h3>
          </div>
          {upcoming.map((r, i) => (
            <ReminderRow
              key={r.id}
              reminder={r}
              idx={overdue.length + i}
              onDelete={() => handleDelete(r.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
