import test from "node:test";
import assert from "node:assert/strict";
import { AtomicQueue } from "../src/index.js";

test("basic enqueue/dequeue", () => {
  const q = new AtomicQueue(8);
  assert.equal(q.isEmpty(), true);
  assert.equal(q.enqueue(1), true);
  assert.equal(q.enqueue(2), true);
  assert.equal(q.size(), 2);
  assert.equal(q.dequeue(), 1);
  assert.equal(q.dequeue(), 2);
  assert.equal(q.dequeue(), undefined);
  assert.equal(q.isEmpty(), true);
});

test("full queue detection", () => {
  const q = new AtomicQueue(4); // capacity will be rounded to 4
  assert.equal(q.enqueue(1), true);
  assert.equal(q.enqueue(2), true);
  assert.equal(q.enqueue(3), true);
  // Next would fill the buffer (tail+1 == head)
  assert.equal(q.isFull(), true);
  assert.equal(q.enqueue(4), false);
});

test("concurrent producers simulated with async loops", async () => {
  const q = new AtomicQueue(64);
  const producers = 4;
  const itemsPer = 1000;
  const promises = [];

  for (let p = 0; p < producers; ++p) {
    promises.push(
      (async () => {
        for (let i = 0; i < itemsPer; ++i) {
          // spin until we can enqueue
          while (!q.enqueue(`p${p}-${i}`)) {
            await new Promise((r) => setImmediate(r));
          }
        }
      })()
    );
  }

  await Promise.all(promises);
  assert.equal(q.size(), producers * itemsPer);
});

test("concurrent consumers simulated with async loops", async () => {
  const q = new AtomicQueue(64);
  const total = 2000;
  for (let i = 0; i < total; ++i) q.enqueue(i);

  const consumers = 3;
  let collected = 0;
  const promises = [];

  for (let c = 0; c < consumers; ++c) {
    promises.push(
      (async () => {
        while (true) {
          const item = q.dequeue();
          if (item === undefined) break;
          collected++;
        }
      })()
    );
  }

  await Promise.all(promises);
  assert.equal(collected, total);
});
