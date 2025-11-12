import { config } from '../config/env.js';
import { logger } from './logger.js';

let proxyIndex = 0;
const proxies = config.PROXY_LIST || [];

/**
 * Get next proxy in rotation
 */
export function getNextProxy() {
  if (proxies.length === 0) {
    return null;
  }
  
  const proxy = proxies[proxyIndex % proxies.length];
  proxyIndex++;
  
  logger.debug(`Using proxy: ${proxy}`);
  return proxy;
}

/**
 * Get proxy for a specific account (round-robin based on account ID)
 */
export function getProxyForAccount(accountId) {
  if (proxies.length === 0) {
    return null;
  }
  
  const proxy = proxies[accountId % proxies.length];
  return proxy;
}

/**
 * Get all available proxies
 */
export function getAllProxies() {
  return [...proxies];
}

/**
 * Add proxy to the list
 */
export function addProxy(proxyUrl) {
  if (!proxies.includes(proxyUrl)) {
    proxies.push(proxyUrl);
    logger.info(`Added proxy: ${proxyUrl}`);
  }
}

