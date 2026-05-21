export type ExportColumn<T> = {
  header: string;
  value: (row: T) => string | number | null | undefined;
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

const documentStyles = `
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #fff; color: #172033; font-family: Arial, Helvetica, sans-serif; font-size: 12px; }
  .sheet { width: 100%; }
  .header { display: flex; align-items: center; gap: 14px; border-bottom: 2px solid #243b63; padding-bottom: 12px; margin-bottom: 18px; }
  .logo { width: 64px; height: 64px; object-fit: contain; }
  h1, h2, h3, p { margin: 0; }
  h1 { font-size: 22px; color: #172033; }
  h2 { font-size: 16px; color: #243b63; margin-top: 2px; }
  h3 { font-size: 13px; color: #243b63; margin: 16px 0 8px; }
  .meta { color: #5a6475; margin-top: 4px; }
  .filters { margin: 8px 0 14px; color: #38465c; }
  .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 12px 0 16px; }
  .summary-card { border: 1px solid #d9e0ea; padding: 9px; border-radius: 4px; background: #f8fafc; }
  .summary-card span { display: block; color: #647084; font-size: 10px; text-transform: uppercase; }
  .summary-card strong { display: block; font-size: 15px; margin-top: 3px; color: #172033; }
  table { width: 100%; border-collapse: collapse; page-break-inside: auto; }
  tr { page-break-inside: avoid; page-break-after: auto; }
  th { background: #eef3f8; color: #172033; text-align: left; font-weight: 700; }
  th, td { border: 1px solid #d7dde7; padding: 7px; vertical-align: top; }
  .kv { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 18px; margin: 10px 0; }
  .kv div { border-bottom: 1px solid #e3e8f0; padding-bottom: 6px; }
  .kv span { display: block; color: #667085; font-size: 10px; text-transform: uppercase; }
  .kv strong { display: block; margin-top: 3px; }
  .total { display: flex; justify-content: space-between; align-items: center; border-top: 2px solid #243b63; margin-top: 12px; padding-top: 10px; font-size: 16px; font-weight: 700; }
  .status { display: inline-block; border: 1px solid #15803d; color: #166534; background: #f0fdf4; padding: 5px 10px; border-radius: 999px; font-weight: 700; }
  .footer { position: fixed; bottom: 0; left: 0; right: 0; border-top: 1px solid #d7dde7; padding-top: 6px; color: #667085; font-size: 10px; display: flex; justify-content: space-between; }
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
  const filters = options.filters?.length ? options.filters.join(' | ') : 'None';
  const summary = options.summary?.length
    ? `<section class="summary">${options.summary.map((item) => `<div class="summary-card"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong></div>`).join('')}</section>`
    : '';
  const rows = options.rows.length
    ? options.rows.map((row) => `<tr>${options.columns.map((col) => `<td>${escapeHtml(col.value(row))}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${options.columns.length}">No records found.</td></tr>`;

  const html = buildDocumentShell(`
    <main class="sheet">
      <header class="header">
        ${options.logoUrl ? `<img class="logo" src="${options.logoUrl}" alt="Clinic logo" />` : ''}
        <div>
          <h1>Clinic Dr Alwani</h1>
          <h2>${escapeHtml(options.title)}</h2>
          <p class="meta">Generated: ${escapeHtml(formatDateTime(options.generatedAt))}</p>
        </div>
      </header>
      <p class="filters"><strong>Applied filters:</strong> ${escapeHtml(filters)}</p>
      ${summary}
      <table>
        <thead><tr>${options.columns.map((col) => `<th>${escapeHtml(col.header)}</th>`).join('')}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <footer class="footer"><span>${escapeHtml(options.footerNote ?? 'Generated for clinic records and audit use.')}</span><span>Page <span class="page-number"></span></span></footer>
    </main>
  `);
  exportHtmlAsPdf(html, options.filename);
};

export const exportReportExcel = <T,>(options: DocumentExportOptions<T>) => {
  const filters = options.filters?.length ? options.filters.join(' | ') : 'None';
  const summaryRows = options.summary?.map((item) => `<tr><td>${escapeHtml(item.label)}</td><td>${escapeHtml(item.value)}</td></tr>`).join('') ?? '';
  const dataRows = options.rows.map((row) => `<tr>${options.columns.map((col) => `<td>${escapeHtml(col.value(row))}</td>`).join('')}</tr>`).join('');
  const workbook = `<!doctype html><html><head><meta charset="utf-8" /></head><body>
    <h2>Clinic Dr Alwani</h2>
    <h3>${escapeHtml(options.title)}</h3>
    <table border="1">
      <tr><td>Generated Date</td><td>${escapeHtml(formatDateTime(options.generatedAt))}</td></tr>
      <tr><td>Applied Filters</td><td>${escapeHtml(filters)}</td></tr>
      ${summaryRows}
    </table>
    <br />
    <table border="1">
      <thead><tr>${options.columns.map((col) => `<th>${escapeHtml(col.header)}</th>`).join('')}</tr></thead>
      <tbody>${dataRows || `<tr><td colspan="${options.columns.length}">No records found.</td></tr>`}</tbody>
    </table>
  </body></html>`;
  downloadBlob(`${options.filename}.xls`, workbook, 'application/vnd.ms-excel;charset=utf-8;');
};

export const exportReceiptPdf = (options: ReceiptExportOptions) => {
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
      <footer class="footer"><span>${escapeHtml(options.footerNote ?? 'Thank you for your payment. This is a computer-generated receipt.')}</span><span>Page <span class="page-number"></span></span></footer>
    </main>
  `);
  exportHtmlAsPdf(html, options.filename);
};
