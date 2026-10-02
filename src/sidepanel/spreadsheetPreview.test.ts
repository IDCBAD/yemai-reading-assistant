import { describe, expect, it } from 'vitest';
import { utils, write } from 'xlsx';
import { parseSpreadsheet, previewSheet } from './spreadsheetPreview';

describe('read-only spreadsheet previews', () => {
  it('preserves CSV identifiers, quoted commas, multiline cells and formula-looking text', () => {
    const csv = '编号,说明,计算\r\n001,"一,二",=1+1\r\n002,"第一行\n第二行",+CMD\r\n';
    const sheet = parseSpreadsheet(new TextEncoder().encode(csv), true)[0]!;
    expect(sheet.rows[1]).toEqual(['001', '一,二', '=1+1']);
    expect(sheet.rows[2]).toEqual(['002', '第一行\n第二行', '+CMD']);
  });
  it('shows cached formula results and formatted values without evaluation', () => {
    const sheet = previewSheet('报告', { '!ref': 'B2:D3', B2: { t: 'n', v: 0.5, z: '0%' }, C2: { t: 'n', f: '1+1', v: 2 }, D2: { t: 'n', f: '1+1' } });
    expect(sheet.columns).toEqual(['B', 'C', 'D']);
    expect(sheet.rowOffset).toBe(1);
    expect(sheet.rows[0]).toEqual(['50%', '2', '（公式未保存计算结果）']);
  });
  it('bounds misleading worksheet dimensions', () => {
    const sheet = previewSheet('大表', { '!ref': 'A1:XFD1048576', A1: { t: 's', v: '数据' } });
    expect(sheet.rows).toHaveLength(2000); expect(sheet.columns).toHaveLength(100);
    expect(sheet.truncated).toBe(true);
  });
  it('reads XLSX workbooks, retains Chinese sheet names and hides hidden sheets', () => {
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, utils.aoa_to_sheet([['项目', '金额'], ['阅读', 120]]), '汇总');
    utils.book_append_sheet(workbook, utils.aoa_to_sheet([['明细']]), '明细');
    utils.book_append_sheet(workbook, utils.aoa_to_sheet([['隐藏']]), '隐藏');
    workbook.Workbook = { Sheets: [{ name: '汇总', Hidden: 0 }, { name: '明细', Hidden: 0 }, { name: '隐藏', Hidden: 1 }] };
    const sheets = parseSpreadsheet(new Uint8Array(write(workbook, { type: 'array', bookType: 'xlsx' })), false);
    expect(sheets.map((sheet) => sheet.name)).toEqual(['汇总', '明细']);
    expect(sheets[0]?.rows[1]).toEqual(['阅读', '120']);
  });
  it('handles empty sheets', () => {
    expect(previewSheet('空表', {}).rows).toEqual([]);
  });
});
