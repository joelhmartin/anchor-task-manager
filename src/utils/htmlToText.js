/**
 * Dependency-free HTML → plain-text converter for SMS previews.
 *
 * Pure (regex-based, no DOM) so it runs anywhere — browser or worker.
 * Intended for human-readable previews, not perfect HTML parsing.
 *
 * Behavior:
 *  - <br>, </p>, </div>, </li> → newline
 *  - <li> → "- " bullet prefix
 *  - <a href="URL">TEXT</a> → "TEXT (URL)"
 *  - strips all other tags
 *  - decodes common HTML entities
 *  - collapses 3+ newlines to 2, then trims
 *
 * @param {string} html
 * @returns {string}
 */
export function htmlToText(html) {
  if (!html) return '';

  let text = String(html);

  // Anchors: keep the link text and append the URL in parens.
  text = text.replace(/<a\b[^>]*\bhref=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, url, label) => {
    const inner = label.replace(/<[^>]+>/g, '').trim();
    const href = (url || '').trim();
    if (!href) return inner;
    return inner ? `${inner} (${href})` : href;
  });

  // List items: bullet prefix on open, newline on close.
  text = text.replace(/<li\b[^>]*>/gi, '- ');
  text = text.replace(/<\/li\s*>/gi, '\n');

  // Block/line breaks → newlines.
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p\s*>/gi, '\n');
  text = text.replace(/<\/div\s*>/gi, '\n');

  // Strip every remaining tag.
  text = text.replace(/<[^>]+>/g, '');

  // Decode common entities.
  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

  // Collapse 3+ newlines to 2, then trim.
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  return text;
}

export default htmlToText;
