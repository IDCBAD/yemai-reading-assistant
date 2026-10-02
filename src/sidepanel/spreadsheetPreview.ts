import { read, utils, type WorkSheet } from 'xlsx';

export interface PreviewSheet {
  name: string;
  rows: string[][];
  columns: string[];
  rowOffset: number;
  totalRows: number;
  truncated: boolean;
}

export function previewSheet(name: string, sheet: WorkSheet): PreviewSheet {
  const range = utils.decode_range(sheet['!ref'] || 'A1');
  const fullRange = utils.decode_range(sheet['!fullref'] || sheet['!ref'] || 'A1');
  const totalRows = sheet['!ref'] ? fullRange.e.r - fullRange.s.r + 1 : 0;
  const lastRow = Math.min(range.e.r, range.s.r + 1999);
  const lastColumn = Math.min(range.e.c, range.s.c + 99);
  const columns = Array.from({ length: lastColumn - range.s.c + 1 }, (_, index) => utils.encode_col(range.s.c + index));
  const rows: string[][] = [];
  for (let row = range.s.r; row <= lastRow && totalRows > 0; row++) {
    rows.push(columns.map((_, index) => {
      const cell = sheet[utils.encode_cell({ r: row, c: range.s.c + index })];
      if (!cell) return '';
      if (cell.f && cell.v === undefined) return '（公式未保存计算结果）';
      return String(cell.w ?? utils.format_cell(cell));
    }));
  }
  return { name, rows, columns, rowOffset: range.s.r, totalRows,
    truncated: totalRows > rows.length || fullRange.e.c > lastColumn };
}

export function parseSpreadsheet(bytes: Uint8Array, csv: boolean): PreviewSheet[] {
  const workbook = csv
    ? read(new TextDecoder('utf-8', { fatal: true }).decode(bytes), { type: 'string', raw: true, sheetRows: 2000, cellFormula: false })
    : read(bytes, { type: 'array', sheetRows: 2000, cellFormula: true, cellHTML: false, cellText: true, bookVBA: false });
  return workbook.SheetNames.filter((_, index) => !workbook.Workbook?.Sheets?.[index]?.Hidden)
    .map((name) => previewSheet(name, workbook.Sheets[name]!));
}
