export default function beautifullyPrintCompact(n: number): string {
  let val: number;
  let suffix: string;
  if (n >= 1_000_000_000) {
    val = n / 1_000_000_000;
    suffix = 'B';
  } else if (n >= 1_000_000) {
    val = n / 1_000_000;
    suffix = 'M';
  } else if (n >= 1_000) {
    val = n / 1_000;
    suffix = 'K';
  } else {
    return `${n}`;
  }
  return `${val.toFixed(2).replace(/\.?0+$/, '')} ${suffix}`;
}
