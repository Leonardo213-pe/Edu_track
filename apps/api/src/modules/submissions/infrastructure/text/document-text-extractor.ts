import { inflateRawSync, inflateSync } from 'node:zlib';
import type { FileInput, TextExtractor } from '../../application/ports';

const MAX_TEXT = 200_000;
function decodeXml(text: string): string {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
/** Reads one entry of a ZIP archive through its central directory (DOCX); null when absent or unsupported. */
function zipEntry(zip: Buffer, name: string): Buffer | null {
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) if (zip.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) return null;
  let offset = zip.readUInt32LE(end + 16); const count = zip.readUInt16LE(end + 10);
  for (let entry = 0; entry < count && offset + 46 <= zip.length; entry++) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) return null;
    const method = zip.readUInt16LE(offset + 10), size = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28), extra = zip.readUInt16LE(offset + 30), comment = zip.readUInt16LE(offset + 32);
    const local = zip.readUInt32LE(offset + 42); const entryName = zip.subarray(offset + 46, offset + 46 + nameLength).toString();
    if (entryName === name) {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28); const data = zip.subarray(start, start + size);
      return method === 0 ? data : method === 8 ? inflateRawSync(data, { maxOutputLength: 20 * 1024 * 1024 }) : null;
    }
    offset += 46 + nameLength + extra + comment;
  }
  return null;
}
/** Best-effort text of a PDF: literal strings shown by Tj/TJ in (possibly Flate-compressed) content streams. */
function pdfText(pdf: Buffer): string {
  const parts: string[] = []; const raw = pdf.toString('latin1'); const pattern = /stream\r?\n/g; let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw)) && parts.join(' ').length < MAX_TEXT) {
    const start = match.index + match[0].length; const end = raw.indexOf('endstream', start); if (end < 0) break;
    const bytes = pdf.subarray(start, end); let content: string;
    try { content = inflateSync(bytes, { maxOutputLength: 20 * 1024 * 1024 }).toString('latin1'); } catch { content = bytes.toString('latin1'); }
    for (const block of content.match(/\[(?:[^\]\\]|\\.)*\]\s*TJ|\((?:[^()\\]|\\.)*\)\s*Tj/g) ?? [])
      parts.push((block.match(/\((?:[^()\\]|\\.)*\)/g) ?? []).map(item => item.slice(1, -1).replace(/\\([()\\])/g, '$1')).join(''));
    pattern.lastIndex = end;
  }
  return parts.join(' ');
}
/** Extracts plain text (TXT, DOCX, PDF best effort) used only for the similarity check. */
export class DocumentTextExtractor implements TextExtractor {
  async extract(file: FileInput): Promise<string | null> {
    const bytes = Buffer.from(file.bytes); const name = file.filename.toLowerCase(); let text = '';
    if (name.endsWith('.txt')) text = bytes.toString('utf8');
    else if (name.endsWith('.docx')) {
      const xml = zipEntry(bytes, 'word/document.xml')?.toString('utf8'); if (!xml) return null;
      text = decodeXml(xml.replace(/<\/w:p>/g, '\n').replace(/<w:tab\/>/g, ' ').replace(/<[^>]+>/g, ''));
    } else if (name.endsWith('.pdf')) text = pdfText(bytes);
    const normalized = text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
    return normalized ? normalized : null;
  }
}
