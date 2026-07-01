export default function buildFingerprintSet(strings: string[]): Set<number> {
  const set = new Set<number>();
  strings.forEach((s) => {
    const buf = Buffer.from(s.slice(0, 4), 'ascii');
    set.add(buf.readUInt32BE(0));
  });
  return set;
}
