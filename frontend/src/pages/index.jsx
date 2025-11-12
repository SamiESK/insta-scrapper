import { useState, useEffect } from 'react';
import { accountsAPI, reelsAPI, outreachAPI } from '../api/apiClient';
import AccountCard from '../components/AccountCard';
import StatusBadge from '../components/StatusBadge';

export default function Dashboard() {
  const [accounts, setAccounts] = useState([]);
  const [stats, setStats] = useState({
    totalAccounts: 0,
    runningAccounts: 0,
    totalReels: 0,
    totalOutreach: 0
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [accountsData, reelsData, outreachData] = await Promise.all([
        accountsAPI.getAll(),
        reelsAPI.getAll({ limit: 1 }),
        outreachAPI.getAll({ limit: 1 })
      ]);

      setAccounts(accountsData);
      
      const runningAccounts = accountsData.filter(acc => acc.status === 'running').length;
      setStats({
        totalAccounts: accountsData.length,
        runningAccounts,
        totalReels: reelsData.length,
        totalOutreach: outreachData.length
      });
    } catch (error) {
      console.error('Error loading dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleStart = async (accountId) => {
    try {
      await accountsAPI.start(accountId);
      loadData();
    } catch (error) {
      alert(`Error starting account: ${error.message}`);
    }
  };

  const handleStop = async (accountId) => {
    try {
      await accountsAPI.stop(accountId);
      loadData();
    } catch (error) {
      alert(`Error stopping account: ${error.message}`);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Dashboard</h1>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="text-2xl font-bold text-gray-900">{stats.totalAccounts}</div>
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Total Accounts</dt>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="text-2xl font-bold text-green-600">{stats.runningAccounts}</div>
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Running</dt>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="text-2xl font-bold text-blue-600">{stats.totalReels}</div>
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Reels Collected</dt>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="text-2xl font-bold text-purple-600">{stats.totalOutreach}</div>
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Outreach Sent</dt>
                </dl>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Accounts List */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Accounts</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              onStart={() => handleStart(account.id)}
              onStop={() => handleStop(account.id)}
            />
          ))}
        </div>
        {accounts.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            No accounts yet. Add one to get started.
          </div>
        )}
      </div>
    </div>
  );
}

