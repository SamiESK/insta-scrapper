import express from 'express';
import { getReels, getReel, getReelsByAccount, createReel } from '../controllers/reelController.js';

const router = express.Router();

// Get all reels
router.get('/', getReels);

// Get reel by ID
router.get('/:id', getReel);

// Get reels by account ID
router.get('/account/:accountId', getReelsByAccount);

// Create new reel
router.post('/', createReel);

export default router;

