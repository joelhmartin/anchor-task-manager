import crypto from 'crypto';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';

// Uses Document AI REST API with GoogleAuth (available via @google-cloud/vertexai transitive deps).
// We avoid adding a heavy SDK dependency and keep calls explicit.

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);

const pdfjsDistBaseDir = path.dirname(require.resolve('pdfjs-dist/package.json'));
const standardFontDataUrl = pathToFileURL(path.join(pdfjsDistBaseDir, 'standard_fonts/')).href;
const cMapUrl = pathToFileURL(path.join(pdfjsDistBaseDir, 'cmaps/')).href;

async function canRun(cmd) {
  try {
    await execFileAsync(cmd, ['-h'], { timeout: 3000 });
    return true;
  } catch (e) {
    // If the binary exists, it usually returns exit code 0/1 with help output.
    if (e?.code === 0 || e?.code === 1) return true;
    return false;
  }
}

async function renderPdfToJpegBuffersPoppler(pdfBuffer, dpi = 220) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anchor-pdf-'));
  const inputPath = path.join(tmpDir, 'input.pdf');
  const outPrefix = path.join(tmpDir, 'page');
  try {
    await fs.writeFile(inputPath, pdfBuffer);
    // pdftoppm outputs page-1.jpg, page-2.jpg, ...
    await execFileAsync('pdftoppm', ['-jpeg', '-r', String(dpi), inputPath, outPrefix], {
      timeout: 120_000,
      maxBuffer: 1024 * 1024 * 50
    });
    const files = (await fs.readdir(tmpDir))
      .filter((f) => /^page-\\d+\\.jpg$/i.test(f))
      .sort((a, b) => {
        const na = Number(a.match(/page-(\\d+)\\.jpg/i)?.[1] || 0);
        const nb = Number(b.match(/page-(\\d+)\\.jpg/i)?.[1] || 0);
        return na - nb;
      });
    const out = [];
    for (const f of files) {
      const pageNumber = Number(f.match(/page-(\\d+)\\.jpg/i)?.[1] || 0) || 1;
      // eslint-disable-next-line no-await-in-loop
      const buf = await fs.readFile(path.join(tmpDir, f));
      out.push({ buffer: buf, pageNumber });
    }
    return out;
  } finally {
    // Best-effort cleanup
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function renderPdfToJpegBuffersPdfjs(pdfBuffer, dpi = 220) {
  const [canvasMod, pdfjsMod] = await Promise.all([import('canvas'), import('pdfjs-dist/legacy/build/pdf.mjs')]);
  const { createCanvas, Image, ImageData, DOMMatrix } = canvasMod;
  const pdfjsLib = pdfjsMod?.default ?? pdfjsMod;

  // Some PDFs embed raster images. In Node, pdfjs may end up creating image objects that
  // aren't recognized by node-canvas unless these globals exist.
  // This is safe to set (we keep existing values if present).
  if (Image && !globalThis.Image) globalThis.Image = Image;
  if (ImageData && !globalThis.ImageData) globalThis.ImageData = ImageData;
  if (DOMMatrix && !globalThis.DOMMatrix) globalThis.DOMMatrix = DOMMatrix;

  // pdfjs-dist requires a proper Uint8Array, not a Node Buffer.
  const pdfBytes = new Uint8Array(pdfBuffer.buffer.slice(pdfBuffer.byteOffset, pdfBuffer.byteOffset + pdfBuffer.byteLength));

  const doc = await pdfjsLib
    .getDocument({
      data: pdfBytes,
      verbosity: 0,
      standardFontDataUrl,
      cMapUrl,
      cMapPacked: true
    })
    .promise;

  const pageBuffers = [];
  const scale = dpi / 72;

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale, rotation: page.rotate || 0 });
    const width = Math.max(1, Math.ceil(viewport.width));
    const height = Math.max(1, Math.ceil(viewport.height));
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');

    // JPEG has no alpha channel; explicitly paint a white background.
    context.save();
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.restore();

    await page.render({ canvasContext: context, viewport }).promise;
    const jpegBuffer = canvas.toBuffer('image/jpeg', { quality: 0.92 });
    pageBuffers.push({ buffer: jpegBuffer, pageNumber: pageNum });
  }

  return pageBuffers;
}

/**
 * Extract PDF text without rasterizing (canvas-free), using pdfjs getTextContent().
 * This is useful to "cross-check" AI outputs for missing/misspelled labels.
 */
