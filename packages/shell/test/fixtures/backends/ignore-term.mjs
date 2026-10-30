// A test backend that ignores SIGTERM and stays alive.
process.on("SIGTERM", () => {});
setInterval(() => {}, 1000);
