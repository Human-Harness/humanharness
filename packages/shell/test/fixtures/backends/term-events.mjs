// A test backend that answers SIGTERM with events (and stays alive) until it is killed.
process.on("SIGTERM", () => {
  setInterval(() => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method: "bye", params: {} })}\n`), 20);
});
setInterval(() => {}, 1000);
