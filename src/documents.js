export const DOCUMENT_FILE_SIZE_LIMIT_MB = 50;

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl', 'log', 'xml', 'yaml', 'yml', 'ini', 'toml',
]);
const STRUCTURED_EXTENSIONS = new Set(['pdf', 'docx', 'xlsx']);
const TEXT_MIME_TYPES = new Set([
  'text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/xml', 'application/yaml', 'application/toml',
]);

function extension(name = '') {
  const match = /\.([A-Za-z0-9]+)$/.exec(String(name));
  return match ? match[1].toLowerCase() : '';
}

function extensionFor(file = {}) {
  const ext = extension(file.name);
  if (ext) return ext;
  const type = String(file.type || '').split(';')[0];
  const map = {
    'text/plain': 'txt',
    'text/markdown': 'md',
    'text/csv': 'csv',
    'application/json': 'json',
    'application/xml': 'xml',
    'application/yaml': 'yaml',
    'application/toml': 'toml',
  };
  return map[type] || '';
}

export function documentAccept() {
  return [...TEXT_EXTENSIONS, ...STRUCTURED_EXTENSIONS]
    .map(ext => `.${ext}`)
    .sort()
    .join(',');
}

export function isDocumentFile(file) {
  const ext = extension(file?.name);
  return TEXT_EXTENSIONS.has(ext)
    || STRUCTURED_EXTENSIONS.has(ext)
    || file?.type === 'application/pdf'
    || TEXT_MIME_TYPES.has(file?.type)
    || String(file?.type || '').startsWith('text/');
}

function clampText(text, maxChars) {
  const value = String(text || '').replace(/\0/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if (value.length <= maxChars) {
    return { text: value, truncated: false };
  }
  return {
    text: value.slice(0, maxChars).trimEnd(),
    truncated: true,
  };
}

function cleanupText(text) {
  return String(text || '')
    .replace(/\0/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractPlainText(file, maxChars) {
  // Reading only the byte range needed for the current default keeps accidental
  // multi-hundred-MB text files from blocking the UI thread or exhausting memory.
  const blob = file.slice(0, Math.max(4096, maxChars * 8));
  const raw = await blob.text();
  const result = clampText(cleanupText(raw), maxChars);
  if (!result.text) throw new Error('Document contains no readable text');
  if (raw.length >= blob.size && file.size > blob.size) result.truncated = true;
  return result;
}

async function extractPdf(file, maxChars) {
  const [pdfjs, workerModule] = await Promise.all([
    import('pdfjs-dist/build/pdf.mjs'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default;

  const data = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data }).promise;
  const chunks = [];
  let length = 0;
  let pagesRead = 0;

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    let pageText = '';
    for (const item of content.items) {
      if (typeof item?.str !== 'string') continue;
      pageText += item.str;
      pageText += item.hasEOL ? '\n' : ' ';
    }
    pageText = cleanupText(pageText);
    if (pageText) {
      chunks.push(`[Page ${pageNumber}]\n${pageText}`);
      length += pageText.length;
      pagesRead = pageNumber;
    }
    page.cleanup?.();
    if (length >= maxChars) break;
  }

  await pdf.destroy?.();
  const result = clampText(chunks.join('\n\n'), maxChars);
  if (!result.text) throw new Error('PDF contains no selectable text; scanned PDFs need an OCR model');
  return {
    ...result,
    pages: pdf.numPages,
    pagesRead,
  };
}

async function extractDocx(file, maxChars) {
  const mammoth = await import('mammoth');
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  const extracted = clampText(cleanupText(result?.value), maxChars);
  if (!extracted.text) throw new Error('DOCX contains no readable text');
  return extracted;
}

async function extractXlsx(file, maxChars) {
  const ExcelJS = await import('exceljs');
  const data = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data);
  const chunks = [];

  for (const sheet of workbook.worksheets) {
    let sheetRows = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        values[colNumber - 1] = formatExcelValue(cell.value);
      });
      while (values.length && String(values.at(-1)).trim() === '') values.pop();
      if (values.length) sheetRows.push(values.join(','));
    });
    sheetRows = sheetRows.filter(Boolean);
    if (sheetRows.length) chunks.push(`[Sheet: ${sheet.name}]\n${sheetRows.join('\n')}`);
  }

  const result = clampText(chunks.join('\n\n'), maxChars);
  if (!result.text) throw new Error('Workbook contains no readable cells');
  return result;
}

function formatExcelValue(value) {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (value.result != null) return String(value.result);
    if (value.richText?.length) {
      return value.richText.map(part => part.text || '').join('');
    }
    if (value.error) return String(value.error);
  }
  return String(value);
}

export async function extractDocumentText(file, { maxChars = 24000 } = {}) {
  if (!file) throw new Error('No document selected');
  const sizeMB = file.size / (1024 * 1024);
  if (sizeMB > DOCUMENT_FILE_SIZE_LIMIT_MB) {
    throw new Error(`Document is ${sizeMB.toFixed(1)} MB; limit is ${DOCUMENT_FILE_SIZE_LIMIT_MB} MB`);
  }

  const ext = extensionFor(file);
  const limit = Math.max(1000, Math.round(Number(maxChars) || 24000));
  let result;
  let kind = ext || 'document';

  if (TEXT_EXTENSIONS.has(ext)) {
    result = await extractPlainText(file, limit);
  } else if (ext === 'pdf' || file.type === 'application/pdf') {
    kind = 'pdf';
    result = await extractPdf(file, limit);
  } else if (ext === 'docx') {
    kind = 'docx';
    result = await extractDocx(file, limit);
  } else if (ext === 'xlsx') {
    kind = 'xlsx';
    result = await extractXlsx(file, limit);
  } else {
    throw new Error(`Unsupported document type: .${ext || 'unknown'}`);
  }

  return {
    ...result,
    kind,
    name: file.name || 'document',
    sizeBytes: file.size || 0,
    mimeType: file.type || '',
  };
}

export function formatDocumentForModel(instruction, document) {
  const task = String(instruction || '').trim() || 'Please understand this document and answer questions about it.';
  if (!document?.text) return task;

  const meta = [
    `File: ${document.name}`,
    `Type: ${document.kind}`,
    `Size: ${document.sizeBytes} bytes`,
    document.pages ? `Pages: ${document.pages}` : '',
    document.truncated ? `Note: content truncated to ${document.text.length} characters` : '',
  ].filter(Boolean);

  return [
    `${meta.join('\n')}\n`,
    'Document content:',
    '<<<DOCUMENT',
    document.text,
    'DOCUMENT>>>',
    '',
    `User instruction: ${task}`,
  ].join('\n');
}
