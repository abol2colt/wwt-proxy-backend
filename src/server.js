const { env } = require("./config/env");
const { createApp } = require("./app");

const app = createApp();

app.listen(env.port, env.host, () => {
  console.log(`Proxy up on http://${env.host}:${env.port}`);
  console.log(`CORS origin: ${env.corsOrigin}`);
});
