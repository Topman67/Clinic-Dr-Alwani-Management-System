export type ExportColumn<T> = {
  header: string;
  value: (row: T) => string | number | null | undefined;
  pdfValue?: (row: T) => string;
  cellClassName?: (row: T) => string | undefined;
  width?: string;
};

export type SummaryItem = {
  label: string;
  value: string | number;
};

export type DocumentExportOptions<T> = {
  title: string;
  filename: string;
  logoUrl?: string;
  generatedAt?: string;
  filters?: string[];
  summary?: SummaryItem[];
  columns: ExportColumn<T>[];
  rows: T[];
  footerNote?: string;
};

export type ReceiptExportOptions = {
  filename: string;
  logoUrl?: string;
  clinicName: string;
  receiptNo: string;
  patientDetails: Array<{ label: string; value: string | number }>;
  paymentDetails: Array<{ label: string; value: string | number }>;
  breakdown: Array<{ label: string; value: string | number }>;
  medicineItems?: Array<Record<string, string | number>>;
  grandTotal: string | number;
  paidStatus: string;
  footerNote?: string;
};

const escapeHtml = (value: string | number | null | undefined) =>
  String(value ?? '-')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const formatDateTime = (value?: string) => {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toLocaleString() : date.toLocaleString();
};

const downloadBlob = (filename: string, content: string, type: string) => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const csvValue = (value: string | number | null | undefined) => {
  const text = String(value ?? '');
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
};

const textEncoder = new TextEncoder();

const escapeXml = (value: string | number | null | undefined) =>
  String(value ?? '-')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const crcTable = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

const crc32 = (bytes: Uint8Array) => {
  let crc = 0xffffffff;
  bytes.forEach((byte) => {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  });
  return (crc ^ 0xffffffff) >>> 0;
};

const u16 = (value: number) => {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
};

const u32 = (value: number) => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
};

const concatBytes = (parts: Uint8Array[]) => {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  parts.forEach((part) => {
    output.set(part, offset);
    offset += part.length;
  });
  return output;
};

const buildZip = (files: Array<{ path: string; data: Uint8Array }>) => {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  files.forEach((file) => {
    const name = textEncoder.encode(file.path);
    const checksum = crc32(file.data);
    const localHeader = concatBytes([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(checksum), u32(file.data.length), u32(file.data.length),
      u16(name.length), u16(0), name,
    ]);
    localParts.push(localHeader, file.data);
    centralParts.push(concatBytes([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(checksum), u32(file.data.length), u32(file.data.length),
      u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name,
    ]));
    offset += localHeader.length + file.data.length;
  });

  const centralDirectory = concatBytes(centralParts);
  const end = concatBytes([
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(centralDirectory.length), u32(offset), u16(0),
  ]);
  return concatBytes([...localParts, centralDirectory, end]);
};

const columnName = (index: number) => {
  let name = '';
  let value = index;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - remainder) / 26);
  }
  return name;
};

const excelCell = (row: number, col: number, value: string | number | null | undefined, style = 0) => {
  const ref = `${columnName(col)}${row}`;
  const styleAttr = style ? ` s="${style}"` : '';
  if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"${styleAttr}><v>${value}</v></c>`;
  return `<c r="${ref}" t="inlineStr"${styleAttr}><is><t>${escapeXml(value ?? '-')}</t></is></c>`;
};

const rowXml = (row: number, cells: Array<string | number | null | undefined>, style = 0, height?: number) =>
  `<row r="${row}"${height ? ` ht="${height}" customHeight="1"` : ''}>${cells.map((cell, index) => excelCell(row, index + 1, cell, style)).join('')}</row>`;

const fetchImageBytes = async (url?: string) => {
  if (!url) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    const buffer = await blob.arrayBuffer();
    return new Uint8Array(buffer);
  } catch {
    return null;
  }
};

