declare module "jspdf" {
  type Orientation = "portrait" | "landscape" | "p" | "l";
  type Unit = "pt" | "mm" | "cm" | "in" | "px" | "pc" | "em" | "ex";
  type Format =
    | string
    | [number, number]
    | "a0"
    | "a1"
    | "a2"
    | "a3"
    | "a4"
    | "a5"
    | "a6"
    | "a7"
    | "a8"
    | "a9"
    | "a10"
    | "b0"
    | "b1"
    | "b2"
    | "b3"
    | "b4"
    | "b5"
    | "b6"
    | "b7"
    | "b8"
    | "b9"
    | "b10"
    | "c0"
    | "c1"
    | "c2"
    | "c3"
    | "c4"
    | "c5"
    | "c6"
    | "c7"
    | "c8"
    | "c9"
    | "c10"
    | "dl"
    | "letter"
    | "government-letter"
    | "legal"
    | "junior-legal"
    | "ledger"
    | "tabloid"
    | "credit-card";

  interface jsPDFOptions {
    orientation?: Orientation;
    unit?: Unit;
    format?: Format;
    compress?: boolean;
    precision?: number;
    putOnlyUsedFonts?: boolean;
    floatPrecision?: number | "smart";
    hotfixes?: string[];
    encryption?: object;
    userUnit?: number;
  }

  interface PageSize {
    getWidth(): number;
    getHeight(): number;
    width: number;
    height: number;
  }

  interface Internal {
    pageSize: PageSize;
  }

  export class jsPDF {
    constructor(options?: jsPDFOptions);
    internal: Internal;
    addImage(
      imageData: string | HTMLImageElement | HTMLCanvasElement,
      format: string,
      x: number,
      y: number,
      width: number,
      height: number,
    ): jsPDF;
    addPage(format?: Format, orientation?: Orientation): jsPDF;
    save(filename: string): jsPDF;
  }
}
