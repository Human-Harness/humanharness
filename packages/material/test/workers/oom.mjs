// A converter that runs out of heap: the worker dies, the test process must not.
const keep = [];
for (;;) keep.push(new Array(1e5).fill({ n: Math.random() }));
