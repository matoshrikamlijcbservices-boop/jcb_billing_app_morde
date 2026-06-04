// ─── Canister Sync Hook ───────────────────────────────────────────────────────
// Polls getBills() and getCustomers() every 1500ms after II login.
// Merges canister data into localStorage so offline mode works.

import { createActor } from "@/backend";
import type {
  Bill as CanisterBill,
  Customer as CanisterCustomer,
} from "@/backend";
import {
  DEFAULT_RATES,
  loadBills,
  loadCustomers,
  loadRates,
  saveBills,
  saveCustomers,
  saveRates,
} from "@/lib/storage";
import type { Bill, CanisterSyncStatus, Customer, Rates } from "@/types";
import { useInternetIdentity } from "@caffeineai/core-infrastructure";
import { useActor } from "@caffeineai/core-infrastructure";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

// ─── Type conversion helpers ──────────────────────────────────────────────────

/** Convert frontend Bill → canister Bill (bigint savedAt, string machine number, entryType) */
export function billToCanister(bill: Bill): CanisterBill {
  return {
    id: bill.id,
    savedAt: BigInt(new Date(bill.savedAt).getTime()) * 1_000_000n, // ms → ns
    customerName: bill.customerName,
    customerContact: bill.customerContact,
    dateOfWork: bill.dateOfWork,
    paymentDate: bill.paymentDate,
    rates: { bucket: bill.rates.bucket, breaker: bill.rates.breaker },
    machines: bill.machines.map((m) => ({
      id: m.id,
      number: String(m.number),
      entries: m.entries.map((e) => ({
        id: e.id,
        entryType: e.type,
        startTime: e.startTime,
        endTime: e.endTime,
      })),
    })),
    amountPaid: bill.amountPaid,
    grandTotal: bill.grandTotal,
    bucketTotalHours: bill.bucketTotalHours,
    bucketTotalCost: bill.bucketTotalCost,
    breakerTotalHours: bill.breakerTotalHours,
    breakerTotalCost: bill.breakerTotalCost,
    paymentStatus: bill.paymentStatus,
  };
}

/** Convert canister Bill → frontend Bill (string savedAt, number machine number, type field) */
export function billFromCanister(cb: CanisterBill): Bill {
  const savedAtMs = Number(cb.savedAt / 1_000_000n);
  return {
    id: cb.id,
    savedAt: new Date(savedAtMs).toISOString(),
    customerName: cb.customerName,
    customerContact: cb.customerContact,
    dateOfWork: cb.dateOfWork,
    paymentDate: cb.paymentDate,
    rates: { bucket: cb.rates.bucket, breaker: cb.rates.breaker },
    machines: cb.machines.map((m) => ({
      id: m.id,
      number: Number(m.number) || 1,
      entries: m.entries.map((e) => ({
        id: e.id,
        type: (e.entryType === "breaker" ? "breaker" : "bucket") as
          | "bucket"
          | "breaker",
        startTime: e.startTime,
        endTime: e.endTime,
      })),
    })),
    amountPaid: cb.amountPaid,
    grandTotal: cb.grandTotal,
    bucketTotalHours: cb.bucketTotalHours,
    bucketTotalCost: cb.bucketTotalCost,
    breakerTotalHours: cb.breakerTotalHours,
    breakerTotalCost: cb.breakerTotalCost,
    paymentStatus: cb.paymentStatus as Bill["paymentStatus"],
  };
}

/** Convert frontend Customer → canister Customer */
export function customerToCanister(c: Customer): CanisterCustomer {
  return {
    name: c.name,
    contact: c.contact,
    updatedAt: BigInt(c.updatedAt ?? Date.now()) * 1_000_000n,
  };
}

/** Convert canister Customer → frontend Customer */
export function customerFromCanister(cc: CanisterCustomer): Customer {
  return {
    name: cc.name,
    contact: cc.contact,
    updatedAt: Number(cc.updatedAt / 1_000_000n),
  };
}

// ─── Merge helpers ────────────────────────────────────────────────────────────

