import config from './playwright.exact-reptest.config';
const servers = config.webServer as any[];
export default {
  ...config,
  use: {...config.use, baseURL: 'http://127.0.0.1:5178'},
  webServer: servers.map(server => ({
    ...server,
    url: server.url.replace(':5180', ':5178').replace(':8182', ':8196'),
    command: server.command.replace('--port 5180', '--port 5178'),
    env: {...server.env, REPRO_PORT:server.env?.REPRO_PORT === '8182' ? '8196' : server.env?.REPRO_PORT,
      ...(server.env?.REPRO_HERMES_URL ? {REPRO_HERMES_URL:'http://127.0.0.1:8654'} : {}),
      ...(server.env?.REPRO_API_URL ? {REPRO_API_URL:'http://127.0.0.1:8196'} : {})},
  })),
};
