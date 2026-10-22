/**
 * The block model this package reads and writes. It is the JSON the editor already stores (BlockNote's
 * document format), described structurally so this package needs neither the editor nor a DOM.
 */

export interface Styles {
  bold?: true;
  italic?: true;
  underline?: true;
  strike?: true;
  code?: true;
  textColor?: string;
  backgroundColor?: string;
}

export interface TextRun {
  type: "text";
  text: string;
  styles: Styles;
}

export interface LinkRun {
  type: "link";
  href: string;
  content: TextRun[];
}

export type Inline = TextRun | LinkRun;

export interface TableCell {
  type: "tableCell";
  content: Inline[];
  props: { colspan?: number; rowspan?: number; backgroundColor?: string; textColor?: string; textAlignment?: string };
}

export interface TableContent {
  type: "tableContent";
  columnWidths?: (number | null)[];
  headerRows?: number;
  headerCols?: number;
  rows: { cells: TableCell[] }[];
}

export interface Block {
  id: string;
  type: string;
  props: Record<string, unknown>;
  /** Inline text for text blocks, table content for a table, absent for blocks that hold only props. */
  content?: Inline[] | TableContent;
  children: Block[];
}

export type Severity = "error" | "warning" | "info";

export interface Diagnostic {
  /** A stable code from the catalogue in diagnostics.ts, e.g. `GS-203`. */
  code: string;
  severity: Severity;
  message: string;
  /** The file this is about, when the caller supplied one. */
  path?: string;
  /** 1-based line within that file. */
  line?: number;
  column?: number;
}
