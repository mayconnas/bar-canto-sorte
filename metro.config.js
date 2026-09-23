// Configuração do Metro para o PDV Canto da Sorte.
// Adiciona suporte a .wasm (necessário para o expo-sqlite rodar na WEB, via
// wa-sqlite) — permite abrir o app no navegador para testes visuais.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Trata .wasm como asset para que o bundler o resolva/sirva na web.
if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm');
}

// Headers exigidos pelo wa-sqlite (SharedArrayBuffer) no dev server web.
config.server = config.server || {};
const prevEnhance = config.server.enhanceMiddleware;
config.server.enhanceMiddleware = (middleware, server) => {
  const base = prevEnhance ? prevEnhance(middleware, server) : middleware;
  return (req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    return base(req, res, next);
  };
};

module.exports = config;
