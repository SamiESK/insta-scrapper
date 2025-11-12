import express from 'express';
import { getLogs } from '../controllers/logController.js';

const router = express.Router();

// Get logs for an account
router.get('/:accountId', getLogs);

export default router;

