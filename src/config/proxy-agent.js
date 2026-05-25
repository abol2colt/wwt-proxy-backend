const { SocksProxyAgent } = require("socks-proxy-agent");
const { env } = require("./env");

const proxyAgent = env.useSocksProxy
  ? new SocksProxyAgent(env.socksProxyUrl)
  : undefined;

function buildProxyAxiosConfig(timeout = 45000) {
  return {
    timeout,
    ...(proxyAgent
      ? {
          httpAgent: proxyAgent,
          httpsAgent: proxyAgent,
          proxy: false,
        }
      : {}),
  };
}

module.exports = {
  proxyAgent,
  buildProxyAxiosConfig,
};