export async function extractPdfTextLines(pdfBuffer, { maxPages = 5 } = {}) {
  if (!pdfBuffer?.length) return [];
  const pdfjsMod = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdfjsLib = pdfjsMod?.default ?? pdfjsMod;
  const pdfBytes = new Uint8Array(pdfBuffer.buffer.slice(pdfBuffer.byteOffset, pdfBuffer.byteOffset + pdfBuffer.byteLength));
  const doc = await pdfjsLib
    .getDocument({
      data: pdfBytes,
      verbosity: 0,
      standardFontDataUrl,
      cMapUrl,
      cMapPacked: true
    })
    .promise;

  const pageCount = Math.min(doc.numPages || 0, Math.max(1, Number(maxPages) || 5));
  const lines = [];

  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    // eslint-disable-next-line no-await-in-loop
    const page = await doc.getPage(pageNum);
    // eslint-disable-next-line no-await-in-loop
    const tc = await page.getTextContent({ disableCombineTextItems: false });
    const items = Array.isArray(tc?.items) ? tc.items : [];
    for (const it of items) {
      const s = String(it?.str || '').replace(/\s+/g, ' ').trim();
      if (!s) continue;
      lines.push(s);
    }
  }

  // De-dupe while preserving order
  const seen = new Set();
  const out = [];
  for (const l of lines) {
    const key = l.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
  }
  return out;
}

async function getAccessToken() {
  const { GoogleAuth } = await import('google-auth-library');
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const token = tokenResponse?.token || tokenResponse;
  if (!token) throw new Error('Unable to acquire Google access token for Document AI');
  return token;
}

/**
 * Process a single image (PNG) with a Document AI processor.
 */
