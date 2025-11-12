/**
 * Display Manager - Assigns virtual displays to accounts
 * Each account gets its own display and VNC port
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from './logger.js';

const execAsync = promisify(exec);

const MAX_DISPLAYS = 100; // Support up to 100 concurrent accounts
const BASE_DISPLAY = 99; // Start from display :99
const BASE_VNC_PORT = 5900; // VNC ports start from 5900

// Track which displays are in use and their processes
const displayUsage = new Map(); // accountId -> { display, vncPort, xvfbPid, vncPid }

/**
 * Get the display number and VNC port for an account
 * @param {number} accountId - The account ID
 * @returns {{display: number, vncPort: number}} Display number and VNC port
 */
function getDisplayForAccount(accountId) {
  // Use account ID modulo MAX_DISPLAYS to assign display
  // This ensures consistent assignment for the same account
  const displayIndex = accountId % MAX_DISPLAYS;
  const display = BASE_DISPLAY + displayIndex;
  const vncPort = BASE_VNC_PORT + displayIndex;
  
  return { display, vncPort };
}

/**
 * Check if a display is already running
 * @param {number} display - Display number
 * @returns {Promise<boolean>} True if display is running
 */
async function isDisplayRunning(display) {
  try {
    await execAsync(`ps aux | grep -E "Xvfb :${display}" | grep -v grep`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a VNC server is already running on a port
 * @param {number} port - VNC port
 * @returns {Promise<boolean>} True if VNC server is running
 */
async function isVncRunning(port) {
  try {
    await execAsync(`netstat -tuln | grep :${port} || ss -tuln | grep :${port}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Start Xvfb for a display
 * @param {number} display - Display number
 * @returns {Promise<number>} Process ID of Xvfb
 */
async function startXvfb(display) {
  const command = `Xvfb :${display} -screen 0 1920x1080x24 -ac +extension GLX +render -noreset`;
  logger.info(`Starting Xvfb for display :${display}`);
  
  const child = exec(command, (error) => {
    if (error) {
      logger.error(`Xvfb error for display :${display}:`, error);
    }
  });
  
  // Wait a bit for Xvfb to start
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  return child.pid;
}

/**
 * Start VNC server for a display
 * @param {number} display - Display number
 * @param {number} port - VNC port
 * @returns {Promise<number>} Process ID of VNC server
 */
async function startVncServer(display, port) {
  // Create VNC password file if it doesn't exist
  const passwordFile = `/root/.vnc/passwd_${display}`;
  try {
    await execAsync(`mkdir -p /root/.vnc`);
    await execAsync(`echo "instagram" | x11vnc -storepasswd ${passwordFile}`);
  } catch (error) {
    logger.warn(`Could not create VNC password file: ${error.message}`);
  }
  
  const command = `x11vnc -display :${display} -forever -shared -rfbport ${port} -passwd instagram -noxdamage -noxfixes -noxrandr -noxcomposite -noxinerama -noxkb -noxrecord -nocursor`;
  logger.info(`Starting VNC server for display :${display} on port ${port}`);
  
  const child = exec(command, (error) => {
    if (error) {
      logger.error(`VNC server error for display :${display}:`, error);
    }
  });
  
  // Wait a bit for VNC server to start
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  return child.pid;
}

/**
 * Initialize display and VNC server for an account
 * @param {number} accountId - The account ID
 * @returns {Promise<{display: number, vncPort: number}>} Display and VNC port
 */
export async function initializeDisplayForAccount(accountId) {
  const { display, vncPort } = getDisplayForAccount(accountId);
  
  // Check if already initialized
  if (displayUsage.has(accountId)) {
    const existing = displayUsage.get(accountId);
    // Verify processes are still running
    const xvfbRunning = await isDisplayRunning(display);
    const vncRunning = await isVncRunning(vncPort);
    
    if (xvfbRunning && vncRunning) {
      logger.info(`Display :${display} and VNC port ${vncPort} already running for account ${accountId}`);
      return { display, vncPort };
    }
  }
  
  // Start Xvfb if not running
  if (!(await isDisplayRunning(display))) {
    const xvfbPid = await startXvfb(display);
    logger.info(`Started Xvfb for display :${display} (PID: ${xvfbPid})`);
  }
  
  // Start VNC server if not running
  if (!(await isVncRunning(vncPort))) {
    const vncPid = await startVncServer(display, vncPort);
    logger.info(`Started VNC server for display :${display} on port ${vncPort} (PID: ${vncPid})`);
  }
  
  // Store in usage map
  displayUsage.set(accountId, { display, vncPort });
  
  return { display, vncPort };
}

/**
 * Get the DISPLAY environment variable string for an account
 * @param {number} accountId - The account ID
 * @returns {string} DISPLAY environment variable (e.g., ":99")
 */
export function getDisplayEnv(accountId) {
  const { display } = getDisplayForAccount(accountId);
  return `:${display}`;
}

/**
 * Get the VNC port for an account
 * @param {number} accountId - The account ID
 * @returns {number} VNC port number
 */
export function getVncPort(accountId) {
  const { vncPort } = getDisplayForAccount(accountId);
  return vncPort;
}

/**
 * Release display when account stops (optional cleanup)
 * Note: We don't kill processes as other accounts might be using the same display
 * @param {number} accountId - The account ID
 */
export function releaseDisplay(accountId) {
  displayUsage.delete(accountId);
  logger.info(`Released display for account ${accountId}`);
}

