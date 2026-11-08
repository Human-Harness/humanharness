export default { id: "slow", main(ctx) { ctx.on.beforeSend(() => new Promise(() => {})); } };