export async function processWithDocAIImage({ imageBuffer, projectId, location, processorId, mimeType = 'image/png' }) {
  if (!imageBuffer?.length) throw new Error('Missing image bytes');
  if (!projectId) throw new Error('Missing projectId for Document AI');
  if (!location) throw new Error('Missing location for Document AI');
  if (!processorId) throw new Error('Missing processorId for Document AI');

  const token = await getAccessToken();
  const url = `https://documentai.googleapis.com/v1/projects/${projectId}/locations/${location}/processors/${processorId}:process`;

  const body = {
    rawDocument: {
      content: imageBuffer.toString('base64'),
      mimeType
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Document AI process failed (${res.status}): ${text.slice(0, 500)}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Document AI returned non-JSON (${e.message})`);
  }
}

/**
 * Render a PDF buffer to per-page raster image buffers at the given DPI.
 *
 * Note: Some DocAI processors (notably certain Layout processors) reject image/png.
 * JPEG is broadly accepted, so we default to JPEG output here.
 */
export async function renderPdfToPngBuffers(pdfBuffer, dpi = 220) {
  if (!pdfBuffer?.length) throw new Error('Missing PDF buffer for rasterization');
  const rasterizer = String(process.env.FORMS_PDF_RASTERIZER || 'auto').toLowerCase();
  const tryPoppler = rasterizer === 'auto' || rasterizer === 'poppler';
  const tryPdfjs = rasterizer === 'auto' || rasterizer === 'pdfjs';

  if (tryPoppler && (await canRun('pdftoppm'))) {
    try {
      console.log('[pdf-raster] using poppler (pdftoppm)');
      return await renderPdfToJpegBuffersPoppler(pdfBuffer, dpi);
    } catch (e) {
      console.warn('[pdf-raster] poppler failed, falling back to pdfjs:', e?.message || String(e));
      if (!tryPdfjs) throw e;
    }
  }

  if (tryPdfjs) {
    console.log('[pdf-raster] using pdfjs+canvas');
    return await renderPdfToJpegBuffersPdfjs(pdfBuffer, dpi);
  }

  throw new Error('No PDF rasterizer available (set FORMS_PDF_RASTERIZER=pdfjs or install poppler-utils)');
}

/**
 * Shift all textAnchor indices by an offset so we can concatenate per-page documents.
 */
function shiftAnchors(obj, offset) {
  if (!obj || typeof obj !== 'object') return;
  if (obj.textAnchor) {
    const segs = obj.textAnchor.textSegments || obj.textAnchor.text_segments;
    if (Array.isArray(segs)) {
      segs.forEach((seg) => {
        if (seg.startIndex !== undefined) seg.startIndex = String(Number(seg.startIndex || 0) + offset);
        if (seg.endIndex !== undefined) seg.endIndex = String(Number(seg.endIndex || 0) + offset);
        if (seg.start_index !== undefined) seg.start_index = String(Number(seg.start_index || 0) + offset);
        if (seg.end_index !== undefined) seg.end_index = String(Number(seg.end_index || 0) + offset);
      });
    }
  }
  if (obj.text_anchor) {
    const segs = obj.text_anchor.text_segments || obj.text_anchor.textSegments;
    if (Array.isArray(segs)) {
      segs.forEach((seg) => {
        if (seg.start_index !== undefined) seg.start_index = String(Number(seg.start_index || 0) + offset);
        if (seg.end_index !== undefined) seg.end_index = String(Number(seg.end_index || 0) + offset);
        if (seg.startIndex !== undefined) seg.startIndex = String(Number(seg.startIndex || 0) + offset);
        if (seg.endIndex !== undefined) seg.endIndex = String(Number(seg.endIndex || 0) + offset);
      });
    }
  }
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val && typeof val === 'object') shiftAnchors(val, offset);
  }
}

/**
 * Merge an array of per-page DocAI results into a single doc with adjusted text anchors.
 */
export function mergeDocAiPages(pageResults = []) {
  let textOffset = 0;
  const mergedPages = [];
  let mergedText = '';

  for (const res of pageResults) {
    const doc = res?.document || res;
    const page = Array.isArray(doc?.pages) ? doc.pages[0] : null;
    if (!page) continue;

    const pageText = String(doc?.text || '');
    // Shift anchors by current offset
    shiftAnchors(page, textOffset);

    mergedPages.push(page);
    mergedText += pageText;
    textOffset = mergedText.length;
  }

  return {
    document: {
      text: mergedText,
      pages: mergedPages
    }
  };
}

function getTextFromAnchor(doc, textAnchor) {
  const full = String(doc?.document?.text || doc?.text || '');
  const segments = textAnchor?.textSegments || textAnchor?.text_segments || [];
  if (!segments.length) return '';
  let out = '';
  for (const seg of segments) {
    const start = Number(seg.startIndex ?? seg.start_index ?? 0);
    const end = Number(seg.endIndex ?? seg.end_index ?? 0);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      out += full.slice(start, end);
    }
  }
  return out.replace(/\s+/g, ' ').trim();
}

function toBox(boundingPoly) {
  const verts = boundingPoly?.normalizedVertices || boundingPoly?.normalized_vertices || boundingPoly?.vertices || [];
  if (!Array.isArray(verts) || verts.length === 0) return null;
  const xs = verts.map((v) => Number(v.x ?? 0));
  const ys = verts.map((v) => Number(v.y ?? 0));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  if (![minX, maxX, minY, maxY].every((n) => Number.isFinite(n))) return null;
  return { x: minX, y: minY, width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) };
}

function snakeCase(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

// Detect if text looks like a section header (not a field label)
function looksLikeSectionHeader(text) {
  const t = String(text || '').trim();
  if (!t || t.length < 3 || t.length > 80) return false;
  // Ends with colon = probably a field label
  if (/:[\s]*$/.test(t)) return false;
  // Common section header patterns
  const headerPatterns = [
    /^(section|part|page)\s*\d*\s*[:\-–]?\s*/i,
    /information$/i,
    /history$/i,
    /conditions$/i,
    /details$/i,
    /questionnaire$/i,
    /evaluation$/i,
    /^demographic/i,
    /^contact/i,
    /^provider/i,
    /^patient/i,
    /^medical/i,
    /^health/i,
    /^surgical/i,
    /^allergic/i,
    /^current\s+medications/i,
    /^additional/i,
    /^authorization/i,
    /^sleep/i,
    /^daytime/i,
    /^nighttime/i
  ];
  for (const p of headerPatterns) {
    if (p.test(t)) return true;
  }
  // ALL CAPS text longer than 10 chars is often a header
  if (t === t.toUpperCase() && t.length > 10 && /[A-Z]/.test(t)) return true;
  return false;
}

export function normalizeDocAiToSchema({ layoutResult, formResult, templateId, instructions = '' }) {
  const layoutDoc = layoutResult?.document || layoutResult;
  const formDoc = formResult?.document || formResult;

  const pages = Array.isArray(layoutDoc?.pages) ? layoutDoc.pages : [];
  const formPages = Array.isArray(formDoc?.pages) ? formDoc.pages : [];
  const entities = Array.isArray(formDoc?.entities) ? formDoc.entities : [];

  // Some Layout processors return a different shape: document.documentLayout.blocks[] (no pages/lines).
  // In that case, we build a minimal schema and infer fields directly from the extracted block text.
  const layoutBlocks = Array.isArray(layoutDoc?.documentLayout?.blocks) ? layoutDoc.documentLayout.blocks : [];

  function normalizeFieldsFromLayoutBlocks(blocks) {
    const out = [];
    const usedNames = new Set();

    const cleanLabel = (s) =>
      String(s || '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[:\s]+$/, '');

    const isBareCheckbox = (t) => {
      const s = String(t || '').trim();
      return s === '☐' || s === '☑' || s === '□' || s === '■' || s === '[ ]' || s === '[x]' || s === '( )' || s === '(x)';
    };

    const parseCheckboxLine = (t) => {
      const s = String(t || '').trim();
      // Match leading checkbox symbols and take the remainder as label
      const m = s.match(/^(?:☐|☑|□|■|\[ \]|\[x\]|\( \)|\(x\))\s*(.+)$/i);
      if (!m) return null;
      return cleanLabel(m[1]);
    };

    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const rawText = b?.textBlock?.text ?? b?.text_block?.text ?? '';
      const text = String(rawText || '').trim();
      if (!text) continue;

      const pageStart = Number(b?.pageSpan?.pageStart ?? b?.page_span?.page_start ?? 1) || 1;

      // Checkbox: either inline "☐ Label" or a bare checkbox followed by a label block
      const checkboxInlineLabel = parseCheckboxLine(text);
      if (checkboxInlineLabel) {
        const base = snakeCase(checkboxInlineLabel) || `checkbox_${out.length + 1}`;
        let name = base;
        let n = 2;
        while (usedNames.has(name)) name = `${base}_${n++}`;
        usedNames.add(name);
        out.push({
          id: `field_${crypto.randomUUID().slice(0, 8)}`,
          type: 'field',
          name,
          label: checkboxInlineLabel,
          inputType: 'checkbox',
          required: false,
          confidence: null,
          page_number: pageStart,
          y: 0,
          x: 0
        });
        continue;
      }

      if (isBareCheckbox(text)) {
        const next = blocks[i + 1];
        const nextText = String(next?.textBlock?.text ?? next?.text_block?.text ?? '').trim();
        const nextPage = Number(next?.pageSpan?.pageStart ?? next?.page_span?.page_start ?? pageStart) || pageStart;
        if (nextText && nextPage === pageStart) {
          const label = cleanLabel(nextText);
          if (label) {
            const base = snakeCase(label) || `checkbox_${out.length + 1}`;
            let name = base;
            let n = 2;
            while (usedNames.has(name)) name = `${base}_${n++}`;
            usedNames.add(name);
            out.push({
              id: `field_${crypto.randomUUID().slice(0, 8)}`,
              type: 'field',
              name,
              label,
              inputType: 'checkbox',
              required: false,
              confidence: null,
              page_number: pageStart,
              y: 0,
              x: 0
            });
            i++; // consume label block
            continue;
          }
        }
        continue;
      }

      // Text field heuristics from plain text:
      // - "Label:" or "Label: ____"
      // - "Label ____"
      const t = text.replace(/\s+/g, ' ').trim();
      const mColon = t.match(/^(.{2,80}?):\s*(?:_{2,}.*)?$/);
      const mUnderscore = t.match(/^(.{2,80}?)\s+_{4,}\s*$/);
      const candidate = cleanLabel(mColon?.[1] || mUnderscore?.[1] || '');
      if (candidate && !looksLikeSectionHeader(candidate)) {
        const base = snakeCase(candidate) || `field_${out.length + 1}`;
        let name = base;
        let n = 2;
        while (usedNames.has(name)) name = `${base}_${n++}`;
        usedNames.add(name);
        out.push({
          id: `field_${crypto.randomUUID().slice(0, 8)}`,
          type: 'field',
          name,
          label: candidate,
          inputType: /notes|description|explain|reason|comment/i.test(candidate) ? 'textarea' : 'text',
          required: false,
          confidence: null,
          page_number: pageStart,
          y: 0,
          x: 0
        });
      }
    }

    return out;
  }

  // Extract section headers from layout paragraphs/blocks
  const sections = [];
  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const p = pages[pageIdx];
    const paragraphs = Array.isArray(p.paragraphs) ? p.paragraphs : [];
    const blocks = Array.isArray(p.blocks) ? p.blocks : [];

    // Check paragraphs first
    for (const para of paragraphs) {
      const text = getTextFromAnchor(layoutDoc, para.layout?.textAnchor || para.layout?.text_anchor);
      if (looksLikeSectionHeader(text)) {
        const box = toBox(para.layout?.boundingPoly || para.layout?.bounding_poly);
        sections.push({
          id: `section_${crypto.randomUUID().slice(0, 8)}`,
          title: text.replace(/[:\-–]+$/, '').trim(),
          page_number: pageIdx + 1,
          y: box?.y ?? 0,
          box
        });
      }
    }

    // Also check blocks
    for (const block of blocks) {
      const text = getTextFromAnchor(layoutDoc, block.layout?.textAnchor || block.layout?.text_anchor);
      if (looksLikeSectionHeader(text)) {
        // Avoid duplicates
        const exists = sections.some((s) => s.page_number === pageIdx + 1 && s.title === text.replace(/[:\-–]+$/, '').trim());
        if (exists) continue;
        const box = toBox(block.layout?.boundingPoly || block.layout?.bounding_poly);
        sections.push({
          id: `section_${crypto.randomUUID().slice(0, 8)}`,
          title: text.replace(/[:\-–]+$/, '').trim(),
          page_number: pageIdx + 1,
          y: box?.y ?? 0,
          box
        });
      }
    }
  }

  // Sort sections by page then y
  sections.sort((a, b) => {
    if (a.page_number !== b.page_number) return a.page_number - b.page_number;
    return a.y - b.y;
  });

  const schema = {
    template_id: templateId,
    runtime_mode: 'docai',
    source: {
      layout_processor_id: process.env.DOCUMENTAI_LAYOUT_PROCESSOR_ID || 'ba0d8a19615c2dd6',
      form_processor_id: process.env.DOCUMENTAI_FORM_PROCESSOR_ID || 'acce8166c1b5d237',
      location: process.env.DOCUMENTAI_LOCATION || 'us'
    },
    instructions,
    sections,
    page_count:
      pages.length > 0
        ? Math.max(pages.length, formPages.length)
        : Math.max(
            1,
            formPages.length,
            layoutBlocks.reduce((max, b) => Math.max(max, Number(b?.pageSpan?.pageEnd ?? b?.page_span?.page_end ?? 1) || 1), 1)
          ),
    pages:
      pages.length > 0
        ? pages.map((p, idx) => {
            const dim = p.dimension || {};
            return {
              page_number: idx + 1,
              width: dim.width ?? null,
              height: dim.height ?? null
            };
          })
        : Array.from({ length: Math.max(1, formPages.length) }, (_, idx) => ({
            page_number: idx + 1,
            width: null,
            height: null
          }))
  };

  const used = new Set();
  const fields = [];

  // 0) If we have no page geometry but we do have documentLayout.blocks, infer fields from blocks.
  if (pages.length === 0 && layoutBlocks.length > 0) {
    const blockFields = normalizeFieldsFromLayoutBlocks(layoutBlocks);
    for (const f of blockFields) {
      used.add(f.name);
      fields.push(f);
    }
  }

  // 1) Prefer Form Parser formFields (checkboxes + detected inputs)
  for (let pageIdx = 0; pageIdx < formPages.length; pageIdx++) {
    const p = formPages[pageIdx];
    const ffs = Array.isArray(p.formFields) ? p.formFields : [];
    for (const ff of ffs) {
      const rawLabel =
        ff?.fieldName?.textAnchor?.content || getTextFromAnchor(formDoc, ff?.fieldName?.textAnchor || ff?.fieldName?.text_anchor);
      const label = String(rawLabel || '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[:\s]+$/, '');
      if (!label) continue;
      // Skip if it looks like a section header
      if (looksLikeSectionHeader(label)) continue;

      const vt = String(ff?.valueType || '').toLowerCase();
      const isCheckbox = vt.includes('checkbox') || vt.includes('selection');
      const inputType = isCheckbox ? 'checkbox' : 'text';

      const base = snakeCase(label) || `field_${fields.length + 1}`;
      let name = base;
      let i = 2;
      while (used.has(name)) name = `${base}_${i++}`;
      used.add(name);

      const labelBox = toBox(ff?.fieldName?.boundingPoly || ff?.fieldName?.bounding_poly);

      fields.push({
        id: `field_${crypto.randomUUID().slice(0, 8)}`,
        type: 'field',
        name,
        label,
        inputType,
        required: false,
        confidence: ff?.fieldName?.confidence ?? ff?.fieldValue?.confidence ?? null,
        page_number: pageIdx + 1,
        y: labelBox?.y ?? 0,
        x: labelBox?.x ?? 0,
        label_box: labelBox,
        field_box: toBox(ff?.fieldValue?.boundingPoly || ff?.fieldValue?.bounding_poly),
        valueType: ff?.valueType || null
      });
    }
  }

  // 2) Heuristic: infer text inputs from Layout lines ending in ":" (captures First Name:, DOB:, etc.)
  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const p = pages[pageIdx];
    const lines = Array.isArray(p.lines) ? p.lines : [];
    for (const line of lines) {
      const text = getTextFromAnchor(layoutDoc, line.layout?.textAnchor || line.layout?.text_anchor);
      const t = String(text || '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!t) continue;

      // Common label patterns in forms
      const looksLikeLabel = /:\s*$/.test(t) || /:\s*_{2,}\s*$/.test(t) || /_{4,}\s*$/.test(t);
      if (!looksLikeLabel) continue;
      if (t.length < 2 || t.length > 64) continue;
      if (looksLikeSectionHeader(t)) continue;

      const label = t
        .replace(/_{2,}\s*$/g, '')
        .replace(/:\s*$/g, '')
        .trim();
      if (!label) continue;

      // Don't create duplicates if Form Parser already created it.
      const base = snakeCase(label);
      if (!base) continue;
      if (used.has(base)) continue;

      used.add(base);
      const labelBox = toBox(line.layout?.boundingPoly || line.layout?.bounding_poly);
      fields.push({
        id: `field_${crypto.randomUUID().slice(0, 8)}`,
        type: 'field',
        name: base,
        label,
        inputType: /notes|description|explain|reason|comment/i.test(label) ? 'textarea' : 'text',
        required: false,
        confidence: null,
        page_number: pageIdx + 1,
        y: labelBox?.y ?? 0,
        x: labelBox?.x ?? 0,
        label_box: labelBox
      });
    }
  }

  // 3) Last resort: entities (often generic_entities) — only if we extracted almost nothing
  if (fields.length < 5) {
    for (const ent of entities.slice(0, 200)) {
      const raw = String(ent.mentionText || ent.mention_text || '').trim();
      const type = String(ent.type || '').trim();
      const label = raw || type;
      if (!label || type === 'generic_entities') continue;

      const base = snakeCase(label) || `field_${fields.length + 1}`;
      let name = base;
      let i = 2;
      while (used.has(name)) name = `${base}_${i++}`;
      used.add(name);

      fields.push({
        id: `field_${crypto.randomUUID().slice(0, 8)}`,
        type: 'field',
        name,
        label,
        inputType: 'text',
        required: false,
        confidence: ent.confidence ?? null,
        page_number: 1,
        y: 0,
        x: 0
      });
    }
  }

  // Sort fields by page_number then y position then x position
  fields.sort((a, b) => {
    const pa = Number(a.page_number || 0);
    const pb = Number(b.page_number || 0);
    if (pa !== pb) return pa - pb;
    const ya = Number(a.y ?? 0);
    const yb = Number(b.y ?? 0);
    if (Math.abs(ya - yb) > 0.02) return ya - yb; // Different rows
    // Same row: sort by x
    const xa = Number(a.x ?? 0);
    const xb = Number(b.x ?? 0);
    return xa - xb;
  });

  // Assign each field to a section
  for (const field of fields) {
    const page = field.page_number || 1;
    const y = field.y || 0;
    // Find the section that is on the same page and has y <= field.y
    let bestSection = null;
    for (const sec of sections) {
      if (sec.page_number > page) break;
      if (sec.page_number === page && sec.y <= y) {
        bestSection = sec;
      } else if (sec.page_number < page) {
        bestSection = sec;
      }
    }
    field.section_id = bestSection?.id || null;
  }

  schema.fields = fields;
  return schema;
}

// Group checkboxes that are on similar Y positions into rows
function groupCheckboxesIntoRows(checkboxes, threshold = 0.025) {
  if (!checkboxes.length) return [];

  const rows = [];
  let currentRow = [checkboxes[0]];

  for (let i = 1; i < checkboxes.length; i++) {
    const prev = checkboxes[i - 1];
    const curr = checkboxes[i];
    const yDiff = Math.abs((curr.y || 0) - (prev.y || 0));

    if (yDiff <= threshold) {
      currentRow.push(curr);
    } else {
      rows.push(currentRow);
      currentRow = [curr];
    }
  }
  rows.push(currentRow);

  return rows;
}

// Group text fields that are on similar Y positions into rows (multi-column)
function groupFieldsIntoRows(textFields, threshold = 0.02) {
  if (!textFields.length) return [];

  const rows = [];
  let currentRow = [textFields[0]];

  for (let i = 1; i < textFields.length; i++) {
    const prev = textFields[i - 1];
    const curr = textFields[i];
    const yDiff = Math.abs((curr.y || 0) - (prev.y || 0));

    if (yDiff <= threshold && currentRow.length < 4) {
      currentRow.push(curr);
    } else {
      rows.push(currentRow);
      currentRow = [curr];
    }
  }
  rows.push(currentRow);

  return rows;
}

export function renderDocAiSchemaToHtml({ schema, formTitle }) {
  const title = formTitle || 'Imported PDF Form';
  const fields = Array.isArray(schema?.fields) ? schema.fields : [];
  const sections = Array.isArray(schema?.sections) ? schema.sections : [];
  const pageCount = schema?.page_count || 1;

  // Build a map of section_id -> fields
  const sectionFieldsMap = new Map();
  const unsectionedFields = [];

  for (const field of fields) {
    if (field.section_id) {
      if (!sectionFieldsMap.has(field.section_id)) {
        sectionFieldsMap.set(field.section_id, []);
      }
      sectionFieldsMap.get(field.section_id).push(field);
    } else {
      unsectionedFields.push(field);
    }
  }

  // Build HTML for a group of fields with intelligent layout
  function renderFieldGroup(groupFields) {
    if (!groupFields.length) return '';

    // Separate checkboxes and other fields
    const checkboxes = groupFields.filter((f) => f.inputType === 'checkbox');
    const otherFields = groupFields.filter((f) => f.inputType !== 'checkbox');

    let html = '';

    // Render checkboxes in grid rows
    if (checkboxes.length > 0) {
      const cbRows = groupCheckboxesIntoRows(checkboxes);
      for (const row of cbRows) {
        if (row.length === 1) {
          html += renderField(row[0]);
        } else {
          // Multiple checkboxes on same row - use grid
          const cols = Math.min(row.length, 4);
          html += `\n    <div class="ac-checkbox-row ac-cols-${cols}">`;
          for (const cb of row) {
            html += `
      <label class="ac-check">
        <input type="checkbox" name="${cb.name}" value="true" />
        <span></span>
        ${escapeHtml(cb.label || cb.name)}
      </label>`;
          }
          html += `\n    </div>`;
        }
      }
    }

    // Render other fields with multi-column detection
    if (otherFields.length > 0) {
      const fieldRows = groupFieldsIntoRows(otherFields);
      for (const row of fieldRows) {
        if (row.length === 1) {
          html += renderField(row[0]);
        } else {
          // Multiple fields on same row - use grid
          const cols = Math.min(row.length, 3);
          html += `\n    <div class="ac-field-row ac-cols-${cols}">`;
          for (const f of row) {
            html += renderFieldInner(f);
          }
          html += `\n    </div>`;
        }
      }
    }

    return html;
  }

  function renderField(f) {
    const id = `f_${f.name}`;
    if (f.inputType === 'checkbox') {
      return `
    <div class="ac-form-group">
      <label class="ac-check">
        <input type="checkbox" name="${f.name}" value="true" />
        <span></span>
        ${escapeHtml(f.label || f.name)}
      </label>
    </div>`;
    }
    if (f.inputType === 'textarea') {
      return `
    <div class="ac-form-group">
      <textarea class="ac-textarea" id="${id}" name="${f.name}" placeholder=" " ${f.required ? 'required' : ''}></textarea>
      <label class="ac-label" for="${id}">${escapeHtml(f.label || f.name)}</label>
    </div>`;
    }
    return `
    <div class="ac-form-group">
      <input class="ac-input" id="${id}" name="${f.name}" placeholder=" " ${f.required ? 'required' : ''} />
      <label class="ac-label" for="${id}">${escapeHtml(f.label || f.name)}</label>
    </div>`;
  }

  function renderFieldInner(f) {
    const id = `f_${f.name}`;
    if (f.inputType === 'textarea') {
      return `
      <div class="ac-form-group">
        <textarea class="ac-textarea" id="${id}" name="${f.name}" placeholder=" " ${f.required ? 'required' : ''}></textarea>
        <label class="ac-label" for="${id}">${escapeHtml(f.label || f.name)}</label>
      </div>`;
    }
    return `
      <div class="ac-form-group">
        <input class="ac-input" id="${id}" name="${f.name}" placeholder=" " ${f.required ? 'required' : ''} />
        <label class="ac-label" for="${id}">${escapeHtml(f.label || f.name)}</label>
      </div>`;
  }

  // Build the main HTML
  let formHtml = '';

  // If we have sections, render section by section
  if (sections.length > 0) {
    // First render any unsectioned fields at the top
    if (unsectionedFields.length > 0) {
      formHtml += renderFieldGroup(unsectionedFields);
    }

    for (const section of sections) {
      const sectionFields = sectionFieldsMap.get(section.id) || [];
      if (sectionFields.length === 0 && !section.title) continue;

      formHtml += `
    <fieldset class="ac-section">
      <legend class="ac-section-title">${escapeHtml(section.title)}</legend>
      ${renderFieldGroup(sectionFields)}
    </fieldset>`;
    }
  } else {
    // No sections detected - group by page
    const fieldsByPage = new Map();
    for (const f of fields) {
      const pg = f.page_number || 1;
      if (!fieldsByPage.has(pg)) fieldsByPage.set(pg, []);
      fieldsByPage.get(pg).push(f);
    }

    for (let pg = 1; pg <= pageCount; pg++) {
      const pageFields = fieldsByPage.get(pg) || [];
      if (pageFields.length === 0) continue;

      if (pageCount > 1) {
        formHtml += `
    <fieldset class="ac-section ac-page-section">
      <legend class="ac-section-title">Page ${pg}</legend>
      ${renderFieldGroup(pageFields)}
    </fieldset>`;
      } else {
        formHtml += renderFieldGroup(pageFields);
      }
    }
  }

  const html = `
<div class="ac-form-container">
  <h1 class="ac-form-title">${escapeHtml(title)}</h1>
  <form data-anchor-form class="ac-form" novalidate>
    ${formHtml}
    <button class="ac-button" type="submit">Submit</button>
  </form>
</div>`.trim();

  const css = `
:root {
  --ac-color-primary: #667eea;
  --ac-color-primary-dark: #764ba2;
  --ac-color-text: #1a202c;
  --ac-color-text-light: #718096;
  --ac-color-border: #e2e8f0;
  --ac-color-bg: #ffffff;
  --ac-color-section-bg: #f8fafc;
  --ac-radius: 8px;
  --ac-transition: all 0.2s ease;
}
* { box-sizing: border-box; }
body {
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #f6f7fb;
  margin: 0;
  padding: 20px;
}
.ac-form-container {
  background: var(--ac-color-bg);
  padding: 32px;
  width: 100%;
  max-width: 900px;
  margin: 0 auto;
  border-radius: var(--ac-radius);
  box-shadow: 0 10px 30px rgba(0,0,0,0.08);
}
.ac-form-title {
  margin: 0 0 24px;
  font-size: 24px;
  font-weight: 600;
  color: var(--ac-color-text);
  text-align: center;
}
.ac-form { display: flex; flex-direction: column; gap: 8px; }
.ac-section {
  border: 1px solid var(--ac-color-border);
  border-radius: var(--ac-radius);
  padding: 20px;
  margin: 16px 0;
  background: var(--ac-color-section-bg);
}
.ac-section-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--ac-color-primary-dark);
  padding: 0 8px;
}
.ac-form-group { position: relative; margin-bottom: 16px; }

/* Multi-column layouts */
.ac-field-row, .ac-checkbox-row {
  display: grid;
  gap: 16px;
  margin-bottom: 16px;
}
.ac-cols-2 { grid-template-columns: repeat(2, 1fr); }
.ac-cols-3 { grid-template-columns: repeat(3, 1fr); }
.ac-cols-4 { grid-template-columns: repeat(4, 1fr); }
@media (max-width: 600px) {
  .ac-field-row, .ac-checkbox-row { grid-template-columns: 1fr !important; }
}

/* Text inputs */
.ac-input, .ac-textarea {
  width: 100%;
  padding: 14px 12px 6px;
  border: 2px solid var(--ac-color-border);
  border-radius: var(--ac-radius);
  font-size: 15px;
  background: var(--ac-color-bg);
  outline: none;
  transition: var(--ac-transition);
}
.ac-textarea {
  min-height: 100px;
  resize: vertical;
}
.ac-input:focus, .ac-textarea:focus { border-color: var(--ac-color-primary); }
.ac-label {
  position: absolute;
  top: 50%;
  left: 12px;
  transform: translateY(-50%);
  font-size: 14px;
  color: var(--ac-color-text-light);
  background: var(--ac-color-bg);
  padding: 0 4px;
  pointer-events: none;
  transition: var(--ac-transition);
}
.ac-textarea ~ .ac-label { top: 20px; transform: none; }
.ac-input:focus ~ .ac-label,
.ac-input:not(:placeholder-shown) ~ .ac-label,
.ac-textarea:focus ~ .ac-label,
.ac-textarea:not(:placeholder-shown) ~ .ac-label {
  top: -8px;
  transform: none;
  font-size: 12px;
  color: var(--ac-color-primary);
}

/* Checkboxes */
.ac-check {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 14px;
  color: var(--ac-color-text);
  padding: 6px 0;
}
.ac-check input { display: none; }
.ac-check span {
  width: 20px;
  height: 20px;
  border: 2px solid var(--ac-color-border);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: var(--ac-transition);
  flex-shrink: 0;
}
.ac-check input:checked + span {
  background: var(--ac-color-primary);
  border-color: var(--ac-color-primary);
}
.ac-check input:checked + span::after {
  content: '';
  width: 6px;
  height: 10px;
  border: solid white;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}

/* Submit button */
.ac-button {
  width: 100%;
  margin-top: 24px;
  padding: 14px;
  border: none;
  border-radius: var(--ac-radius);
  font-size: 16px;
  font-weight: 600;
  background: linear-gradient(135deg, var(--ac-color-primary), var(--ac-color-primary-dark));
  color: #fff;
  cursor: pointer;
  transition: var(--ac-transition);
}
.ac-button:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(102,126,234,0.3); }
`.trim();

  // Basic JS for floating labels
  const js = `
document.addEventListener('DOMContentLoaded', () => {
  // Floating labels
  document.querySelectorAll('.ac-input, .ac-textarea').forEach(el => {
    const update = () => el.classList.toggle('ac-has-content', el.value.trim() !== '');
    el.addEventListener('input', update);
    el.addEventListener('change', update);
    update();
  });
});
`.trim();

  return { html, css, js };
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
