// HTML → plain text for ATS description fields.
// Order matters: decode entities BEFORE stripping tags (Greenhouse escapes its HTML,
// `&lt;div&gt;`), and decode `&amp;` last so `&amp;lt;` cannot become a tag.
export function stripHtml(html) {
  return String(html ?? "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