const documentStyles = `
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #fff; color: #1f2933; font-family: Arial, Helvetica, sans-serif; font-size: 11.5px; line-height: 1.42; }
  .sheet { width: 100%; padding-bottom: 18px; }
  .header { display: flex; align-items: center; gap: 14px; border-bottom: 1.5px solid #2f343a; padding-bottom: 12px; margin-bottom: 16px; }
  .logo { width: 58px; height: 58px; object-fit: contain; filter: grayscale(100%); }
  h1, h2, h3, p { margin: 0; }
  h1 { font-size: 20px; color: #111827; letter-spacing: 0; }
  h2 { font-size: 15px; color: #2f343a; margin-top: 2px; font-weight: 700; }
  h3 { font-size: 12.5px; color: #2f343a; margin: 16px 0 8px; font-weight: 700; }
  .meta { color: #555f6d; margin-top: 4px; }
  .filters { margin: 8px 0 14px; color: #2f343a; }
  .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 12px 0 16px; }
  .summary-card { border: 1px solid #cfd4da; padding: 9px; border-radius: 3px; background: #fafafa; }
  .summary-card span { display: block; color: #4b5563; font-size: 9.5px; text-transform: uppercase; }
  .summary-card strong { display: block; font-size: 14px; margin-top: 3px; color: #111827; }
  table { width: 100%; border-collapse: collapse; page-break-inside: auto; }
  tr { page-break-inside: avoid; page-break-after: auto; }
  tbody tr:nth-child(even) { background: #fafafa; }
  th { background: #f1f2f4; color: #111827; text-align: left; font-weight: 700; }
  th, td { border: 1px solid #cfd4da; padding: 6.5px 7px; vertical-align: top; }
  .kv { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 18px; margin: 10px 0; }
  .kv div { border-bottom: 1px solid #d8dce1; padding-bottom: 6px; }
  .kv span { display: block; color: #4b5563; font-size: 9.5px; text-transform: uppercase; }
  .kv strong { display: block; margin-top: 3px; }
  .total { display: flex; justify-content: space-between; align-items: center; border-top: 1.5px solid #2f343a; margin-top: 12px; padding-top: 10px; font-size: 15px; font-weight: 700; }
  .status { color: #1f2933; background: transparent; font-weight: 700; }
  .footer { position: fixed; bottom: 0; left: 0; right: 0; border-top: 1px solid #cfd4da; padding-top: 6px; color: #555f6d; font-size: 9.5px; display: flex; justify-content: space-between; gap: 10px; }
  .page-number:after { content: counter(page); }
`;

const buildDocumentShell = (body: string) => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Export</title>
    <style>${documentStyles}</style>
  </head>
  <body>${body}</body>
