import express from 'express';
import { getAccounts, getAccount, createAccount, updateAccount, deleteAccount, startAccount, stopAccount } from '../controllers/accountController.js';

const router = express.Router();

// Get all accounts
router.get('/', getAccounts);

// Get account by ID
router.get('/:id', getAccount);

// Create new account
router.post('/', createAccount);

// Update account
router.put('/:id', updateAccount);

// Delete account
router.delete('/:id', deleteAccount);

// Start bot for account
router.post('/:id/start', startAccount);

// Stop bot for account
router.post('/:id/stop', stopAccount);

export default router;

