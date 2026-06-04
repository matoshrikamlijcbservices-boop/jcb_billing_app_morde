// Export utilities for JCB bills
// PNG: pure Canvas 2D API — no html2canvas, works in ALL browsers
// PDF batch: pure jsPDF vector text — no screenshots, <100KB per customer

import type { Bill, PaymentEntry } from "@/types";
import jsPDF from "jspdf";
import QRCode from "qrcode";

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtCurrency(amount: number): string {
  return `\u20b9${amount.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function fmtDate(dateStr: string): string {
  if (!dateStr) return "-";
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}

function toMinutes(timeStr: string): number {
  if (!timeStr) return -1;
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

/** Build a safe filename from customer name */
export function buildExportFilename(
  customerName: string,
  date: string,
  ext: "png" | "pdf",
): string {
  const safeName = (customerName || "Bill")
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 40);
  const safeDate = (date || new Date().toISOString().split("T")[0]).replace(
    /[^0-9-]/g,
    "",
  );
  return `bill-${safeName}-${safeDate}.${ext}`;
}

// ─── Customer grouping ────────────────────────────────────────────────────────

export type GroupedBill = {
  customerName: string;
  customerContact: string;
  bills: Bill[];
};

/**
 * Group bills by (customerName + contactNumber) only.
 * Both fields are trimmed and lowercased before comparison so
 * minor spacing/case differences do NOT create separate groups.
 * Bills within each group are sorted oldest → newest by dateOfWork.
 */
export function groupBillsByCustomer(bills: Bill[]): GroupedBill[] {
  const map = new Map<string, GroupedBill>();
  for (const bill of bills) {
    const key = `${(bill.customerName || "").trim().toLowerCase()}|${(bill.customerContact || "").trim().toLowerCase()}`;
    if (!map.has(key)) {
      map.set(key, {
        customerName: bill.customerName || "-",
        customerContact: bill.customerContact || "",
        bills: [],
      });
    }
    map.get(key)!.bills.push(bill);
  }
  for (const group of map.values()) {
    group.bills.sort((a, b) => a.dateOfWork.localeCompare(b.dateOfWork));
  }
  // Sort groups by their oldest bill date
  return Array.from(map.values()).sort((a, b) =>
    (a.bills[0]?.dateOfWork ?? "").localeCompare(b.bills[0]?.dateOfWork ?? ""),
  );
}

// ─── Bill row data extractor ──────────────────────────────────────────────────

interface BillRowData {
  date: string;
  startTime: string;
  endTime: string;
  machineType: string;
  totalHours: number;
  grandTotal: number;
  amountPaid: number;
  remaining: number;
  paymentStatus: string;
}

function extractBillRowData(bill: Bill): BillRowData {
  let earliestStart = "";
  let latestEnd = "";
  let earliestMin = Number.POSITIVE_INFINITY;
  let latestMin = Number.NEGATIVE_INFINITY;
  const types = new Set<string>();

  for (const machine of bill.machines) {
    for (const entry of machine.entries) {
      // Defensive: handle both `type` (frontend shape) and `entryType` (canister shape)
      // in case stale data is encountered from localStorage or mock backends.
      const entryType =
        entry.type ||
        (entry as unknown as Record<string, string>).entryType ||
        "";
      types.add(entryType);
      const sm = toMinutes(entry.startTime);
      const em = toMinutes(entry.endTime);
      if (sm >= 0 && sm < earliestMin) {
        earliestMin = sm;
        earliestStart = entry.startTime;
      }
      if (em >= 0 && em > latestMin) {
        latestMin = em;
        latestEnd = entry.endTime;
      }
    }
  }

  const machineType =
    types.has("bucket") && types.has("breaker")
      ? "Both"
      : types.has("bucket")
        ? "Bucket"
        : types.has("breaker")
          ? "Breaker"
          : "-";

  return {
    date: fmtDate(bill.dateOfWork),
    startTime: earliestStart || "-",
    endTime: latestEnd || "-",
    machineType,
    totalHours: (bill.bucketTotalHours || 0) + (bill.breakerTotalHours || 0),
    grandTotal: bill.grandTotal,
    amountPaid: bill.amountPaid,
    remaining: Math.max(0, bill.grandTotal - bill.amountPaid),
    paymentStatus: bill.paymentStatus,
  };
}

// ─── iOS Safari detection ────────────────────────────────────────────────────

function isIOSSafari(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !(window as { MSStream?: unknown }).MSStream
  );
}

// ─── Download helper ──────────────────────────────────────────────────────────

/**
 * Convert a Blob to a base64 data URL.
 * FileReader.readAsDataURL is supported on all browsers including iOS Safari.
 */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof FileReader === "undefined") {
      // Very old browser — fall back to blob URL
      resolve(URL.createObjectURL(blob));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Cross-platform reliable download:
 * - Converts Blob to base64 data URL via FileReader
 * - Uses anchor.download + href = data URL for all browsers
 * - Data URLs work on iOS Safari, Android Chrome, Firefox, Edge
 * - Does NOT rely on blob URLs (URL.createObjectURL) which fail on mobile
 * - Does NOT use window.open() for iOS — data URL anchor is compatible
 */
async function triggerDownload(
  blob: Blob,
  filename: string,
  _mimeType: string,
): Promise<void> {
  // iOS Safari doesn't support URL.createObjectURL for downloads —
  // it opens the file in a new tab instead of downloading.
  // For all other platforms, URL.createObjectURL is the most reliable approach.
  // Data URLs can be too large for browser download limits (typically ~2MB cap on some browsers).
  if (isIOSSafari()) {
    // iOS: convert to base64 data URL and use anchor download
    try {
      const dataUrl = await blobToDataUrl(blob);
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = filename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        try {
          document.body.removeChild(a);
        } catch {
          /* already removed */
        }
      }, 1000);
      return;
    } catch (err) {
      console.error("triggerDownload: iOS data URL approach failed", err);
    }
  }
  // Primary approach for all non-iOS browsers: blob URL
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    // Remove anchor after a short delay
    setTimeout(() => {
      try {
        document.body.removeChild(a);
      } catch {
        /* already removed */
      }
      URL.revokeObjectURL(url);
    }, 2000);
    return;
  } catch (err) {
    console.error(
      "triggerDownload: blob URL approach failed, falling back to data URL",
      err,
    );
  }
  // Last resort fallback: data URL
  try {
    const dataUrl = await blobToDataUrl(blob);
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try {
        document.body.removeChild(a);
      } catch {
        /* already removed */
      }
    }, 1000);
  } catch (err) {
    console.error("triggerDownload: all download approaches failed", err);
    throw err;
  }
}

// ─── Canvas → Blob (with fallback for older browsers) ────────────────────────

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob === "function") {
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("toBlob returned null")),
        "image/png",
      );
    } else {
      // Fallback: toDataURL → ArrayBuffer → Blob
      const dataURL = canvas.toDataURL("image/png");
      const parts = dataURL.split(",");
      const byteStr = atob(parts[1]);
      const ab = new ArrayBuffer(byteStr.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteStr.length; i++) ia[i] = byteStr.charCodeAt(i);
      resolve(new Blob([ab], { type: "image/png" }));
    }
  });
}

// ─── Pure Canvas 2D PNG drawing ───────────────────────────────────────────────
// A4 portrait: 794px wide @ 1x, scaled ×2 for HD = 1588px actual canvas width
// A4 ratio: 210mm × 297mm → 794px wide → height = 794 * (297/210) ≈ 1123px per page

const BATCH_SCALE = 2; // HiDPI: canvas is drawn at 2× then CSS-scaled
const CANVAS_W = 794; // logical A4 width in px
const A4_H = Math.round(CANVAS_W * (297 / 210)); // ≈ 1123px — one A4 page height
const PAD_X = 30; // left/right padding
const TABLE_X = PAD_X;

// Columns must fit within (794 - 2*30) = 734px
const COL_WIDTHS = [30, 72, 68, 68, 56, 52, 98, 98, 98, 94]; // sum = 734
const COL_HEADERS = [
  "Sr",
  "Date",
  "Start",
  "End",
  "Type",
  "Hours",
  "Amount (\u20b9)",
  "Paid (\u20b9)",
  "Remaining (\u20b9)",
  "Status",
];
const COL_ALIGN = [
  "center",
  "center",
  "center",
  "center",
  "center",
  "right",
  "right",
  "right",
  "right",
  "center",
] as const;

const TABLE_W = COL_WIDTHS.reduce((s, w) => s + w, 0); // 734

const ROW_H = 26;
const HEADER_ROW_H = 30;
const FONT_BASE = "Arial, sans-serif";

function colXCanvas(i: number): number {
  let x = TABLE_X;
  for (let j = 0; j < i; j++) x += COL_WIDTHS[j];
  return x;
}

function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  align: "left" | "center" | "right" = "left",
): void {
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
}
function drawCustomerCanvasPNG(group: GroupedBill): HTMLCanvasElement {
  const billCount = group.bills.length;

  // Palette (matches single-bill)
  const NAVY = "#1a2744";
  const NAVY_LIGHT = "#243358";
  const AMBER = "#f59e0b";
  const AMBER_LIGHT = "#fcd34d";
  const AMBER_PALE = "#fffbeb";
  const AMBER_ROW = "#fff8e1";
  const WHITE = "#ffffff";
  const DARK_TEXT = "#1a2744";
  const MUTED_TEXT = "#9ca3af";
  const BORDER_COLOR = "#e5e7eb";

  // Measure content height
  const HEADER_BAND_H = 120;
  const INFO_SECTION_H = 80;
  const tableH = HEADER_ROW_H + ROW_H * billCount + (ROW_H + 4);
  const SIG_H = 50;
  const FOOTER_H = 80;
  const TOP_EXTRA = 8;
  const contentH =
    HEADER_BAND_H + TOP_EXTRA + INFO_SECTION_H + 20 + tableH + SIG_H + FOOTER_H;

  const pages = Math.max(1, Math.ceil(contentH / A4_H));
  const canvasH = pages * A4_H;

  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_W * BATCH_SCALE;
  canvas.height = canvasH * BATCH_SCALE;

  const ctx = canvas.getContext("2d")!;
  ctx.scale(BATCH_SCALE, BATCH_SCALE);

  // White background
  ctx.fillStyle = WHITE;
  ctx.fillRect(0, 0, CANVAS_W, canvasH);

  // Page-break lines
  if (pages > 1) {
    ctx.strokeStyle = "#d1d5db";
    ctx.lineWidth = 0.5;
    ctx.setLineDash([4, 4]);
    for (let p = 1; p < pages; p++) {
      const lineY = p * A4_H;
      ctx.beginPath();
      ctx.moveTo(0, lineY);
      ctx.lineTo(CANVAS_W, lineY);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // ══════════════════════════════════════════════
  // DECORATIVE LEFT WAVE SWOOSHES (amber, semi-transparent)
  // ══════════════════════════════════════════════
  ctx.save();
  ctx.globalAlpha = 0.18;
  for (let wi = 0; wi < 5; wi++) {
    const waveX = -18 + wi * 9;
    const amp = 22 + wi * 4;
    ctx.strokeStyle = AMBER;
    ctx.lineWidth = 7 - wi;
    ctx.beginPath();
    ctx.moveTo(waveX, 0);
    for (let wy = 0; wy < canvasH; wy += 60) {
      ctx.bezierCurveTo(
        waveX + amp,
        wy + 15,
        waveX - amp,
        wy + 45,
        waveX,
        wy + 60,
      );
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // ══════════════════════════════════════════════
  // DECORATIVE BOTTOM-RIGHT ACCENT SWOOSH
  // ══════════════════════════════════════════════
  ctx.save();
  ctx.globalAlpha = 0.13;
  for (let wi = 0; wi < 4; wi++) {
    ctx.strokeStyle = AMBER;
    ctx.lineWidth = 8 - wi * 1.5;
    ctx.beginPath();
    ctx.moveTo(CANVAS_W - 60 + wi * 8, canvasH);
    ctx.bezierCurveTo(
      CANVAS_W + 20,
      canvasH - 100,
      CANVAS_W - 140 + wi * 10,
      canvasH - 60,
      CANVAS_W - 80 + wi * 8,
      canvasH - 160,
    );
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // ══════════════════════════════════════════════
  // NAVY HEADER BAND
  // ══════════════════════════════════════════════
  ctx.fillStyle = NAVY;
  ctx.fillRect(0, 0, CANVAS_W, HEADER_BAND_H);

  // Amber accent stripe at top
  ctx.fillStyle = AMBER;
  ctx.fillRect(0, 0, CANVAS_W, 5);

  // LEFT: 'STATEMENT' large bold title
  ctx.fillStyle = WHITE;
  ctx.font = `bold 38px ${FONT_BASE}`;
  ctx.textAlign = "left";
  ctx.fillText("STATEMENT", PAD_X, 56);

  // Company name below title
  ctx.fillStyle = AMBER_LIGHT;
  ctx.font = `bold 12px ${FONT_BASE}`;
  ctx.textAlign = "left";
  ctx.fillText("Matoshri Kamljadevi Earthmovers & Land Developers", PAD_X, 76);

  // Contact info
  ctx.fillStyle = "rgba(255,255,255,0.65)";
  ctx.font = `10px ${FONT_BASE}`;
  ctx.fillText("9890989473 (Google Pay)  ·  7588623501", PAD_X, 94);

  // RIGHT: Statement meta
  const dateRange =
    group.bills.length > 0
      ? `${fmtDate(group.bills[0].dateOfWork)} – ${fmtDate(group.bills[group.bills.length - 1].dateOfWork)}`
      : "—";
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = `10px ${FONT_BASE}`;
  ctx.textAlign = "right";
  ctx.fillText("TOTAL BILLS", CANVAS_W - PAD_X, 54);
  ctx.fillStyle = AMBER_LIGHT;
  ctx.font = `bold 13px ${FONT_BASE}`;
  ctx.textAlign = "right";
  ctx.fillText(String(group.bills.length), CANVAS_W - PAD_X, 70);

  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = `10px ${FONT_BASE}`;
  ctx.textAlign = "right";
  ctx.fillText("DATE RANGE", CANVAS_W - PAD_X, 90);
  ctx.fillStyle = WHITE;
  ctx.font = `bold 10px ${FONT_BASE}`;
  ctx.textAlign = "right";
  ctx.fillText(dateRange, CANVAS_W - PAD_X, 104);

  let y = HEADER_BAND_H + TOP_EXTRA + 16;

  // ══════════════════════════════════════════════
  // INFO SECTION — two columns: BILL TO (left) | meta (right)
  // ══════════════════════════════════════════════
  const INFO_COL_L = PAD_X;
  const INFO_BOX_W = Math.round(TABLE_W * 0.52);
  const INFO_COL_R_X = PAD_X + INFO_BOX_W + 20;
  const INFO_COL_R_W = TABLE_W - INFO_BOX_W - 20;
  const INFO_BOX_H = 72;

  // LEFT — amber-pale BILL TO box
  ctx.fillStyle = AMBER_PALE;
  ctx.strokeStyle = AMBER;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(INFO_COL_L, y, INFO_BOX_W, INFO_BOX_H, 6);
  ctx.fill();
  ctx.stroke();

  // Amber left accent bar
  ctx.fillStyle = AMBER;
  ctx.beginPath();
  ctx.roundRect(INFO_COL_L, y, 4, INFO_BOX_H, [6, 0, 0, 6]);
  ctx.fill();

  ctx.fillStyle = AMBER;
  ctx.font = `bold 10px ${FONT_BASE}`;
  ctx.textAlign = "left";
  ctx.fillText("BILL TO", INFO_COL_L + 16, y + 20);

  ctx.fillStyle = DARK_TEXT;
  ctx.font = `bold 18px ${FONT_BASE}`;
  ctx.fillText(group.customerName, INFO_COL_L + 16, y + 42);

  if (group.customerContact) {
    ctx.fillStyle = "#4b5563";
    ctx.font = `12px ${FONT_BASE}`;
    ctx.fillText(`\u260E  ${group.customerContact}`, INFO_COL_L + 16, y + 62);
  }

  // RIGHT — meta info
  const totalGrandMeta = group.bills.reduce((s, b) => s + b.grandTotal, 0);
  const totalPaidMeta = group.bills.reduce((s, b) => s + b.amountPaid, 0);
  const totalRemainingMeta = Math.max(0, totalGrandMeta - totalPaidMeta);
  const metaItems: [string, string][] = [
    ["Bills Count", String(group.bills.length)],
    ["Total Charged", fmtCurrency(totalGrandMeta)],
    ["Total Paid", fmtCurrency(totalPaidMeta)],
    [
      "Outstanding",
      totalRemainingMeta > 0 ? fmtCurrency(totalRemainingMeta) : "Fully Paid",
    ],
  ];
  const META_ROW_H = 18;
  for (let mi = 0; mi < metaItems.length; mi++) {
    const [label, val] = metaItems[mi];
    const my = y + mi * META_ROW_H;
    ctx.fillStyle = MUTED_TEXT;
    ctx.font = `9px ${FONT_BASE}`;
    ctx.textAlign = "left";
    ctx.fillText(label, INFO_COL_R_X, my + 12);
    ctx.fillStyle = DARK_TEXT;
    ctx.font = `bold 11px ${FONT_BASE}`;
    ctx.textAlign = "right";
    ctx.fillText(val, INFO_COL_R_X + INFO_COL_R_W, my + 12);
    if (mi < metaItems.length - 1) {
      ctx.strokeStyle = BORDER_COLOR;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(INFO_COL_R_X, my + 18);
      ctx.lineTo(INFO_COL_R_X + INFO_COL_R_W, my + 18);
      ctx.stroke();
    }
  }

  y += INFO_BOX_H + 14;

  // Amber divider
  ctx.strokeStyle = AMBER;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(PAD_X, y);
  ctx.lineTo(CANVAS_W - PAD_X, y);
  ctx.stroke();
  y += 14;

  // ══════════════════════════════════════════════
  // TABLE HEADER — navy background, white text
  // ══════════════════════════════════════════════
  ctx.fillStyle = NAVY;
  ctx.beginPath();
  ctx.roundRect(TABLE_X, y, TABLE_W, HEADER_ROW_H, [6, 6, 0, 0]);
  ctx.fill();

  ctx.fillStyle = WHITE;
  ctx.font = `bold 11px ${FONT_BASE}`;
  for (let i = 0; i < COL_HEADERS.length; i++) {
    const cx = colXCanvas(i);
    const textX =
      COL_ALIGN[i] === "right"
        ? cx + COL_WIDTHS[i] - 6
        : COL_ALIGN[i] === "center"
          ? cx + COL_WIDTHS[i] / 2
          : cx + 6;
    drawText(
      ctx,
      COL_HEADERS[i],
      textX,
      y + HEADER_ROW_H / 2 + 4,
      COL_ALIGN[i],
    );
  }
  y += HEADER_ROW_H;

  // ══════════════════════════════════════════════
  // DATA ROWS — alternating white / amber-pale
  // ══════════════════════════════════════════════
  ctx.font = `11px ${FONT_BASE}`;

  for (let i = 0; i < group.bills.length; i++) {
    const d = extractBillRowData(group.bills[i]);
    const bg = i % 2 === 0 ? WHITE : AMBER_ROW;
    ctx.fillStyle = bg;
    ctx.fillRect(TABLE_X, y, TABLE_W, ROW_H);

    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 0.4;
    let rx = TABLE_X;
    for (const w of COL_WIDTHS) {
      ctx.strokeRect(rx, y, w, ROW_H);
      rx += w;
    }

    const cells = [
      String(i + 1),
      d.date,
      d.startTime,
      d.endTime,
      d.machineType,
      d.totalHours > 0 ? d.totalHours.toFixed(2) : "-",
      fmtCurrency(d.grandTotal),
      d.amountPaid > 0 ? fmtCurrency(d.amountPaid) : "-",
      d.remaining > 0 ? fmtCurrency(d.remaining) : "\u2014",
      d.paymentStatus,
    ];

    const textColors = [
      "#111827",
      "#111827",
      "#111827",
      "#111827",
      "#111827",
      "#111827",
      "#111827",
      "#166534",
      d.remaining > 0 ? "#b91c1c" : "#166534",
      d.paymentStatus === "PAID"
        ? "#166534"
        : d.paymentStatus === "PARTIALLY PAID"
          ? "#92400e"
          : "#b91c1c",
    ];

    for (let ci = 0; ci < cells.length; ci++) {
      const cx = colXCanvas(ci);
      const textX =
        COL_ALIGN[ci] === "right"
          ? cx + COL_WIDTHS[ci] - 6
          : COL_ALIGN[ci] === "center"
            ? cx + COL_WIDTHS[ci] / 2
            : cx + 6;
      ctx.fillStyle = textColors[ci];
      drawText(ctx, cells[ci], textX, y + ROW_H / 2 + 4, COL_ALIGN[ci]);
    }
    y += ROW_H;
  }

  // ══════════════════════════════════════════════
  // GRAND TOTAL ROW (no borders)
  // ══════════════════════════════════════════════
  const totalGrand = group.bills.reduce((s, b) => s + b.grandTotal, 0);
  const totalPaid = group.bills.reduce((s, b) => s + b.amountPaid, 0);
  const totalRemaining = Math.max(0, totalGrand - totalPaid);

  const totH = ROW_H + 4;
  ctx.fillStyle = "#fef3c7";
  ctx.fillRect(TABLE_X, y, TABLE_W, totH);
  // NOTE: No strokeRect border on Grand Total row cells

  ctx.font = `bold 11px ${FONT_BASE}`;

  const labelEndX = colXCanvas(6);
  ctx.fillStyle = "#92400e";
  ctx.textAlign = "right";
  ctx.fillText("GRAND TOTAL", labelEndX - 8, y + totH / 2 + 4);

  ctx.fillStyle = "#d97706";
  ctx.textAlign = "right";
  ctx.fillText(
    fmtCurrency(totalGrand),
    colXCanvas(6) + COL_WIDTHS[6] - 6,
    y + totH / 2 + 4,
  );

  ctx.fillStyle = "#166534";
  ctx.textAlign = "right";
  ctx.fillText(
    fmtCurrency(totalPaid),
    colXCanvas(7) + COL_WIDTHS[7] - 6,
    y + totH / 2 + 4,
  );

  if (totalRemaining > 0) {
    ctx.fillStyle = "#b91c1c";
    ctx.textAlign = "right";
    ctx.fillText(
      fmtCurrency(totalRemaining),
      colXCanvas(8) + COL_WIDTHS[8] - 6,
      y + totH / 2 + 4,
    );
  } else {
    ctx.fillStyle = "#166534";
    ctx.textAlign = "right";
    ctx.fillText(
      "Fully Paid",
      colXCanvas(8) + COL_WIDTHS[8] - 6,
      y + totH / 2 + 4,
    );
  }
  y += totH + 30;

  // ══════════════════════════════════════════════
  // SIGNATURE AREA — bottom right
  // ══════════════════════════════════════════════
  const SIG_X = CANVAS_W - PAD_X - 200;
  ctx.strokeStyle = NAVY;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(SIG_X, y);
  ctx.lineTo(CANVAS_W - PAD_X, y);
  ctx.stroke();
  ctx.fillStyle = MUTED_TEXT;
  ctx.font = `10px ${FONT_BASE}`;
  ctx.textAlign = "center";
  ctx.fillText("Authorized Signature", SIG_X + 100, y + 16);
  y += 36;

  // ══════════════════════════════════════════════
  // FOOTER — amber divider + terms + company info
  // ══════════════════════════════════════════════
  const footerTopY = Math.max(y + 10, canvasH - 80);

  ctx.strokeStyle = AMBER;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(PAD_X, footerTopY);
  ctx.lineTo(CANVAS_W - PAD_X, footerTopY);
  ctx.stroke();

  ctx.fillStyle = MUTED_TEXT;
  ctx.font = `10px ${FONT_BASE}`;
  ctx.textAlign = "left";
  ctx.fillText(
    "Terms & Conditions: Payment due within 30 days. Thank you for your business.",
    PAD_X,
    footerTopY + 18,
  );

  ctx.fillStyle = NAVY_LIGHT;
  ctx.font = `bold 11px ${FONT_BASE}`;
  ctx.textAlign = "center";
  ctx.fillText(
    "Matoshri Kamljadevi Earthmovers and Land Developers",
    CANVAS_W / 2,
    footerTopY + 38,
  );
  ctx.fillStyle = MUTED_TEXT;
  ctx.font = `10px ${FONT_BASE}`;
  ctx.textAlign = "center";
  ctx.fillText(
    "9890989473 (Google Pay)  ·  7588623501",
    CANVAS_W / 2,
    footerTopY + 54,
  );

  return canvas;
}

// ─── Single-bill aesthetic PNG ─────────────────────────────────────────────────

/**
 * Draws a single bill as a polished aesthetic invoice on a Canvas.
 * Portrait-style, premium invoice feel — wide margins, card sections, clean typography.
 */
async function drawSingleBillCanvasPNG(bill: Bill): Promise<HTMLCanvasElement> {
  const d = extractBillRowData(bill);
  const machines = bill.machines ?? [];

  // ── Canvas dimensions — A4 portrait @2x for HD quality ─────────────────────
  const SCALE = 2;
  const W = 794;
  const FONT = "Arial, sans-serif";
  const MARG = 52;
  const INNER_W = W - MARG * 2;

  // Collect all individual entries for the items table
  interface ItemRow {
    qty: string;
    description: string;
    unitPrice: string;
    amount: string;
  }
  const itemRows: ItemRow[] = [];
  for (const machine of machines) {
    for (const entry of machine.entries) {
      const entryType =
        entry.type ||
        (entry as unknown as Record<string, string>).entryType ||
        "";
      const typeLabel =
        entryType === "bucket"
          ? "Bucket Work"
          : entryType === "breaker"
            ? "Breaker Work"
            : "Machine Work";
      const sm = toMinutes(entry.startTime);
      const em = toMinutes(entry.endTime);
      const hrs = sm >= 0 && em >= 0 && em > sm ? (em - sm) / 60 : null;
      const rate =
        entryType === "bucket"
          ? (bill.rates?.bucket ?? 0)
          : (bill.rates?.breaker ?? 0);
      itemRows.push({
        qty: hrs != null ? `${hrs.toFixed(2)} hrs` : "—",
        description: `${typeLabel}  (${entry.startTime || "—"} – ${entry.endTime || "—"})`,
        unitPrice: rate > 0 ? `${fmtCurrency(rate)}/hr` : "—",
        amount: hrs != null && rate > 0 ? fmtCurrency(hrs * rate) : "—",
      });
    }
  }
  if (itemRows.length === 0) {
    itemRows.push({
      qty: d.totalHours > 0 ? `${d.totalHours.toFixed(2)} hrs` : "—",
      description: `${d.machineType !== "-" ? `${d.machineType} Work` : "Machine Work"}  (${d.startTime} – ${d.endTime})`,
      unitPrice: "—",
      amount: fmtCurrency(d.grandTotal),
    });
  }

  // Compute dynamic height
  const HEADER_BAND_H = 130;
  const INFO_SECTION_H = 110;
  const TABLE_ROW_H = 38;
  const TABLE_HEADER_H = 40;
  const tableH = TABLE_HEADER_H + itemRows.length * TABLE_ROW_H;
  const TOTALS_H = 160;
  const FOOTER_H = 110;
  const TOP_PAD = 40;
  const BOT_PAD = 30;
  const CANVAS_H = Math.max(
    1100,
    TOP_PAD +
      HEADER_BAND_H +
      INFO_SECTION_H +
      24 +
      tableH +
      TOTALS_H +
      FOOTER_H +
      BOT_PAD,
  );

  const canvas = document.createElement("canvas");
  canvas.width = W * SCALE;
  canvas.height = CANVAS_H * SCALE;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(SCALE, SCALE);

  // ── Palette ──────────────────────────────────────────────────────────────────
  const NAVY = "#1a2744";
  const NAVY_LIGHT = "#243358";
  const AMBER = "#f59e0b";
  const AMBER_LIGHT = "#fcd34d";
  const AMBER_PALE = "#fffbeb";
  const AMBER_ROW = "#fff8e1";
  const WHITE = "#ffffff";
  const DARK_TEXT = "#1a2744";
  const MID_TEXT = "#4b5563";
  const MUTED_TEXT = "#9ca3af";
  const BORDER_COLOR = "#e5e7eb";

  // ── White page background ─────────────────────────────────────────────────────
  ctx.fillStyle = WHITE;
  ctx.fillRect(0, 0, W, CANVAS_H);

  // ═══════════════════════════════════════════════════════════════
  // DECORATIVE LEFT WAVE / SWOOSH — amber curves on left edge
  // ═══════════════════════════════════════════════════════════════
  ctx.save();
  ctx.globalAlpha = 0.18;
  for (let wi = 0; wi < 5; wi++) {
    const waveX = -18 + wi * 9;
    const amp = 22 + wi * 4;
    ctx.strokeStyle = AMBER;
    ctx.lineWidth = 7 - wi;
    ctx.beginPath();
    ctx.moveTo(waveX, 0);
    for (let wy = 0; wy < CANVAS_H; wy += 60) {
      ctx.bezierCurveTo(
        waveX + amp,
        wy + 15,
        waveX - amp,
        wy + 45,
        waveX,
        wy + 60,
      );
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // ═══════════════════════════════════════════════════════════════
  // DECORATIVE BOTTOM-RIGHT ACCENT SWOOSH
  // ═══════════════════════════════════════════════════════════════
  ctx.save();
  ctx.globalAlpha = 0.13;
  for (let wi = 0; wi < 4; wi++) {
    ctx.strokeStyle = AMBER;
    ctx.lineWidth = 8 - wi * 1.5;
    ctx.beginPath();
    ctx.moveTo(W - 60 + wi * 8, CANVAS_H);
    ctx.bezierCurveTo(
      W + 20,
      CANVAS_H - 100,
      W - 140 + wi * 10,
      CANVAS_H - 60,
      W - 80 + wi * 8,
      CANVAS_H - 160,
    );
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // ═══════════════════════════════════════════════════════════════
  // NAVY HEADER BAND
  // ═══════════════════════════════════════════════════════════════
  ctx.fillStyle = NAVY;
  ctx.fillRect(0, 0, W, HEADER_BAND_H);

  // Amber accent stripe at very top of header
  ctx.fillStyle = AMBER;
  ctx.fillRect(0, 0, W, 5);

  // LEFT: "INVOICE" large bold text
  ctx.fillStyle = WHITE;
  ctx.font = `bold 42px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillText("INVOICE", MARG, 62);

  // Company name below INVOICE
  ctx.fillStyle = AMBER_LIGHT;
  ctx.font = `bold 13px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillText("Matoshri Kamljadevi Earthmovers & Land Developers", MARG, 82);

  // Contact info
  ctx.fillStyle = "rgba(255,255,255,0.65)";
  ctx.font = `11px ${FONT}`;
  ctx.fillText("9890989473 (Google Pay)  ·  7588623501", MARG, 100);

  // RIGHT: Invoice details in header
  const billNum = bill.id ? bill.id.slice(0, 8).toUpperCase() : "———";
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = `10px ${FONT}`;
  ctx.textAlign = "right";
  ctx.fillText("INVOICE NO.", W - MARG, 56);
  ctx.fillStyle = AMBER_LIGHT;
  ctx.font = `bold 13px ${FONT}`;
  ctx.textAlign = "right";
  ctx.fillText(`#${billNum}`, W - MARG, 72);

  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = `10px ${FONT}`;
  ctx.textAlign = "right";
  ctx.fillText("DATE OF WORK", W - MARG, 92);
  ctx.fillStyle = WHITE;
  ctx.font = `bold 12px ${FONT}`;
  ctx.textAlign = "right";
  ctx.fillText(fmtDate(bill.dateOfWork), W - MARG, 108);

  let y = HEADER_BAND_H + 28;

  // ═══════════════════════════════════════════════════════════════
  // INFO SECTION — two columns: BILL TO (left) | Invoice details (right)
  // ═══════════════════════════════════════════════════════════════
  const INFO_COL_L = MARG;
  const INFO_COL_R = MARG + INNER_W * 0.55 + 16;
  const INFO_COL_R_W = INNER_W - (INFO_COL_R - MARG);

  // LEFT column — Bill To box
  ctx.fillStyle = AMBER_PALE;
  ctx.strokeStyle = AMBER;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(INFO_COL_L, y, INNER_W * 0.52, 88, 6);
  ctx.fill();
  ctx.stroke();

  // Amber left accent bar on bill-to box
  ctx.fillStyle = AMBER;
  ctx.beginPath();
  ctx.roundRect(INFO_COL_L, y, 4, 88, [6, 0, 0, 6]);
  ctx.fill();

  ctx.fillStyle = AMBER;
  ctx.font = `bold 10px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillText("BILL TO", INFO_COL_L + 18, y + 22);

  ctx.fillStyle = DARK_TEXT;
  ctx.font = `bold 20px ${FONT}`;
  ctx.fillText(bill.customerName || "—", INFO_COL_L + 18, y + 46);

  if (bill.customerContact) {
    ctx.fillStyle = MID_TEXT;
    ctx.font = `12px ${FONT}`;
    ctx.fillText(`\u260E  ${bill.customerContact}`, INFO_COL_L + 18, y + 66);
  }

  // Machine type tag inside bill-to
  if (d.machineType !== "-") {
    const tag = d.machineType;
    const tagW = ctx.measureText(tag).width + 20;
    ctx.fillStyle = NAVY;
    ctx.beginPath();
    ctx.roundRect(INFO_COL_L + 18, y + 72, tagW, 20, 10);
    ctx.fill();
    ctx.fillStyle = AMBER_LIGHT;
    ctx.font = `bold 10px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(tag, INFO_COL_L + 18 + tagW / 2, y + 85);
    ctx.textAlign = "left";
  }

  // RIGHT column — invoice meta
  const metaItems: [string, string][] = [
    ["Invoice Date", fmtDate(bill.dateOfWork)],
    ["Due Date", fmtDate(bill.dateOfWork)],
    ["Invoice #", `#${billNum}`],
    ["P.O. #", bill.id ? bill.id.slice(0, 6).toUpperCase() : "—"],
  ];
  const META_ROW_H = 22;
  for (let mi = 0; mi < metaItems.length; mi++) {
    const [label, val] = metaItems[mi];
    const my = y + mi * META_ROW_H;
    ctx.fillStyle = MUTED_TEXT;
    ctx.font = `10px ${FONT}`;
    ctx.textAlign = "left";
    ctx.fillText(label, INFO_COL_R, my + 16);
    ctx.fillStyle = DARK_TEXT;
    ctx.font = `bold 12px ${FONT}`;
    ctx.textAlign = "right";
    ctx.fillText(val, INFO_COL_R + INFO_COL_R_W, my + 16);
    // Light rule between rows
    if (mi < metaItems.length - 1) {
      ctx.strokeStyle = BORDER_COLOR;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(INFO_COL_R, my + 22);
      ctx.lineTo(INFO_COL_R + INFO_COL_R_W, my + 22);
      ctx.stroke();
    }
  }

  y += 96;

  // Amber horizontal divider
  ctx.strokeStyle = AMBER;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(MARG, y);
  ctx.lineTo(W - MARG, y);
  ctx.stroke();
  y += 22;

  // ═══════════════════════════════════════════════════════════════
  // ITEMS TABLE
  // ═══════════════════════════════════════════════════════════════
  const TBL_X = MARG;
  const TBL_W = INNER_W;
  const COL_QTY = 110;
  const COL_UPRICE = 150;
  const COL_AMOUNT = 130;
  const COL_DESC = TBL_W - COL_QTY - COL_UPRICE - COL_AMOUNT;

  // Table header — navy background
  ctx.fillStyle = NAVY;
  ctx.beginPath();
  ctx.roundRect(TBL_X, y, TBL_W, TABLE_HEADER_H, [6, 6, 0, 0]);
  ctx.fill();

  ctx.fillStyle = WHITE;
  ctx.font = `bold 12px ${FONT}`;
  // QTY
  ctx.textAlign = "center";
  ctx.fillText("QTY", TBL_X + COL_QTY / 2, y + TABLE_HEADER_H / 2 + 5);
  // DESCRIPTION
  ctx.textAlign = "left";
  ctx.fillText("DESCRIPTION", TBL_X + COL_QTY + 14, y + TABLE_HEADER_H / 2 + 5);
  // UNIT PRICE
  ctx.textAlign = "right";
  ctx.fillText(
    "UNIT PRICE",
    TBL_X + COL_QTY + COL_DESC + COL_UPRICE - 14,
    y + TABLE_HEADER_H / 2 + 5,
  );
  // AMOUNT
  ctx.fillText("AMOUNT", TBL_X + TBL_W - 14, y + TABLE_HEADER_H / 2 + 5);
  y += TABLE_HEADER_H;

  // Table rows
  for (let ri = 0; ri < itemRows.length; ri++) {
    const row = itemRows[ri];
    const rowBg = ri % 2 === 0 ? WHITE : AMBER_ROW;
    ctx.fillStyle = rowBg;
    ctx.fillRect(TBL_X, y, TBL_W, TABLE_ROW_H);

    // Bottom rule
    ctx.strokeStyle = BORDER_COLOR;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(TBL_X, y + TABLE_ROW_H);
    ctx.lineTo(TBL_X + TBL_W, y + TABLE_ROW_H);
    ctx.stroke();

    // QTY
    ctx.fillStyle = NAVY;
    ctx.font = `bold 13px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(row.qty, TBL_X + COL_QTY / 2, y + TABLE_ROW_H / 2 + 5);

    // DESCRIPTION
    ctx.fillStyle = DARK_TEXT;
    ctx.font = `13px ${FONT}`;
    ctx.textAlign = "left";
    // Truncate description if too long
    let desc = row.description;
    const maxDescW = COL_DESC - 28;
    while (desc.length > 4 && ctx.measureText(desc).width > maxDescW) {
      desc = `${desc.slice(0, -4)}...`;
    }
    ctx.fillText(desc, TBL_X + COL_QTY + 14, y + TABLE_ROW_H / 2 + 5);

    // UNIT PRICE
    ctx.fillStyle = MID_TEXT;
    ctx.font = `13px ${FONT}`;
    ctx.textAlign = "right";
    ctx.fillText(
      row.unitPrice,
      TBL_X + COL_QTY + COL_DESC + COL_UPRICE - 14,
      y + TABLE_ROW_H / 2 + 5,
    );

    // AMOUNT
    ctx.fillStyle = NAVY;
    ctx.font = `bold 13px ${FONT}`;
    ctx.textAlign = "right";
    ctx.fillText(row.amount, TBL_X + TBL_W - 14, y + TABLE_ROW_H / 2 + 5);

    y += TABLE_ROW_H;
  }

  // Table bottom border
  ctx.strokeStyle = NAVY;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(TBL_X, y);
  ctx.lineTo(TBL_X + TBL_W, y);
  ctx.stroke();
  y += 24;

  // ═══════════════════════════════════════════════════════════════
  // TOTALS SECTION — right-aligned
  // ═══════════════════════════════════════════════════════════════
  const TOT_W = 280;
  const TOT_X = W - MARG - TOT_W;
  const T_ROW_H = 32;

  const subtotal = d.grandTotal;
  const totalsRows: [string, string, boolean][] = [
    ["Subtotal", fmtCurrency(subtotal), false],
    ["Amount Paid", d.amountPaid > 0 ? fmtCurrency(d.amountPaid) : "—", false],
    [
      "Remaining",
      d.remaining > 0 ? fmtCurrency(d.remaining) : "Fully Paid",
      false,
    ],
  ];

  for (const [label, val] of totalsRows) {
    ctx.strokeStyle = BORDER_COLOR;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(TOT_X, y);
    ctx.lineTo(TOT_X + TOT_W, y);
    ctx.stroke();

    ctx.fillStyle = MID_TEXT;
    ctx.font = `12px ${FONT}`;
    ctx.textAlign = "left";
    ctx.fillText(label, TOT_X, y + T_ROW_H / 2 + 5);

    ctx.fillStyle = DARK_TEXT;
    ctx.font = `13px ${FONT}`;
    ctx.textAlign = "right";
    ctx.fillText(val, TOT_X + TOT_W, y + T_ROW_H / 2 + 5);
    y += T_ROW_H;
  }

  // TOTAL highlight row — navy background
  ctx.fillStyle = NAVY;
  ctx.beginPath();
  ctx.roundRect(TOT_X, y, TOT_W, 50, 6);
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.font = `bold 13px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillText("TOTAL", TOT_X + 18, y + 31);

  ctx.fillStyle = AMBER_LIGHT;
  ctx.font = `bold 22px ${FONT}`;
  ctx.textAlign = "right";
  ctx.fillText(fmtCurrency(d.grandTotal), TOT_X + TOT_W - 18, y + 33);
  y += 60;

  // Payment status badge — right-aligned
  const status = d.paymentStatus;
  let badgeBg: string;
  let badgeFg: string;
  let badgeText: string;
  if (status === "PAID") {
    badgeBg = "#d1fae5";
    badgeFg = "#065f46";
    badgeText = "✓  PAID";
  } else if (status === "PARTIALLY PAID") {
    badgeBg = "#fef3c7";
    badgeFg = "#92400e";
    badgeText = "⚡  PARTIALLY PAID";
  } else {
    badgeBg = "#fee2e2";
    badgeFg = "#991b1b";
    badgeText = "✕  PENDING";
  }
  const bW = ctx.measureText(badgeText).width + 28;
  const bH = 28;
  const bX = TOT_X + TOT_W - bW;
  ctx.fillStyle = badgeBg;
  ctx.beginPath();
  ctx.roundRect(bX, y, bW, bH, 14);
  ctx.fill();
  ctx.fillStyle = badgeFg;
  ctx.font = `bold 11px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText(badgeText, bX + bW / 2, y + 18);
  y += bH + 36;

  // ═══════════════════════════════════════════════════════════════
  // SIGNATURE AREA — bottom right
  // ═══════════════════════════════════════════════════════════════
  const SIG_X = W - MARG - 200;
  ctx.strokeStyle = NAVY;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(SIG_X, y);
  ctx.lineTo(W - MARG, y);
  ctx.stroke();
  ctx.fillStyle = MUTED_TEXT;
  ctx.font = `10px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText("Authorized Signature", SIG_X + 100, y + 16);
  y += 36;

  // ═══════════════════════════════════════════════════════════════
  // TERMS & CONDITIONS
  // ═══════════════════════════════════════════════════════════════
  const footerTopY = Math.max(y + 10, CANVAS_H - 90);

  // Amber divider line above footer
  ctx.strokeStyle = AMBER;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(MARG, footerTopY);
  ctx.lineTo(W - MARG, footerTopY);
  ctx.stroke();

  // Terms
  ctx.fillStyle = MUTED_TEXT;
  ctx.font = `10px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillText(
    "Terms & Conditions: Payment due within 30 days. Thank you for your business.",
    MARG,
    footerTopY + 20,
  );

  // Company footer info centered
  ctx.fillStyle = NAVY_LIGHT;
  ctx.font = `bold 11px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText(
    "Matoshri Kamljadevi Earthmovers and Land Developers",
    W / 2,
    footerTopY + 40,
  );
  ctx.fillStyle = MUTED_TEXT;
  ctx.font = `10px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText(
    "9890989473 (Google Pay)  ·  7588623501",
    W / 2,
    footerTopY + 56,
  );

  return canvas;
}

// ─── Single-bill aesthetic PDF ───────────────────────────────────────────────────

/**
 * Adds a single bill as a polished aesthetic invoice page to a jsPDF document.
 * Portrait A4, matches the premium single-PNG layout.
 */
async function addSingleBillToPdf(pdf: jsPDF, bill: Bill): Promise<void> {
  const d = extractBillRowData(bill);
  const machines = bill.machines ?? [];
  const PW = 210;
  const PH = 297;
  const M = 15;
  const IW = PW - M * 2;
  let y = M;

  // Left amber accent bar
  pdf.setFillColor(217, 119, 6);
  pdf.rect(0, 0, 2, PH, "F");

  // "INVOICE" pill top-right
  pdf.setFillColor(254, 243, 199);
  pdf.roundedRect(PW - M - 34, y, 34, 9, 2, 2, "F");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(7);
  pdf.setTextColor(217, 119, 6);
  pdf.text("INVOICE", PW - M - 17, y + 6.2, { align: "center" });

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(12);
  pdf.setTextColor(17, 24, 39);
  pdf.text("Matoshri Kamljadevi Earthmovers", M + 3, y + 6);
  y += 7;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(55, 65, 81);
  pdf.text("and Land Developers", M + 3, y + 5);
  y += 8;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7.5);
  pdf.setTextColor(107, 114, 128);
  pdf.text("Tel: 9890989473 (Google Pay)  |  7588623501", M + 3, y + 4);
  y += 7;

  // Amber divider
  pdf.setFillColor(217, 119, 6);
  pdf.rect(M, y, IW, 0.8, "F");
  y += 5;

  // Info cards
  const card1W = Math.round(IW * 0.58);
  const card2W = IW - card1W - 4;
  const card2X = M + card1W + 4;
  const cardH = 22;

  pdf.setFillColor(255, 251, 235);
  pdf.setDrawColor(252, 211, 77);
  pdf.setLineWidth(0.3);
  pdf.roundedRect(M, y, card1W, cardH, 2, 2, "FD");
  pdf.setFontSize(6.5);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(146, 64, 14);
  pdf.text("BILL TO", M + 4, y + 5);
  pdf.setFontSize(9);
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(17, 24, 39);
  pdf.text(bill.customerName || "-", M + 4, y + 12);
  if (bill.customerContact) {
    pdf.setFontSize(7.5);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(107, 114, 128);
    pdf.text(`Tel: ${bill.customerContact}`, M + 4, y + 19);
  }

  pdf.setFillColor(249, 250, 251);
  pdf.setDrawColor(229, 231, 235);
  pdf.setLineWidth(0.3);
  pdf.roundedRect(card2X, y, card2W, cardH, 2, 2, "FD");
  const billNum = bill.id ? bill.id.slice(0, 8).toUpperCase() : "\u2014";
  const detailItems: [string, string][] = [
    ["INVOICE #", billNum],
    ["DATE", fmtDate(bill.dateOfWork)],
    ["STATUS", d.paymentStatus],
  ];
  const detailLineH = cardH / detailItems.length;
  detailItems.forEach(([label, val], idx) => {
    const ly = y + detailLineH * idx + detailLineH / 2;
    pdf.setFontSize(6);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(107, 114, 128);
    pdf.text(label, card2X + 3, ly + 0.5);
    const statusColor: [number, number, number] =
      label === "STATUS"
        ? val === "PAID"
          ? [22, 101, 52]
          : val === "PARTIALLY PAID"
            ? [146, 64, 14]
            : [185, 28, 28]
        : [17, 24, 39];
    pdf.setFontSize(7);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(...statusColor);
    pdf.text(val, card2X + 3, ly + 5);
  });

  y += cardH + 6;

  // Work details
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  pdf.setTextColor(55, 65, 81);
  pdf.text("WORK DETAILS", M, y + 4);
  pdf.setFillColor(217, 119, 6);
  pdf.rect(M, y + 5.5, 24, 0.6, "F");
  y += 9;

  for (const machine of machines) {
    if (machine.entries.length === 0) continue;

    pdf.setFillColor(31, 41, 55);
    pdf.roundedRect(M, y, IW, 7, 1, 1, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7);
    pdf.setTextColor(249, 250, 251);
    const pdfMachineEntryType =
      machine.entries[0]?.type ||
      (machine.entries[0] as unknown as Record<string, string>)?.entryType ||
      "";
    const pdfMachineLabel =
      pdfMachineEntryType === "bucket"
        ? "\u25a0  Bucket"
        : pdfMachineEntryType === "breaker"
          ? "\u25a0  Breaker"
          : "\u25a0  Machine";
    pdf.text(pdfMachineLabel, M + 4, y + 5);
    const pdfMachineHours = machine.entries.reduce((sum, e) => {
      const sm = toMinutes(e.startTime);
      const em = toMinutes(e.endTime);
      return sum + (sm >= 0 && em >= 0 && em > sm ? (em - sm) / 60 : 0);
    }, 0);
    if (pdfMachineHours > 0) {
      pdf.setTextColor(252, 211, 77);
      pdf.text(`${pdfMachineHours.toFixed(2)} hrs`, M + IW - 4, y + 5, {
        align: "right",
      });
    }
    y += 7;

    const entColWidths = [12, 22, 50, 30, 0];
    entColWidths[4] = IW - entColWidths.slice(0, 4).reduce((a, b) => a + b, 0);

    for (let ei = 0; ei < machine.entries.length; ei++) {
      const entry = machine.entries[ei];
      const bg: [number, number, number] =
        ei % 2 === 0 ? [249, 250, 251] : [255, 255, 255];
      pdf.setFillColor(...bg);
      pdf.rect(M, y, IW, 6, "F");
      pdf.setDrawColor(243, 244, 246);
      pdf.setLineWidth(0.15);
      pdf.line(M, y + 6, M + IW, y + 6);

      const entryType =
        entry.type ||
        (entry as unknown as Record<string, string>).entryType ||
        "";
      const typeLabel =
        entryType === "bucket"
          ? "Bucket"
          : entryType === "breaker"
            ? "Breaker"
            : "-";
      const pdfSm = toMinutes(entry.startTime);
      const pdfEm = toMinutes(entry.endTime);
      const pdfEntHours =
        pdfSm >= 0 && pdfEm >= 0 && pdfEm > pdfSm ? (pdfEm - pdfSm) / 60 : null;
      const pdfEntryRate =
        entry.type === "bucket"
          ? (bill.rates?.bucket ?? 0)
          : (bill.rates?.breaker ?? 0);
      const hoursVal =
        pdfEntHours != null ? `${pdfEntHours.toFixed(2)} hrs` : "-";
      const costVal =
        pdfEntHours != null && pdfEntryRate > 0
          ? fmtCurrency(pdfEntHours * pdfEntryRate)
          : "-";

      const timePair = `${entry.startTime || "-"} - ${entry.endTime || "-"}`;
      const rowCells = [String(ei + 1), typeLabel, timePair, hoursVal, costVal];
      const cellAligns: Array<"left" | "center" | "right"> = [
        "center",
        "left",
        "left",
        "right",
        "right",
      ];
      const cellColors: Array<[number, number, number]> = [
        [156, 163, 175],
        [55, 65, 81],
        [55, 65, 81],
        [55, 65, 81],
        [217, 119, 6],
      ];
      let cx = M;
      rowCells.forEach((cell, ci) => {
        pdf.setFontSize(6.5);
        pdf.setFont(
          "helvetica",
          ci === rowCells.length - 1 ? "bold" : "normal",
        );
        pdf.setTextColor(...cellColors[ci]);
        const tx =
          cellAligns[ci] === "right"
            ? cx + entColWidths[ci] - 1.5
            : cellAligns[ci] === "center"
              ? cx + entColWidths[ci] / 2
              : cx + 2;
        pdf.text(cell, tx, y + 4.2, { align: cellAligns[ci] });
        cx += entColWidths[ci];
      });
      y += 6;
    }
    y += 4;
  }

  y += 4;

  // Totals block
  const totX = M + Math.round(IW * 0.5);
  const totW = Math.round(IW * 0.5);
  const totRowH = 7;
  const totRows: [string, string, [number, number, number]][] = [
    ["Total Amount", fmtCurrency(d.grandTotal), [55, 65, 81]],
    [
      "Amount Paid",
      d.amountPaid > 0 ? fmtCurrency(d.amountPaid) : "\u2014",
      [22, 101, 52],
    ],
    [
      "Remaining",
      d.remaining > 0 ? fmtCurrency(d.remaining) : "Fully Paid",
      d.remaining > 0 ? [185, 28, 28] : [22, 101, 52],
    ],
  ];
  for (let ti = 0; ti < totRows.length; ti++) {
    const [label, val, color] = totRows[ti];
    const ty = y + ti * totRowH;
    if (ti > 0) {
      pdf.setDrawColor(243, 244, 246);
      pdf.setLineWidth(0.2);
      pdf.line(totX, ty, totX + totW, ty);
    }
    pdf.setFontSize(7);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(107, 114, 128);
    pdf.text(label, totX + 4, ty + totRowH - 1.5);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(...color);
    pdf.text(val, totX + totW - 2, ty + totRowH - 1.5, { align: "right" });
  }
  y += totRows.length * totRowH + 4;

  // Grand total highlight block (no borders)
  pdf.setFillColor(254, 243, 199);
  pdf.roundedRect(totX, y, totW, 13, 2, 2, "F");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(7);
  pdf.setTextColor(146, 64, 14);
  pdf.text("GRAND TOTAL", totX + 4, y + 5.5);
  pdf.setFontSize(10);
  pdf.setTextColor(217, 119, 6);
  pdf.text(fmtCurrency(d.grandTotal), totX + totW - 2, y + 10, {
    align: "right",
  });
  y += 17;

  y += 6;

  // Footer divider
  pdf.setDrawColor(229, 231, 235);
  pdf.setLineWidth(0.3);
  pdf.line(M, y, PW - M, y);
  y += 5;

  // QR code — bottom-right of footer
  const qrText = `${bill.customerName || "Customer"} | Date: ${fmtDate(bill.dateOfWork)} | Total: ${fmtCurrency(d.grandTotal)} | Status: ${d.paymentStatus}`;
  const QR_MM = 22; // 22mm QR code in footer
  const qrX = PW - M - QR_MM;
  const qrY = y;
  try {
    const qrDataUrl = await QRCode.toDataURL(qrText, {
      width: 132, // ~22mm at 150dpi
      margin: 1,
      color: { dark: "#1f2937", light: "#ffffff" },
    });
    pdf.addImage(qrDataUrl, "PNG", qrX, qrY, QR_MM, QR_MM);
    pdf.setFontSize(5);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(156, 163, 175);
    pdf.text("Scan for bill info", qrX + QR_MM / 2, qrY + QR_MM + 3, {
      align: "center",
    });
  } catch {
    // QR generation failed — skip gracefully
  }

  // Footer text
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(6.5);
  pdf.setTextColor(156, 163, 175);
  pdf.text(
    "Matoshri Kamljadevi Earthmovers and Land Developers  |  9890989473  |  7588623501",
    M,
    y + QR_MM / 2 + 1,
  );
}

// ─── Single-bill export ───────────────────────────────────────────────────────

/** Single bill as PNG — polished aesthetic invoice layout */
/** Single bill as PNG — polished aesthetic invoice layout */
export async function downloadBillAsPNG(
  _html: string,
  filename: string,
  bill?: Bill,
): Promise<void> {
  if (!bill) {
    console.error("downloadBillAsPNG: bill object is required");
    alert("Export failed: bill data not available. Please try again.");
    return;
  }
  const canvas = await drawSingleBillCanvasPNG(bill);
  try {
    const blob = await canvasToBlob(canvas);
    await triggerDownload(
      blob,
      filename.replace(/\.jpe?g$/i, ".png"),
      "image/png",
    );
    if (isIOSSafari()) {
      setTimeout(
        () =>
          alert(
            'Your PNG is downloading. If it opened in a tab instead, tap and hold the image then choose "Save to Photos".',
          ),
        800,
      );
    }
  } catch (err) {
    console.error("PNG export failed:", err);
    alert("PNG export failed. Please try again.");
  }
}

/** Single bill as PDF — polished aesthetic invoice layout */
/** Single bill as PDF — polished aesthetic invoice layout */
export async function downloadBillAsPDF(
  _html: string,
  filename: string,
  bill?: Bill,
): Promise<void> {
  if (!bill) {
    console.error("downloadBillAsPDF: bill object is required");
    alert("Export failed: bill data not available. Please try again.");
    return;
  }
  const pdf = new jsPDF({
    orientation: "p",
    unit: "mm",
    format: "a4",
    compress: true,
  });
  await addSingleBillToPdf(pdf, bill);
  const pdfBlob = new Blob([pdf.output("arraybuffer")], {
    type: "application/pdf",
  });
  await triggerDownload(pdfBlob, filename, "application/pdf");
  if (isIOSSafari()) {
    setTimeout(
      () =>
        alert(
          "Your PDF is downloading. Use the Share button (\u25BD) to save or open the PDF if needed.",
        ),
      800,
    );
  }
}

// ─── Pure jsPDF vector batch PDF ─────────────────────────────────────────────

const COMPANY_NAME = "Matoshri Kamljadevi Earthmovers and Land Developers";
const COMPANY_CONTACT = "Contact: 9890989473 (Google Pay) | 7588623501";
const PAGE_W = 210; // A4 portrait mm
const PAGE_H = 297;
const MARGIN = 12;

type Col = { label: string; width: number; align: "left" | "center" | "right" };

// A4 portrait: usable width = 210 - 12*2 = 186mm
// Columns redistributed proportionally from landscape widths to fit 186mm
const TABLE_COLS: Col[] = [
  { label: "Sr", width: 8, align: "center" },
  { label: "Date", width: 20, align: "center" },
  { label: "Start", width: 16, align: "center" },
  { label: "End", width: 16, align: "center" },
  { label: "Type", width: 16, align: "center" },
  { label: "Hours", width: 16, align: "right" },
  { label: "Amount", width: 28, align: "right" },
  { label: "Paid", width: 26, align: "right" },
  { label: "Remaining", width: 26, align: "right" },
  { label: "Status", width: 14, align: "center" },
]; // sum = 186mm

const TABLE_W_PDF = TABLE_COLS.reduce((s, c) => s + c.width, 0);
const ROW_H_PDF = 7;
const HEADER_H_PDF = 8;

function colXPdf(i: number): number {
  let x = MARGIN;
  for (let j = 0; j < i; j++) x += TABLE_COLS[j].width;
  return x;
}

function drawTableHeader(pdf: jsPDF, y: number): void {
  // Navy header background (matches single bill)
  pdf.setFillColor(26, 39, 68); // NAVY #1a2744
  pdf.rect(MARGIN, y, TABLE_W_PDF, HEADER_H_PDF, "F");
  pdf.setTextColor(255, 255, 255);
  pdf.setFont("helvetica", "bold");
  TABLE_COLS.forEach((col, i) => {
    pdf.setFontSize(i === 9 ? 5.5 : 6.5);
    pdf.text(col.label, colXPdf(i) + col.width / 2, y + HEADER_H_PDF / 2 + 2, {
      align: "center",
    });
  });
}

function drawDataRow(
  pdf: jsPDF,
  y: number,
  cells: string[],
  bgColor?: [number, number, number],
): number {
  if (bgColor) {
    pdf.setFillColor(...bgColor);
    pdf.rect(MARGIN, y, TABLE_W_PDF, ROW_H_PDF, "F");
  }
  pdf.setDrawColor(229, 231, 235);
  pdf.setLineWidth(0.2);
  TABLE_COLS.forEach((col, i) => {
    pdf.rect(colXPdf(i), y, col.width, ROW_H_PDF, "S");
    let text = cells[i] ?? "";
    // Status column (idx 9): abbreviate to fit narrow 14mm column
    if (i === 9) {
      if (text === "PARTIALLY PAID") text = "PARTIAL";
      else if (text === "NOT PAID") text = "UNPAID";
      // PAID stays as-is
      pdf.setFontSize(5.5);
    } else {
      pdf.setFontSize(6.5);
    }
    const tx =
      col.align === "right"
        ? colXPdf(i) + col.width - 1.5
        : col.align === "center"
          ? colXPdf(i) + col.width / 2
          : colXPdf(i) + 1.5;
    pdf.text(text, tx, y + ROW_H_PDF / 2 + 1.8, { align: col.align });
  });
  return y + ROW_H_PDF;
}

function drawTotalsRow(
  pdf: jsPDF,
  y: number,
  totalGrand: number,
  totalPaid: number,
  totalRemaining: number,
): void {
  const h = ROW_H_PDF + 1;
  pdf.setFillColor(255, 251, 235);
  pdf.rect(MARGIN, y, TABLE_W_PDF, h, "F");
  // NOTE: No rect() border on Grand Total row cells (batch PDF)

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(7.5);
  const cy = y + h / 2 + 1.8;

  // Label spanning first 6 columns
  pdf.setTextColor(146, 64, 14);
  pdf.text("GRAND TOTAL", (colXPdf(0) + colXPdf(6)) / 2, cy, {
    align: "center",
  });

  pdf.setTextColor(217, 119, 6);
  pdf.text(
    fmtCurrency(totalGrand),
    colXPdf(6) + TABLE_COLS[6].width - 1.5,
    cy,
    {
      align: "right",
    },
  );

  pdf.setTextColor(22, 101, 52);
  pdf.text(fmtCurrency(totalPaid), colXPdf(7) + TABLE_COLS[7].width - 1.5, cy, {
    align: "right",
  });

  if (totalRemaining > 0) {
    pdf.setTextColor(185, 28, 28);
    pdf.text(
      fmtCurrency(totalRemaining),
      colXPdf(8) + TABLE_COLS[8].width - 1.5,
      cy,
      { align: "right" },
    );
  } else {
    pdf.setTextColor(22, 101, 52);
    pdf.text("Fully Paid", colXPdf(8) + TABLE_COLS[8].width - 1.5, cy, {
      align: "right",
    });
  }
}

function addCustomerGroupToPdf(
  pdf: jsPDF,
  group: GroupedBill,
  startOnNewPage: boolean,
): void {
  if (startOnNewPage) pdf.addPage();

  let y = MARGIN;

  // ══════════════════════════════════════════════
  // NAVY HEADER BAND
  // ══════════════════════════════════════════════
  const HEADER_BAND_H_PDF = 32;

  // Amber accent stripe at top
  pdf.setFillColor(245, 158, 11); // AMBER
  pdf.rect(0, 0, PAGE_W, 1.5, "F");

  // Navy band
  pdf.setFillColor(26, 39, 68); // NAVY
  pdf.rect(0, 1.5, PAGE_W, HEADER_BAND_H_PDF - 1.5, "F");

  // 'STATEMENT' title
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(14);
  pdf.setTextColor(255, 255, 255);
  pdf.text("STATEMENT", MARGIN, y + 10);

  // Company name below title (amber-light)
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  pdf.setTextColor(252, 211, 77); // AMBER_LIGHT
  pdf.text("Matoshri Kamljadevi Earthmovers & Land Developers", MARGIN, y + 18);

  // Contact info (muted white)
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(6.5);
  pdf.setTextColor(200, 210, 230);
  pdf.text("9890989473 (Google Pay)  |  7588623501", MARGIN, y + 25);

  // RIGHT meta in header
  const dateRange =
    group.bills.length > 0
      ? `${fmtDate(group.bills[0].dateOfWork)} – ${fmtDate(group.bills[group.bills.length - 1].dateOfWork)}`
      : "—";
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(5.5);
  pdf.setTextColor(180, 190, 210);
  pdf.text("TOTAL BILLS", PAGE_W - MARGIN, y + 8, { align: "right" });
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.setTextColor(252, 211, 77);
  pdf.text(String(group.bills.length), PAGE_W - MARGIN, y + 16, {
    align: "right",
  });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(5.5);
  pdf.setTextColor(180, 190, 210);
  pdf.text("DATE RANGE", PAGE_W - MARGIN, y + 23, { align: "right" });
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(6);
  pdf.setTextColor(255, 255, 255);
  pdf.text(dateRange, PAGE_W - MARGIN, y + 29, { align: "right" });

  y += HEADER_BAND_H_PDF + 6;

  // ══════════════════════════════════════════════
  // INFO SECTION — two columns
  // ══════════════════════════════════════════════
  const card1W = Math.round(TABLE_W_PDF * 0.52);
  const card2X = MARGIN + card1W + 4;
  const card2W = TABLE_W_PDF - card1W - 4;
  const cardH = 22;

  // LEFT — amber-pale BILL TO box
  pdf.setFillColor(255, 251, 235); // AMBER_PALE
  pdf.setDrawColor(245, 158, 11); // AMBER
  pdf.setLineWidth(0.4);
  pdf.roundedRect(MARGIN, y, card1W, cardH, 2, 2, "FD");

  // Amber left accent bar
  pdf.setFillColor(245, 158, 11);
  pdf.rect(MARGIN, y, 1.5, cardH, "F");

  pdf.setFontSize(6.5);
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(217, 119, 6);
  pdf.text("BILL TO", MARGIN + 4, y + 6);

  pdf.setFontSize(9);
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(17, 24, 39);
  pdf.text(group.customerName, MARGIN + 4, y + 14);

  if (group.customerContact) {
    pdf.setFontSize(7);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(107, 114, 128);
    pdf.text(`Tel: ${group.customerContact}`, MARGIN + 4, y + 20);
  }

  // RIGHT — meta info
  const totalGrandMeta = group.bills.reduce((s, b) => s + b.grandTotal, 0);
  const totalPaidMeta = group.bills.reduce((s, b) => s + b.amountPaid, 0);
  const totalRemainingMeta = Math.max(0, totalGrandMeta - totalPaidMeta);
  const metaItems: [string, string][] = [
    ["Total Charged", fmtCurrency(totalGrandMeta)],
    ["Total Paid", fmtCurrency(totalPaidMeta)],
    [
      "Outstanding",
      totalRemainingMeta > 0 ? fmtCurrency(totalRemainingMeta) : "Fully Paid",
    ],
  ];
  const metaLineH = cardH / metaItems.length;
  metaItems.forEach(([label, val], idx) => {
    const my = y + metaLineH * idx + metaLineH / 2;
    pdf.setFontSize(5.5);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(107, 114, 128);
    pdf.text(label, card2X + 2, my + 0.5);
    pdf.setFontSize(7);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(17, 24, 39);
    pdf.text(val, card2X + card2W - 1.5, my + 5, { align: "right" });
  });

  y += cardH + 4;

  // Amber divider
  pdf.setDrawColor(245, 158, 11);
  pdf.setLineWidth(0.5);
  pdf.line(MARGIN, y, MARGIN + TABLE_W_PDF, y);
  y += 4;

  if (y + HEADER_H_PDF + ROW_H_PDF * 2 > PAGE_H - MARGIN) {
    pdf.addPage();
    y = MARGIN;
  }

  drawTableHeader(pdf, y);
  y += HEADER_H_PDF;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(6.5);
  pdf.setTextColor(17, 24, 39);

  for (let i = 0; i < group.bills.length; i++) {
    if (y + ROW_H_PDF > PAGE_H - MARGIN) {
      pdf.addPage();
      y = MARGIN;
      drawTableHeader(pdf, y);
      y += HEADER_H_PDF;
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(6.5);
      pdf.setTextColor(17, 24, 39);
    }
    const d = extractBillRowData(group.bills[i]);
    const bg: [number, number, number] =
      i % 2 === 0 ? [255, 255, 255] : [255, 248, 225]; // white / amber-pale
    y = drawDataRow(
      pdf,
      y,
      [
        String(i + 1),
        d.date,
        d.startTime,
        d.endTime,
        d.machineType,
        d.totalHours > 0 ? d.totalHours.toFixed(2) : "-",
        fmtCurrency(d.grandTotal),
        d.amountPaid > 0 ? fmtCurrency(d.amountPaid) : "-",
        d.remaining > 0 ? fmtCurrency(d.remaining) : "Fully Paid",
        d.paymentStatus,
      ],
      bg,
    );
  }

  if (y + ROW_H_PDF + 1 > PAGE_H - MARGIN) {
    pdf.addPage();
    y = MARGIN;
  }

  const totalGrand = group.bills.reduce((s, b) => s + b.grandTotal, 0);
  const totalPaid = group.bills.reduce((s, b) => s + b.amountPaid, 0);
  drawTotalsRow(
    pdf,
    y,
    totalGrand,
    totalPaid,
    Math.max(0, totalGrand - totalPaid),
  );
  y += ROW_H_PDF + 1 + 14;

  // ══════════════════════════════════════════════
  // SIGNATURE AREA
  // ══════════════════════════════════════════════
  const sigX = MARGIN + Math.round(TABLE_W_PDF * 0.62);
  const sigW = TABLE_W_PDF - Math.round(TABLE_W_PDF * 0.62);
  pdf.setDrawColor(26, 39, 68); // NAVY
  pdf.setLineWidth(0.4);
  pdf.line(sigX, y, sigX + sigW, y);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(6);
  pdf.setTextColor(156, 163, 175);
  pdf.text("Authorized Signature", sigX + sigW / 2, y + 4, { align: "center" });
  y += 12;

  // ══════════════════════════════════════════════
  // FOOTER — amber divider + terms + company info
  // ══════════════════════════════════════════════
  const footerY = Math.max(y + 4, PAGE_H - 22);

  pdf.setDrawColor(245, 158, 11); // AMBER
  pdf.setLineWidth(0.5);
  pdf.line(MARGIN, footerY, MARGIN + TABLE_W_PDF, footerY);

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(5.5);
  pdf.setTextColor(156, 163, 175);
  pdf.text(
    "Terms & Conditions: Payment due within 30 days. Thank you for your business.",
    MARGIN,
    footerY + 4,
  );

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(6.5);
  pdf.setTextColor(26, 39, 68); // NAVY
  pdf.text(
    "Matoshri Kamljadevi Earthmovers and Land Developers",
    PAGE_W / 2,
    footerY + 10,
    { align: "center" },
  );
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(5.5);
  pdf.setTextColor(156, 163, 175);
  pdf.text("9890989473 (Google Pay)  |  7588623501", PAGE_W / 2, footerY + 16, {
    align: "center",
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Batch PNG: one PNG per customer group, drawn with pure Canvas 2D API.
 * Works in Chrome, Firefox, Safari, Edge — no html2canvas dependency.
 */
export async function downloadBatchAsPNG(
  bills: Bill[],
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const groups = groupBillsByCustomer(bills);
  let done = 0;
  const showIOSHint = isIOSSafari();
  for (const group of groups) {
    const canvas = drawCustomerCanvasPNG(group);
    const safeName = group.customerName
      .replace(/[^a-zA-Z0-9\s]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 40);
    try {
      const blob = await canvasToBlob(canvas);
      await triggerDownload(blob, `batch-${safeName}.png`, "image/png");
    } catch (err) {
      console.error(`PNG export failed for ${group.customerName}:`, err);
    }
    done++;
    onProgress?.(done, groups.length);
    if (done < groups.length) await new Promise((r) => setTimeout(r, 500));
  }
  if (showIOSHint && done > 0) {
    setTimeout(
      () =>
        alert(
          'Your PNGs are downloading. Tap and hold each image then choose "Save to Photos" if needed.',
        ),
      600,
    );
  }
  return done;
}

/**
 * Batch PDF — Single file: all customers in one PDF, each on a new page.
 * Pure jsPDF vector — tiny file size, no images.
 */
export async function downloadBatchAsPDF(bills: Bill[]): Promise<void> {
  const groups = groupBillsByCustomer(bills);
  if (groups.length === 0) return;
  const pdf = new jsPDF({
    orientation: "p",
    unit: "mm",
    format: "a4",
    compress: true,
  });
  for (let i = 0; i < groups.length; i++) {
    addCustomerGroupToPdf(pdf, groups[i], i > 0);
  }
  const pdfBlob = new Blob([pdf.output("arraybuffer")], {
    type: "application/pdf",
  });
  const filename = `batch-all-customers-${new Date().toISOString().split("T")[0]}.pdf`;
  await triggerDownload(pdfBlob, filename, "application/pdf");
  if (isIOSSafari()) {
    setTimeout(
      () =>
        alert(
          "Your PDF is downloading. Use the Share button (\u25BD) to save or open it.",
        ),
      800,
    );
  }
}

/**
 * Batch PDF — Separate files: one PDF per customer, auto-downloaded in sequence.
 * Pure jsPDF vector — tiny file size, no images.
 */
// ─── Payment History PDF ────────────────────────────────────────────────────────────────────────────────

/**
 * Exports the payment history for a single bill as a PDF.
 * Includes header, payment entries table, and summary totals.
 */
export async function exportPaymentHistoryAsPDF(bill: Bill): Promise<void> {
  const history: PaymentEntry[] = bill.paymentHistory ?? [];

  const pdf = new jsPDF({
    orientation: "p",
    unit: "mm",
    format: "a4",
    compress: true,
  });

  const PW = 210;
  const M = 15;
  let y = M;

  // Company header
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.setTextColor(17, 24, 39);
  pdf.text(COMPANY_NAME, PW / 2, y + 5, { align: "center" });
  y += 9;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.setTextColor(107, 114, 128);
  pdf.text(COMPANY_CONTACT, PW / 2, y + 4, { align: "center" });
  y += 8;

  // Amber divider
  pdf.setDrawColor(217, 119, 6);
  pdf.setLineWidth(0.7);
  pdf.line(M, y, PW - M, y);
  y += 5;

  // Invoice info block
  const billNumber = bill.id.slice(0, 8).toUpperCase();
  pdf.setFillColor(249, 250, 251);
  pdf.setDrawColor(229, 231, 235);
  pdf.setLineWidth(0.3);
  pdf.roundedRect(M, y, PW - M * 2, 20, 2, 2, "FD");

  pdf.setFontSize(7);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(107, 114, 128);
  pdf.text("INVOICE #", M + 4, y + 5);
  pdf.setFontSize(9);
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(17, 24, 39);
  pdf.text(billNumber, M + 4, y + 12);

  pdf.setFontSize(7);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(107, 114, 128);
  pdf.text("CUSTOMER", M + 55, y + 5);
  pdf.setFontSize(9);
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(17, 24, 39);
  pdf.text(bill.customerName || "-", M + 55, y + 12);

  pdf.setFontSize(7);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(107, 114, 128);
  pdf.text("DATE OF WORK", M + 115, y + 5);
  pdf.setFontSize(9);
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(17, 24, 39);
  pdf.text(fmtDate(bill.dateOfWork), M + 115, y + 12);
  y += 25;

  // Section title
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.setTextColor(17, 24, 39);
  pdf.text("PAYMENT HISTORY", M, y);
  y += 6;

  // Table columns
  const payColWidths = [28, 28, 38, 38, 48]; // Date, Amount, Running Balance, Notes
  const payColHeaders = ["Date", "Amount (₹)", "Running Bal (₹)", "Notes", ""];
  const tableW = payColWidths.reduce((s, w) => s + w, 0);

  function colXPay(i: number): number {
    let x = M;
    for (let j = 0; j < i; j++) x += payColWidths[j];
    return x;
  }

  // Table header row
  pdf.setFillColor(254, 243, 199);
  pdf.rect(M, y, tableW, 8, "F");
  pdf.setDrawColor(217, 119, 6);
  pdf.setLineWidth(0.3);
  for (let i = 0; i < payColWidths.length; i++) {
    pdf.rect(colXPay(i), y, payColWidths[i], 8, "S");
  }
  pdf.setFontSize(7);
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(146, 64, 14);
  for (let i = 0; i < payColHeaders.length; i++) {
    pdf.text(payColHeaders[i], colXPay(i) + payColWidths[i] / 2, y + 5, {
      align: "center",
    });
  }
  y += 8;

  if (history.length === 0) {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(107, 114, 128);
    pdf.text("No payment entries recorded.", M + 4, y + 6);
    y += 14;
  } else {
    let runningBalance = bill.grandTotal;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.5);

    // Sort history oldest first for running balance
    const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));

    for (let i = 0; i < sorted.length; i++) {
      const entry = sorted[i];
      runningBalance -= entry.amount;
      const bg: [number, number, number] =
        i % 2 === 0 ? [255, 255, 255] : [250, 250, 250];
      pdf.setFillColor(...bg);
      pdf.rect(M, y, tableW, 7, "F");
      pdf.setDrawColor(229, 231, 235);
      pdf.setLineWidth(0.2);
      for (let ci = 0; ci < payColWidths.length; ci++) {
        pdf.rect(colXPay(ci), y, payColWidths[ci], 7, "S");
      }

      pdf.setTextColor(17, 24, 39);
      const rowCells = [
        fmtDate(entry.date),
        fmtCurrency(entry.amount),
        fmtCurrency(Math.max(0, runningBalance)),
        entry.note ?? "-",
        "",
      ];
      for (let ci = 0; ci < rowCells.length; ci++) {
        const align = ci === 3 ? ("left" as const) : ("center" as const);
        const tx =
          align === "left"
            ? colXPay(ci) + 2
            : colXPay(ci) + payColWidths[ci] / 2;
        pdf.text(rowCells[ci], tx, y + 5, { align });
      }
      y += 7;
    }
  }

  // Summary section
  y += 4;
  pdf.setDrawColor(229, 231, 235);
  pdf.setLineWidth(0.3);
  pdf.line(M, y, PW - M, y);
  y += 5;

  const totalPaid = (bill.paymentHistory ?? []).reduce(
    (s, e) => s + e.amount,
    0,
  );
  const outstanding = Math.max(0, bill.grandTotal - totalPaid);

  const summaryRows = [
    ["Total Charged", fmtCurrency(bill.grandTotal)],
    ["Total Paid", fmtCurrency(totalPaid)],
    ["Outstanding", fmtCurrency(outstanding)],
  ];

  for (const [label, val] of summaryRows) {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.setTextColor(107, 114, 128);
    pdf.text(label, M + 4, y + 5);
    pdf.setTextColor(17, 24, 39);
    pdf.text(val, M + 60, y + 5);
    y += 8;
  }

  const blob = new Blob([pdf.output("arraybuffer")], {
    type: "application/pdf",
  });
  const filename = `invoice-${billNumber}-payments.pdf`;
  await triggerDownload(blob, filename, "application/pdf");
  if (isIOSSafari()) {
    setTimeout(
      () =>
        alert(
          "Your PDF is downloading. Use the Share button (▽) to save or open it.",
        ),
      800,
    );
  }
}

export async function downloadBatchAsSeparatePDFs(
  bills: Bill[],
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const groups = groupBillsByCustomer(bills);
  const today = new Date().toISOString().split("T")[0];
  let done = 0;
  const showIOSHint = isIOSSafari();
  for (const group of groups) {
    const pdf = new jsPDF({
      orientation: "p",
      unit: "mm",
      format: "a4",
      compress: true,
    });
    addCustomerGroupToPdf(pdf, group, false);
    const safeName = group.customerName
      .replace(/[^a-zA-Z0-9\s]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 40);
    const pdfBlob = new Blob([pdf.output("arraybuffer")], {
      type: "application/pdf",
    });
    await triggerDownload(
      pdfBlob,
      `bill-${safeName}-${today}.pdf`,
      "application/pdf",
    );
    done++;
    onProgress?.(done, groups.length);
    if (done < groups.length) await new Promise((r) => setTimeout(r, 500));
  }
  if (showIOSHint && done > 0) {
    setTimeout(
      () =>
        alert(
          "Your PDFs are downloading. Use the Share button (\u25BD) to save or open each one.",
        ),
      600,
    );
  }
  return done;
}
