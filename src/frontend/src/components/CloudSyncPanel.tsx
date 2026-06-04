// ─── CloudSyncPanel — Internet Computer canister sync ──────────────────────────
// Replaces Google Drive panel entirely.
// Shows: II login status, sync indicator, last synced, Sync Now, Backup/Restore.

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { useCanisterSync } from "@/hooks/useCanisterSync";
import {
  loadBills,
  loadCustomers,
  saveBills,
  saveCustomers,
} from "@/lib/storage";
import type { CanisterSyncStatus } from "@/types";
import { useInternetIdentity } from "@caffeineai/core-infrastructure";
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  CloudOff,
  Download,
  Info,
  Loader2,
  LogIn,
  LogOut,
  RefreshCw,
  Server,
  Upload,
} from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";

// ─── Re-exports for App.tsx backwards-compat ─────────────────────────────────
export { LS_PENDING_SYNC } from "@/lib/storage";

// ─── Sync status indicator ─────────────────────────────────────────────────

function SyncIndicator({ status }: { status: CanisterSyncStatus }) {
  if (status.status === "syncing")
    return (
      <Badge
        variant="secondary"
        className="text-xs gap-1"
        data-ocid="cloud.loading_state"
      >
        <Loader2 className="w-3 h-3 animate-spin" />
        Syncing…
      </Badge>
    );
  if (status.status === "success")
    return (
      <Badge
        variant="secondary"
        className="text-xs gap-1 bg-green-500/15 text-green-700 dark:text-green-400"
        data-ocid="cloud.success_state"
      >
        <CheckCircle2 className="w-3 h-3" />
        Synced
      </Badge>
    );
  if (status.status === "error")
    return (
      <Badge
        variant="destructive"
        className="text-xs gap-1"
        data-ocid="cloud.error_state"
      >
        <AlertCircle className="w-3 h-3" />
        Sync failed
      </Badge>
    );
  return (
    <Badge
      variant="outline"
      className="text-xs"
      data-ocid="cloud.loading_state"
    >
      ✓ Always saved locally
    </Badge>
  );
}

function lastSyncLabel(lastSynced: Date | null): string {
  if (!lastSynced) return "Never synced";
  const secs = Math.floor((Date.now() - lastSynced.getTime()) / 1000);
  if (secs < 5) return "Last synced: just now";
  if (secs < 60) return `Last synced: ${secs}s ago`;
  return `Last synced: ${Math.floor(secs / 60)}m ago`;
}

// ─── Props ──────────────────────────────────────────────────────────────────────

export interface CloudSyncPanelProps {
  syncStatus: CanisterSyncStatus;
  syncNow: () => Promise<void>;
  isLoggedIn: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CloudSyncPanel({
  syncStatus,
  syncNow,
  isLoggedIn,
}: CloudSyncPanelProps) {
  const { login, clear } = useInternetIdentity();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDownload = () => {
    const bills = loadBills();
    const customers = loadCustomers();
    const data = JSON.stringify(
      { bills, customers, exportedAt: new Date().toISOString() },
      null,
      2,
    );
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.download = `jcb-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.href = url;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Local backup downloaded!");
  };

  const handleRestore = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string) as {
          bills?: unknown;
          customers?: unknown;
        };
        if (Array.isArray(data.bills))
          saveBills(data.bills as Parameters<typeof saveBills>[0]);
        if (Array.isArray(data.customers))
          saveCustomers(data.customers as Parameters<typeof saveCustomers>[0]);
        toast.success("Backup restored! Reloading…");
        setTimeout(() => window.location.reload(), 1200);
      } catch {
        toast.error("Invalid backup file — please use a JCB backup JSON.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <div className="space-y-3">
      {/* ── Section 1: Internet Identity ─────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          {isLoggedIn ? (
            <Cloud className="w-4 h-4 text-green-500" />
          ) : (
            <CloudOff className="w-4 h-4 text-muted-foreground" />
          )}
          <span className="font-semibold text-sm">Internet Identity</span>
          {isLoggedIn && (
            <span className="ml-auto flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400 font-medium">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              Connected
            </span>
          )}
        </div>
        <div className="px-4 py-4">
          {isLoggedIn ? (
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Your bills are syncing to this device&apos;s canister account.
                Sign in on any device with the same identity to see all your
                bills.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="ml-4 flex-shrink-0 gap-1.5"
                onClick={clear}
                data-ocid="cloud.sign_out_button"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign out
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2.5">
                <Info className="w-3.5 h-3.5 text-amber-600 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Sign in with Internet Identity to sync your bills across all
                  devices automatically. No account setup required.
                </p>
              </div>
              <Button
                size="sm"
                className="w-full gap-2 bg-primary text-primary-foreground"
                onClick={login}
                data-ocid="cloud.sign_in_button"
              >
                <LogIn className="w-3.5 h-3.5" />
                Login with Internet Identity
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* ── Section 2: Sync Status ───────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <RefreshCw
            className={`w-4 h-4 text-primary ${
              syncStatus.status === "syncing" ? "animate-spin" : ""
            }`}
          />
          <span className="font-semibold text-sm">Canister Sync</span>
          {isLoggedIn && (
            <span className="ml-auto text-[11px] font-medium px-2 py-0.5 rounded-full bg-green-500/15 text-green-700 dark:text-green-400">
              Auto-sync every 1.5s
            </span>
          )}
        </div>
        <div className="px-4 py-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground space-y-0.5">
              <div>{lastSyncLabel(syncStatus.lastSynced)}</div>
              {syncStatus.error && (
                <div className="text-xs font-medium text-destructive">
                  {syncStatus.error}
                </div>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={syncNow}
              disabled={!isLoggedIn || syncStatus.status === "syncing"}
              className="gap-1.5"
              data-ocid="cloud.sync_now_button"
            >
              {syncStatus.status === "syncing" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              {syncStatus.status === "syncing" ? "Syncing…" : "Sync Now"}
            </Button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <SyncIndicator status={syncStatus} />
            <Badge variant="outline" className="text-xs gap-1">
              <Server className="w-3 h-3" />
              Internet Computer
            </Badge>
          </div>

          {!isLoggedIn && (
            <p className="text-[11px] text-muted-foreground">
              Login with Internet Identity above to enable cross-device sync.
              Your local bills are always available offline.
            </p>
          )}
        </div>
      </div>

      <Separator />

      {/* ── Section 3: Local Backup ──────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Download className="w-4 h-4 text-primary" />
          <span className="font-semibold text-sm">Local Backup</span>
          <Badge variant="secondary" className="text-xs ml-auto">
            No internet needed
          </Badge>
        </div>
        <div className="px-4 py-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Download all your bills and customers as a JSON file. Restore on any
            device at any time.{" "}
            <strong className="text-foreground">
              Restoring will overwrite current data.
            </strong>
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 gap-1.5"
              onClick={handleDownload}
              data-ocid="cloud.download_backup_button"
            >
              <Download className="w-3.5 h-3.5" />
              Download Backup
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1 gap-1.5"
              onClick={() => fileInputRef.current?.click()}
              data-ocid="cloud.restore_backup_button"
            >
              <Upload className="w-3.5 h-3.5" />
              Restore Backup
            </Button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleRestore}
          />
        </div>
      </div>
    </div>
  );
}
