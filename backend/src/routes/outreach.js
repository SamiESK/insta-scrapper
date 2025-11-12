import express from 'express';
import { getOutreach, getOutreachByReel, createOutreach, updateOutreach } from '../controllers/outreachController.js';

const router = express.Router();

// Get all outreach
router.get('/', getOutreach);

// Get outreach by reel ID
router.get('/reel/:reelId', getOutreachByReel);

// Create new outreach
router.post('/', createOutreach);

// Update outreach (mark as sent)
router.put('/:id', updateOutreach);

export default router;

