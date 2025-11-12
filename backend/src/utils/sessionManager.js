import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SESSIONS_DIR = join(__dirname, '../../../sessions');

/**
 * Get session path for an account
 */
export function getSessionPath(accountId) {
  const accountDir = join(SESSIONS_DIR, String(accountId));
  if (!existsSync(accountDir)) {
    mkdirSync(accountDir, { recursive: true });
  }
  return join(accountDir, 'auth.json');
}

/**
 * Check if session exists for an account
 */
export function sessionExists(accountId) {
  const sessionPath = getSessionPath(accountId);
  return existsSync(sessionPath);
}

/**
 * Load session for an account
 */
export function loadSession(accountId) {
  const sessionPath = getSessionPath(accountId);
  
  if (!existsSync(sessionPath)) {
    logger.warn(`No session found for account ${accountId}`);
    return null;
  }

  try {
    const sessionData = readFileSync(sessionPath, 'utf-8');
    return JSON.parse(sessionData);
  } catch (error) {
    logger.error(`Error loading session for account ${accountId}:`, error);
    return null;
  }
}

/**
 * Save session for an account
 */
export function saveSession(accountId, sessionData) {
  const sessionPath = getSessionPath(accountId);
  const accountDir = dirname(sessionPath);
  
  if (!existsSync(accountDir)) {
    mkdirSync(accountDir, { recursive: true });
  }

  try {
    writeFileSync(sessionPath, JSON.stringify(sessionData, null, 2), 'utf-8');
    logger.info(`Session saved for account ${accountId}`);
    return true;
  } catch (error) {
    logger.error(`Error saving session for account ${accountId}:`, error);
    return false;
  }
}

/**
 * Delete session for an account
 */
export function deleteSession(accountId) {
  const sessionPath = getSessionPath(accountId);
  
  if (existsSync(sessionPath)) {
    try {
      unlinkSync(sessionPath);
      logger.info(`Session deleted for account ${accountId}`);
      return true;
    } catch (error) {
      logger.error(`Error deleting session for account ${accountId}:`, error);
      return false;
    }
  }
  
  return false;
}