function mergeBills(
  local: Bill[],
  remote: Bill[],
): { merged: Bill[]; newCount: number } {
  const map = new Map<string, Bill>();
  for (const b of local) map.set(b.id, b);
  let newCount = 0;
  for (const b of remote) {
    const existing = map.get(b.id);
    if (!existing) {
      map.set(b.id, b);
      newCount++;
    } else {
      const remoteTime = b.savedAt ? new Date(b.savedAt).getTime() : 0;
      const localTime = existing.savedAt
        ? new Date(existing.savedAt).getTime()
        : 0;
      if (remoteTime > localTime) map.set(b.id, b);
    }
  }
  return { merged: Array.from(map.values()), newCount };
}

function mergeCustomers(local: Customer[], remote: Customer[]): Customer[] {
  const map = new Map<string, Customer>();
  for (const c of local) map.set(`${c.name}|${c.contact}`, c);
  for (const c of remote) {
    const key = `${c.name}|${c.contact}`;
    const existing = map.get(key);
    if (!existing || (c.updatedAt ?? 0) >= (existing.updatedAt ?? 0))
      map.set(key, c);
  }
  return Array.from(map.values());
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useCanisterSync(onDataRefresh?: () => void) {
  const { loginStatus, identity } = useInternetIdentity();
  const isLoggedIn = loginStatus === "success";

  const { actor, isFetching } = useActor(createActor);

  const [syncStatus, setSyncStatus] = useState<CanisterSyncStatus>({
    status: "idle",
    lastSynced: null,
    error: null,
  });

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isSyncingRef = useRef(false);
  // isPaused: incremented by pauseSync, decremented by resumeSync
  // Use a counter so nested pause/resume calls balance correctly
  const pauseCountRef = useRef(0);
  const actorRef = useRef(actor);
  // Track the last bills JSON snapshot so we only call onDataRefresh when data changes
  const prevBillsJsonRef = useRef<string | null>(null);
  useEffect(() => {
    actorRef.current = actor;
  }, [actor]);

  // ── Pull from canister and merge ──────────────────────────────────────────
  const pullFromCanister = useCallback(
    async (silent = false): Promise<number> => {
      const a = actorRef.current;
      if (!a) return 0;
      if (!silent)
        setSyncStatus((s) => ({ ...s, status: "syncing", error: null }));

      try {
        const [canisterBills, canisterCustomers, canisterRates] =
          await Promise.all([a.getBills(), a.getCustomers(), a.getRates()]);

        const remoteBills = canisterBills.map(billFromCanister);
        const remoteCustomers = canisterCustomers.map(customerFromCanister);

        const localBills = loadBills();
        const localCustomers = loadCustomers();

        const { merged: mergedBills, newCount } = mergeBills(
          localBills,
          remoteBills,
        );
        const mergedCustomers = mergeCustomers(localCustomers, remoteCustomers);

        saveBills(mergedBills);
        saveCustomers(mergedCustomers);

        // Merge rates — canister wins if available
        if (canisterRates) {
          const localRates = loadRates();
          const merged: Rates = {
            bucket: canisterRates.bucket || localRates.bucket,
            breaker: canisterRates.breaker || localRates.breaker,
          };
          saveRates(merged);
        }

        setSyncStatus({
          status: "success",
          lastSynced: new Date(),
          error: null,
        });

        // Only call onDataRefresh if the bills data actually changed
        const newBillsJson = JSON.stringify(mergedBills);
        if (prevBillsJsonRef.current !== newBillsJson) {
          prevBillsJsonRef.current = newBillsJson;
          onDataRefresh?.();
        }
        return newCount;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Sync failed";
        setSyncStatus({ status: "error", lastSynced: null, error: msg });
        return 0;
      }
    },
    [onDataRefresh],
  );

  const pullRef = useRef(pullFromCanister);
  useEffect(() => {
    pullRef.current = pullFromCanister;
  }, [pullFromCanister]);

  // ── Initial pull on login ────────────────────────────────────────────────
  const prevLoginStatus = useRef(loginStatus);
  useEffect(() => {
    const wasLoggedOut = prevLoginStatus.current !== "success";
    prevLoginStatus.current = loginStatus;

    if (isLoggedIn && wasLoggedOut && actor && !isFetching) {
      pullRef.current(false).then((newCount) => {
        if (newCount > 0)
          toast.success(
            `Synced from canister — ${newCount} new bill${newCount !== 1 ? "s" : ""} added!`,
          );
      });
    }
  }, [isLoggedIn, actor, isFetching, loginStatus]);

  // ── Pause / Resume sync ──────────────────────────────────────────────────
  // Call pauseSync() when user is actively interacting with UI.
  // Call resumeSync() when user is done. Calls are reference-counted so
  // nested pauses work: each pauseSync() must be matched by a resumeSync().
  const pauseSync = useCallback(() => {
    pauseCountRef.current += 1;
  }, []);
  const resumeSync = useCallback(() => {
    pauseCountRef.current = Math.max(0, pauseCountRef.current - 1);
  }, []);

  // ── Auto-sync polling ────────────────────────────────────────────────────
  // Interval is 30s — long enough that background polls never disrupt active
  // UI interactions; short enough to stay reasonably in sync across devices.
  const stopInterval = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isLoggedIn || !actor || isFetching) {
      stopInterval();
      return;
    }
    stopInterval();
    intervalRef.current = setInterval(async () => {
      // Skip poll while user is actively using the UI
      if (
        isSyncingRef.current ||
        !navigator.onLine ||
        pauseCountRef.current > 0
      )
        return;
      isSyncingRef.current = true;
      try {
        await pullRef.current(true);
      } catch {
        // silent — will retry next tick
      } finally {
        isSyncingRef.current = false;
      }
    }, 30_000);
    return stopInterval;
  }, [isLoggedIn, actor, isFetching, stopInterval]);

  // ── Resume on reconnect ──────────────────────────────────────────────────
  useEffect(() => {
    const handleOnline = () => {
      if (isLoggedIn && actor) pullRef.current(false);
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [isLoggedIn, actor]);

  // ── Exposed syncNow ───────────────────────────────────────────────────────
  const syncNow = useCallback(async () => {
    await pullRef.current(false);
  }, []);

  // ── Write helpers (fire-and-forget to canister) ───────────────────────────
  const canisterCreateBill = useCallback(
    (bill: Bill) => {
      const a = actorRef.current;
      if (!a || !isLoggedIn) return;
      a.createBill(billToCanister(bill))
        .then(() => {
          toast.success("Saved to cloud ✓", { duration: 3000 });
        })
        .catch((e) => console.warn("canister createBill failed:", e));
    },
    [isLoggedIn],
  );

  const canisterUpdateBill = useCallback(
    (bill: Bill) => {
      const a = actorRef.current;
      if (!a || !isLoggedIn) return;
      a.updateBill(billToCanister(bill))
        .then(() => {
          toast.success("Bill updated in cloud ✓", { duration: 3000 });
        })
        .catch((e) => console.warn("canister updateBill failed:", e));
    },
    [isLoggedIn],
  );

  const canisterDeleteBill = useCallback(
    (id: string) => {
      const a = actorRef.current;
      if (!a || !isLoggedIn) return;
      a.deleteBill(id).catch((e) =>
        console.warn("canister deleteBill failed:", e),
      );
    },
    [isLoggedIn],
  );

  const canisterUpsertCustomer = useCallback(
    (c: Customer) => {
      const a = actorRef.current;
      if (!a || !isLoggedIn) return;
      a.upsertCustomer(customerToCanister(c)).catch((e) =>
        console.warn("canister upsertCustomer failed:", e),
      );
    },
    [isLoggedIn],
  );

  const canisterSetRates = useCallback(
    (r: Rates) => {
      const a = actorRef.current;
      if (!a || !isLoggedIn) return;
      a.setRates(r).catch((e) => console.warn("canister setRates failed:", e));
    },
    [isLoggedIn],
  );

  return {
    syncStatus,
    syncNow,
    pauseSync,
    resumeSync,
    isLoggedIn,
    identity,
    canisterCreateBill,
    canisterUpdateBill,
    canisterDeleteBill,
    canisterUpsertCustomer,
    canisterSetRates,
  };
}
