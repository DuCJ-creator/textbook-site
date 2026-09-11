const escapeHtml = value => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/\"/g, "&quot;")
  .replace(/'/g, "&#039;");

const URL_PATTERN = /https?:\/\/[^\s<>"'，。；：！？、（）【】《》「」『』]+/gi;
const TRAILING_PUNCTUATION = /[),.;:!?\]，。；：！？、）】》」』]+$/;

/** Convert complete http(s) URLs in plain text into safe external links. */
export function linkifyText(value) {
  const text = String(value ?? "");
  let html = "";
  let cursor = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    let url = match[0];
    let trailing = "";
    const punctuation = url.match(TRAILING_PUNCTUATION);
    if (punctuation) {
      trailing = punctuation[0];
      url = url.slice(0, -trailing.length);
    }

    html += escapeHtml(text.slice(cursor, start));
    if (url) {
      html += `<a class="content-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)} <span aria-hidden="true">↗</span></a>`;
    }
    html += escapeHtml(trailing);
    cursor = start + match[0].length;
  }

  return html + escapeHtml(text.slice(cursor));
}
