import estimatedTimeRemaining from '../src/helpers/estimatedTimeRemaining';

describe('estimatedTimeRemaining', () => {
  it('returns undefined when processed is 0', () => {
    expect(estimatedTimeRemaining(0, 100, 1000)).toBeUndefined();
  });

  it('returns undefined when elapsedMs is 0', () => {
    expect(estimatedTimeRemaining(50, 100, 0)).toBeUndefined();
  });

  it('returns undefined when total is 0', () => {
    expect(estimatedTimeRemaining(50, 0, 1000)).toBeUndefined();
  });

  it('returns undefined when processed >= total', () => {
    expect(estimatedTimeRemaining(100, 100, 1000)).toBeUndefined();
    expect(estimatedTimeRemaining(101, 100, 1000)).toBeUndefined();
  });

  it('returns the correct remaining time string', () => {
    expect(estimatedTimeRemaining(50, 100, 1000)).toBe('1sec 0ms');
    expect(estimatedTimeRemaining(25, 100, 1000)).toBe('3sec 0ms');
    expect(estimatedTimeRemaining(75, 100, 3000)).toBe('1sec 0ms');
  });

  it('returns undefined when remaining rounds to 0', () => {
    expect(estimatedTimeRemaining(999, 1000, 1)).toBeUndefined();
  });
});
