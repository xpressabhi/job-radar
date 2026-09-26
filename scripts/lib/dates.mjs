// Shared date normalization: ISO strings, epoch ms, or null.
export function isoDate(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (value === "") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
