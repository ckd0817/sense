export function toLocalISO(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * Snap an ISO time string to the nearest granularity boundary.
 * - 'floor': round down (for start_time)
 * - 'ceil': round up (for end_time)
 */
export function snapTime(iso: string, granularity: number, direction: 'floor' | 'ceil'): string {
  const d = new Date(iso);
  const totalMinutes = d.getHours() * 60 + d.getMinutes();
  const snapped = direction === 'floor'
    ? Math.floor(totalMinutes / granularity) * granularity
    : Math.ceil(totalMinutes / granularity) * granularity;

  const hours = Math.floor(snapped / 60);
  const minutes = snapped % 60;

  const result = new Date(d);
  result.setHours(hours, minutes, 0, 0);
  return toLocalISO(result);
}
