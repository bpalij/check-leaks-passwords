const UNITS = ['KB', 'MB', 'GB', 'TB'];

export default function beautifullyPrintBytes(bytes: number): string {
  let idx = 0;
  let val = bytes;
  while (val >= 1024 && idx < UNITS.length - 1) {
    val /= 1024;
    idx += 1;
  }
  if (idx === 0) return `${val} ${val === 1 ? 'byte' : 'bytes'}`;
  return `${val.toFixed(2).replace(/\.?0+$/, '')} ${UNITS[idx - 1]}`;
}