</html>`;

export const exportHtmlAsPdf = (html: string, title = 'Export') => {
  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  document.body.appendChild(frame);

  const doc = frame.contentWindow?.document;
  if (!doc) return;
  doc.open();
  doc.write(html.replace('<title>Export</title>', `<title>${escapeHtml(title)}</title>`));
  doc.close();

  let printed = false;
  const printFrame = () => {
    if (printed) return;
    printed = true;
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    window.setTimeout(() => {
      if (frame.parentNode) document.body.removeChild(frame);
    }, 800);
  };
  frame.onload = printFrame;
  window.setTimeout(printFrame, 250);
};

export const exportReportPdf = <T,>(options: DocumentExportOptions<T>) => {
  const generatedAt = formatDateTime(options.generatedAt);
  const filters = options.filters?.length ? options.filters.join(' | ') : 'None';
  const summary = options.summary?.length
    ? `<section class="summary">${options.summary.map((item) => `<div class="summary-card"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong></div>`).join('')}</section>`
    : '';
  const rows = options.rows.length
    ? options.rows.map((row) => `<tr>${options.columns.map((col) => {
      const className = col.cellClassName?.(row);
      const classAttr = className ? ` class="${escapeHtml(className)}"` : '';
      const value = col.pdfValue ? col.pdfValue(row) : escapeHtml(col.value(row));
      return `<td${classAttr}>${value}</td>`;
    }).join('')}</tr>`).join('')
    : `<tr><td colspan="${options.columns.length}">No records found.</td></tr>`;

  const html = buildDocumentShell(`
    <main class="sheet">
      <header class="header">
        ${options.logoUrl ? `<img class="logo" src="${options.logoUrl}" alt="Clinic logo" />` : ''}
        <div>
          <h1>Clinic Dr Alwani</h1>
          <h2>${escapeHtml(options.title)}</h2>
          <p class="meta">Generated: ${escapeHtml(generatedAt)}</p>
        </div>
      </header>
      <p class="filters"><strong>Applied filters:</strong> ${escapeHtml(filters)}</p>
      ${summary}
      <table>
        <thead><tr>${options.columns.map((col) => `<th>${escapeHtml(col.header)}</th>`).join('')}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <footer class="footer"><span>Generated: ${escapeHtml(generatedAt)}</span><span>Clinic Dr Alwani</span><span>Page <span class="page-number"></span></span></footer>
    </main>
  `);
  exportHtmlAsPdf(html, options.filename);
};

export const exportReportExcel = async <T,>(options: DocumentExportOptions<T>) => {
  const generated = formatDateTime(options.generatedAt);
  const filters = options.filters?.length ? options.filters.join(' | ') : 'None';
  const summary = [
    { label: 'Total Records', value: options.rows.length },
    ...(options.summary ?? []),
  ];
  const logoBytes = await fetchImageBytes(options.logoUrl);
  const headerRows = [
    rowXml(1, ['', 'Clinic Dr Alwani'], 1, 26),
    rowXml(2, ['', options.title], 2, 22),
    rowXml(3, ['', `Generated: ${generated}`], 3),
    rowXml(4, ['', `Applied filters: ${filters}`], 3),
  ];
  const summaryStart = 6;
  const summaryRows = summary.map((item, index) => rowXml(summaryStart + index, [item.label, item.value], index === 0 ? 4 : 5));
  const tableHeaderRow = summaryStart + summaryRows.length + 2;
  const tableRows = [
    rowXml(tableHeaderRow, options.columns.map((col) => col.header), 6, 20),
    ...options.rows.map((record, index) => rowXml(tableHeaderRow + index + 1, options.columns.map((col) => col.value(record)), 7)),
  ];
  const maxWidths = options.columns.map((column) => {
    const values = options.rows.map((row) => String(column.value(row) ?? ''));
    const maxLength = Math.max(column.header.length, ...values.map((value) => value.length), 10);
    const explicitWidth = column.width ? Number.parseInt(column.width, 10) / 7 : 0;
    return Math.min(42, Math.max(12, explicitWidth || maxLength + 2));
  });
  const cols = `<cols>${maxWidths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('')}</cols>`;
  const lastCol = columnName(Math.max(2, options.columns.length));
  const mergeCells = `<mergeCells count="4"><mergeCell ref="B1:${lastCol}1"/><mergeCell ref="B2:${lastCol}2"/><mergeCell ref="B3:${lastCol}3"/><mergeCell ref="B4:${lastCol}4"/></mergeCells>`;
  const drawing = logoBytes ? '<drawing r:id="rId1"/>' : '';
  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>
  ${cols}
  <sheetData>${[...headerRows, ...summaryRows, ...tableRows].join('')}</sheetData>
  ${mergeCells}
  <pageMargins left="0.45" right="0.45" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
  ${drawing}
</worksheet>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="4"><font><sz val="11"/><color rgb="FF1F2933"/><name val="Arial"/></font><font><b/><sz val="16"/><color rgb="FF111827"/><name val="Arial"/></font><font><b/><sz val="13"/><color rgb="FF2F343A"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FF111827"/><name val="Arial"/></font></fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF1F2F4"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFCFD4DA"/></left><right style="thin"><color rgb="FFCFD4DA"/></right><top style="thin"><color rgb="FFCFD4DA"/></top><bottom style="thin"><color rgb="FFCFD4DA"/></bottom><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="8">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0"/>
    <xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const sheetRels = logoBytes ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>` : '';
  const drawingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="914400" cy="685800"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="Clinic Logo"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>`;
  const drawingRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/logo.png"/></Relationships>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${logoBytes ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : ''}</Types>`;

  const files = [
    { path: '[Content_Types].xml', data: textEncoder.encode(contentTypes) },
    { path: '_rels/.rels', data: textEncoder.encode(rootRels) },
    { path: 'xl/workbook.xml', data: textEncoder.encode(workbook) },
    { path: 'xl/_rels/workbook.xml.rels', data: textEncoder.encode(workbookRels) },
    { path: 'xl/styles.xml', data: textEncoder.encode(styles) },
    { path: 'xl/worksheets/sheet1.xml', data: textEncoder.encode(worksheet) },
    ...(logoBytes ? [
      { path: 'xl/worksheets/_rels/sheet1.xml.rels', data: textEncoder.encode(sheetRels) },
      { path: 'xl/drawings/drawing1.xml', data: textEncoder.encode(drawingXml) },
      { path: 'xl/drawings/_rels/drawing1.xml.rels', data: textEncoder.encode(drawingRels) },
      { path: 'xl/media/logo.png', data: logoBytes },
    ] : []),
  ];
  const zip = buildZip(files);
  const blob = new Blob([zip], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${options.filename}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const exportReportCsv = <T,>(options: DocumentExportOptions<T>) => {
  const generated = formatDateTime(options.generatedAt);
  const filters = options.filters?.length ? options.filters.join(' | ') : 'None';
  const metaRows = [
    ['Clinic Dr Alwani'],
    [options.title],
    ['Generated Date', generated],
    ['Applied Filters', filters],
    [],
  ];
  const headerRow = options.columns.map((col) => col.header);
  const dataRows = options.rows.map((row) => options.columns.map((col) => col.value(row)));
  const csv = [...metaRows, headerRow, ...dataRows]
    .map((row) => row.map(csvValue).join(','))
    .join('\r\n');
  downloadBlob(`${options.filename}.csv`, csv, 'text/csv;charset=utf-8;');
};

export const exportReceiptPdf = (options: ReceiptExportOptions) => {
  const generatedAt = formatDateTime();
  const medicineHeaders = options.medicineItems?.length ? Object.keys(options.medicineItems[0]) : [];
  const medicineTable = medicineHeaders.length
    ? `<h3>Medicine Items</h3><table><thead><tr>${medicineHeaders.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${options.medicineItems!.map((item) => `<tr>${medicineHeaders.map((h) => `<td>${escapeHtml(item[h])}</td>`).join('')}</tr>`).join('')}</tbody></table>`
    : '<p class="meta">No medicine items.</p>';

  const html = buildDocumentShell(`
    <main class="sheet">
      <header class="header">
        ${options.logoUrl ? `<img class="logo" src="${options.logoUrl}" alt="Clinic logo" />` : ''}
        <div>
          <h1>${escapeHtml(options.clinicName)}</h1>
          <h2>Official Payment Receipt</h2>
          <p class="meta">Receipt No: ${escapeHtml(options.receiptNo)}</p>
        </div>
      </header>
      <div class="kv">${options.patientDetails.map((item) => `<div><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong></div>`).join('')}</div>
      <div class="kv">${options.paymentDetails.map((item) => `<div><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong></div>`).join('')}</div>
      ${medicineTable}
      <h3>Payment Breakdown</h3>
      <table><tbody>${options.breakdown.map((item) => `<tr><td>${escapeHtml(item.label)}</td><td>${escapeHtml(item.value)}</td></tr>`).join('')}</tbody></table>
      <div class="total"><span>Grand Total</span><span>RM ${escapeHtml(options.grandTotal)}</span></div>
      <p style="margin-top: 12px;"><span class="status">${escapeHtml(options.paidStatus)}</span></p>
      <footer class="footer"><span>Generated: ${escapeHtml(generatedAt)}</span><span>${escapeHtml(options.clinicName)}</span><span>Page <span class="page-number"></span></span></footer>
    </main>
  `);
  exportHtmlAsPdf(html, options.filename);
};
