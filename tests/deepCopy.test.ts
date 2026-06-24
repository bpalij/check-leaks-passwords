import deepCopy from '../src/helpers/deepCopy';

describe('deepCopy', () => {
  it('copies a plain object', () => {
    const obj = { a: 1, b: 'hello' };
    const copy = deepCopy(obj);
    expect(copy).toEqual(obj);
    expect(copy).not.toBe(obj);
  });

  it('copies nested objects', () => {
    const obj = { a: { b: { c: 3 } } };
    const copy = deepCopy(obj);
    expect(copy).toEqual(obj);
    (copy as Record<string, unknown>).a = { b: { c: 4 } };
    expect((obj.a as Record<string, Record<string, number>>).b.c).toBe(3);
  });

  it('copies arrays', () => {
    const arr = [1, [2, 3], { a: 4 }];
    const copy = deepCopy(arr);
    expect(copy).toEqual(arr);
    expect(copy).not.toBe(arr);
  });

  it('loses undefined properties (JSON limitation)', () => {
    const obj = { a: 1, b: undefined };
    const copy = deepCopy(obj);
    expect(copy).toEqual({ a: 1 });
    expect('b' in copy).toBe(false);
  });

  it('copies null properties', () => {
    const obj = { a: null };
    const copy = deepCopy(obj);
    expect(copy).toEqual({ a: null });
  });
});
