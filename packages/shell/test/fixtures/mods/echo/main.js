export default {
  id: "echo",
  main(ctx) {
    ctx.on.beforeSend((s) => (s.text === "ping" ? { kind: "rewrite", text: (ctx.config && ctx.config.word) || "pong" } : { kind: "pass" }));
    ctx.on.turnEnd((e) => ctx.log("turn ended", e.task.id));
    ctx.ipc("hello", (p) => ({ hello: p }));
  },
};
