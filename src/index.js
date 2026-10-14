/**
 * @fileoverview Lock‑free ring buffer queue built on SharedArrayBuffer + Atomics.
 * @module atomic-queue
 */

/**
 * @typedef {any} QueueItem
 */

/**
 * A lock‑free multi‑producer / multi‑consumer queue.
 *
 * The queue stores items in a regular JavaScript array while the head/tail
 * pointers live inside a SharedArrayBuffer so they can be atomically updated
 * across worker threads.
 *
 * @example
 * import { AtomicQueue } from "./index.js";
 *
 * const q = new AtomicQueue(1024);
 * q.enqueue("hello");
 * console.log(q.dequeue()); // "hello"
 */
export class AtomicQueue {
  /**
   * @param {number} capacity Must be a power of two.
   */
  constructor(capacity) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new TypeError("capacity must be a positive integer");
    }
    // Round up to next power‑of‑two for mask simplicity.
    this._capacity = 1 << Math.ceil(Math.log2(capacity));
    this._mask = this._capacity - 1;

    // Shared buffer holds two Int32 values: head and tail.
    this._sab = new SharedArrayBuffer(8);
    this._indices = new Int32Array(this._sab);
    // indices[0] = head, indices[1] = tail
    this._headIdx = 0;
    this._tailIdx = 1;

    // Storage for actual items – not shared, but each worker holds its own view.
    this._buffer = new Array(this._capacity);
  }

  /** @private */
  _loadHead() {
    return Atomics.load(this._indices, this._headIdx);
  }

  /** @private */
  _loadTail() {
    return Atomics.load(this._indices, this._tailIdx);
  }

  /**
   * Enqueue an item.
   *
   * @param {QueueItem} item
   * @returns {boolean} true if the item was enqueued, false if the queue is full.
   */
  enqueue(item) {
    while (true) {
      const tail = this._loadTail();
      const head = this._loadHead();
      const nextTail = (tail + 1) & this._mask;

      if (nextTail === head) {
        // Full
        return false;
      }

      // Try to claim the slot.
      const observed = Atomics.compareExchange(
        this._indices,
        this._tailIdx,
        tail,
        nextTail
      );

      if (observed === tail) {
        // Success – store the item.
        this._buffer[tail] = item;
        // Ensure the store happens after the index update.
        Atomics.store(this._indices, this._tailIdx, nextTail);
        return true;
      }
      // else: another producer beat us; retry.
    }
  }

  /**
   * Dequeue an item.
   *
   * @returns {QueueItem|undefined} The dequeued item or undefined if empty.
   */
  dequeue() {
    while (true) {
      const head = this._loadHead();
      const tail = this._loadTail();

      if (head === tail) {
        // Empty
        return undefined;
      }

      const nextHead = (head + 1) & this._mask;

      const observed = Atomics.compareExchange(
        this._indices,
        this._headIdx,
        head,
        nextHead
      );

      if (observed === head) {
        const item = this._buffer[head];
        this._buffer[head] = undefined; // help GC
        // Ensure the slot is cleared before moving head.
        Atomics.store(this._indices, this._headIdx, nextHead);
        return item;
      }
      // else: another consumer beat us; retry.
    }
  }

  /** @returns {number} Current number of items in the queue. */
  size() {
    const head = this._loadHead();
    const tail = this._loadTail();
    return (tail - head + this._capacity) & this._mask;
  }

  /** @returns {boolean} */
  isEmpty() {
    return this._loadHead() === this._loadTail();
  }

  /** @returns {boolean} */
  isFull() {
    const tail = this._loadTail();
    const head = this._loadHead();
    return ((tail + 1) & this._mask) === head;
  }

  /** @returns {SharedArrayBuffer} The underlying buffer for cross‑thread sharing. */
  get sharedBuffer() {
    return this._sab;
  }
}

/**
 * Re‑create a queue from an existing SharedArrayBuffer.
 *
 * @param {SharedArrayBuffer} sab Must be exactly 8 bytes.
 * @param {number} capacity Must match the original capacity (power of two).
 * @returns {AtomicQueue}
 */
export function fromShared(sab, capacity) {
  if (!(sab instanceof SharedArrayBuffer) || sab.byteLength !== 8) {
    throw new TypeError("Invalid SharedArrayBuffer");
  }
  const q = Object.create(AtomicQueue.prototype);
  q._capacity = 1 << Math.ceil(Math.log2(capacity));
  q._mask = q._capacity - 1;
  q._sab = sab;
  q._indices = new Int32Array(sab);
  q._headIdx = 0;
  q._tailIdx = 1;
  q._buffer = new Array(q._capacity);
  return q;
}
