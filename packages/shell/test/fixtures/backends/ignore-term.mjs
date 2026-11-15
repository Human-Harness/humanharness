// A test backend that ignores SIGTERM and stays alive. It prints "ready" on stderr once the handler is installed.
process.on("SIGTERM", () => {});
setInterval(() => {}, 1000);
process.stderr.write("ready\n");
