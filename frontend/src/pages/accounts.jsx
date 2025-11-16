import { useState, useEffect } from 'react';
import { accountsAPI } from '../api/apiClient';
import StatusBadge from '../components/StatusBadge';
import LogsTable from '../components/LogsTable';

export default function Accounts() {
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState({ username: '', password: '', proxy: '' });
  const [editingMessages, setEditingMessages] = useState({});

  useEffect(() => {
    loadAccounts();
  }, []);

  const loadAccounts = async () => {
    try {
      setLoading(true);
      const data = await accountsAPI.getAll();
      console.log('Loaded accounts:', data);
      console.log('First account outreachMessage:', data[0]?.outreachMessage);
      setAccounts(data);
    } catch (error) {
      console.error('Error loading accounts:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      await accountsAPI.create(formData);
      setFormData({ username: '', password: '', proxy: '' });
      setShowAddForm(false);
      loadAccounts();
    } catch (error) {
      alert(`Error creating account: ${error.message}`);
    }
  };

  const handleStart = async (id) => {
    try {
      await accountsAPI.start(id);
      loadAccounts();
    } catch (error) {
      alert(`Error starting account: ${error.message}`);
    }
  };

  const handleStop = async (id) => {
    try {
      await accountsAPI.stop(id);
      loadAccounts();
    } catch (error) {
      alert(`Error stopping account: ${error.message}`);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this account?')) return;
    try {
      await accountsAPI.delete(id);
      loadAccounts();
    } catch (error) {
      alert(`Error deleting account: ${error.message}`);
    }
  };

  const handleMessageChange = (accountId, value) => {
    setEditingMessages({ ...editingMessages, [accountId]: value });
  };

  const handleSaveMessage = async (accountId) => {
    try {
      const message = editingMessages[accountId] || '';
      await accountsAPI.update(accountId, { outreachMessage: message });
      // Clear editing state for this account
      const newEditing = { ...editingMessages };
      delete newEditing[accountId];
      setEditingMessages(newEditing);
      loadAccounts();
    } catch (error) {
      alert(`Error saving message: ${error.message}`);
    }
  };

  if (loading) {
    return <div className="text-center py-12">Loading...</div>;
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Accounts</h1>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
        >
          {showAddForm ? 'Cancel' : 'Add Account'}
        </button>
      </div>

      {showAddForm && (
        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <h2 className="text-xl font-bold mb-4">Add New Account</h2>
          <form onSubmit={handleCreate}>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Username *
              </label>
              <input
                type="text"
                required
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                placeholder="instagram_username"
              />
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Password (optional - leave empty for session-based login)
              </label>
              <input
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                placeholder="Leave empty to use session-based login"
              />
              <p className="text-xs text-gray-500 mt-1">
                If password is provided, bot will auto-login. Otherwise, you'll login manually once.
              </p>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Proxy (optional)
              </label>
              <input
                type="text"
                value={formData.proxy}
                onChange={(e) => setFormData({ ...formData, proxy: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                placeholder="http://proxy:port"
              />
            </div>
            <button
              type="submit"
              className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700"
            >
              Create Account
            </button>
          </form>
        </div>
      )}

      <div className="bg-white shadow overflow-hidden sm:rounded-md">
        <ul className="divide-y divide-gray-200">
          {accounts.map((account) => (
            <li key={account.id} className="px-6 py-4">
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <div className="flex items-center">
                    <h3 className="text-lg font-medium text-gray-900">{account.username}</h3>
                    <StatusBadge status={account.status} className="ml-3" />
                  </div>
                  <div className="mt-2 text-sm text-gray-500">
                    <p>ID: {account.id}</p>
                    {account.proxy && <p>Proxy: {account.proxy}</p>}
                    <p>Last Active: {new Date(account.lastActive).toLocaleString()}</p>
                  </div>
                </div>
                <div className="flex space-x-2 ml-4">
                  {account.status === 'running' ? (
                    <button
                      onClick={() => handleStop(account.id)}
                      className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700"
                    >
                      Stop
                    </button>
                  ) : (
                    <button
                      onClick={() => handleStart(account.id)}
                      className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700"
                    >
                      Start
                    </button>
                  )}
                  <button
                    onClick={() => setSelectedAccount(selectedAccount?.id === account.id ? null : account)}
                    className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
                  >
                    {selectedAccount?.id === account.id ? 'Hide Logs' : 'View Logs'}
                  </button>
                  <button
                    onClick={() => handleDelete(account.id)}
                    className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700"
                  >
                    Delete
                  </button>
                </div>
              </div>
              
              {/* Outreach Message Section */}
              <div className="mt-4 pt-4 border-t border-gray-200">
                <label htmlFor={`message-${account.id}`} className="block text-sm font-medium text-gray-700 mb-2">
                  Outreach Message
                </label>
                <textarea
                  id={`message-${account.id}`}
                  value={editingMessages[account.id] !== undefined ? editingMessages[account.id] : (account.outreachMessage || '')}
                  onChange={(e) => handleMessageChange(account.id, e.target.value)}
                  onBlur={() => {
                    if (editingMessages[account.id] !== undefined) {
                      handleSaveMessage(account.id);
                    }
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md resize-y min-h-[100px] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Enter the message to send to content creators..."
                  rows={4}
                />
                <p className="text-xs text-gray-500 mt-1">
                  This message will be sent to all content creators. Edit and click outside to save.
                </p>
              </div>
              {selectedAccount?.id === account.id && (
                <div className="mt-4">
                  <LogsTable accountId={account.id} />
                </div>
              )}
            </li>
          ))}
        </ul>
        {accounts.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            No accounts found. Add one to get started.
          </div>
        )}
      </div>
    </div>
  );
}

