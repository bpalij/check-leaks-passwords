import {
  describe, it, expect, vi,
} from 'vitest';

import {
  handleWorkerError,
  handleWorkerExit,
  type WorkerSettledRef,
} from './workerUtils';

describe('handleWorkerError', () => {
  it('rejects when not settled', () => {
    const ref: WorkerSettledRef = { current: false };
    const terminate = vi.fn().mockResolvedValue(0);
    const reject = vi.fn();
    const err = new Error('crash');

    handleWorkerError(ref, { terminate }, reject, err);

    expect(ref.current).toBe(true);
    expect(terminate).toHaveBeenCalledOnce();
    expect(reject).toHaveBeenCalledWith(err);
  });

  it('does nothing when already settled', () => {
    const ref: WorkerSettledRef = { current: true };
    const terminate = vi.fn();
    const reject = vi.fn();
    const err = new Error('crash');

    handleWorkerError(ref, { terminate }, reject, err);

    expect(ref.current).toBe(true);
    expect(terminate).not.toHaveBeenCalled();
    expect(reject).not.toHaveBeenCalled();
  });

  it('calls onComplete when not settled', () => {
    const ref: WorkerSettledRef = { current: false };
    const terminate = vi.fn().mockResolvedValue(0);
    const reject = vi.fn();
    const onComplete = vi.fn();

    handleWorkerError(ref, { terminate }, reject, new Error('boom'), onComplete);

    expect(onComplete).toHaveBeenCalledOnce();
  });

  it('does not call onComplete when already settled', () => {
    const ref: WorkerSettledRef = { current: true };
    const terminate = vi.fn();
    const reject = vi.fn();
    const onComplete = vi.fn();

    handleWorkerError(ref, { terminate }, reject, new Error('boom'), onComplete);

    expect(onComplete).not.toHaveBeenCalled();
  });
});

describe('handleWorkerExit', () => {
  it('rejects on non-zero exit when not settled', () => {
    const ref: WorkerSettledRef = { current: false };
    const reject = vi.fn();

    handleWorkerExit(ref, reject, 1);

    expect(ref.current).toBe(true);
    expect(reject).toHaveBeenCalledWith(new Error('Worker exited with code 1'));
  });

  it('does nothing when already settled on non-zero exit', () => {
    const ref: WorkerSettledRef = { current: true };
    const reject = vi.fn();

    handleWorkerExit(ref, reject, 1);

    expect(ref.current).toBe(true);
    expect(reject).not.toHaveBeenCalled();
  });

  it('does nothing on zero exit code', () => {
    const ref: WorkerSettledRef = { current: false };
    const reject = vi.fn();

    handleWorkerExit(ref, reject, 0);

    expect(ref.current).toBe(false);
    expect(reject).not.toHaveBeenCalled();
  });

  it('calls onComplete on non-zero exit when not settled', () => {
    const ref: WorkerSettledRef = { current: false };
    const reject = vi.fn();
    const onComplete = vi.fn();

    handleWorkerExit(ref, reject, 1, onComplete);

    expect(onComplete).toHaveBeenCalledOnce();
  });

  it('does not call onComplete when already settled', () => {
    const ref: WorkerSettledRef = { current: true };
    const reject = vi.fn();
    const onComplete = vi.fn();

    handleWorkerExit(ref, reject, 1, onComplete);

    expect(onComplete).not.toHaveBeenCalled();
  });
});
