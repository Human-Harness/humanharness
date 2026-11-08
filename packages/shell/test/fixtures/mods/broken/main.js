export default { id: "broken", main(ctx) { ctx.on.beforeSend(() => { throw new Error("broken on purpose"); }); } };
