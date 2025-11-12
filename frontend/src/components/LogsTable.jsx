import { useState, useEffect } from 'react';
import { accountsAPI, logsAPI } from '../api/apiClient';

export default function LogsTable({ accountId }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadLogs();
    // Auto-refresh logs every 2 seconds when bot is running
    const interval = setInterval(loadLogs, 2000);
    return () => clearInterval(interval);
  }, [accountId]);

  const loadLogs = async () => {
    try {
      const logsData = await logsAPI.getByAccount(accountId);
      setLogs(logsData);
      setLoading(false);
    } catch (error) {
      console.error('Error loading logs:', error);
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="text-sm text-gray-500">Loading logs...</div>;
  }

  if (logs.length === 0) {
    return <div className="text-sm text-gray-500">No logs available</div>;
  }

  const getLevelColor = (level) => {
    switch (level) {
      case 'error': return 'text-red-600';
      case 'warn': return 'text-yellow-600';
      case 'info': return 'text-blue-600';
      default: return 'text-gray-600';
    }
  };

  return (
    <div className="bg-gray-50 rounded-lg p-4 max-h-96 overflow-y-auto">
      <div className="flex justify-between items-center mb-2">
        <h4 className="text-sm font-medium text-gray-900">Activity Logs (Auto-refreshing)</h4>
        <button
          onClick={loadLogs}
          className="text-xs text-blue-600 hover:text-blue-800"
        >
          Refresh
        </button>
      </div>
      <div className="space-y-1 font-mono text-xs">
        {logs.length === 0 && !loading && (
          <div className="text-gray-500 italic">No logs yet. Start the bot to see activity.</div>
        )}
        {logs.map((log) => (
          <div key={log.id} className={`${getLevelColor(log.level)} flex items-start gap-2`}>
            <span className="text-gray-400 min-w-[60px]">
              {new Date(log.createdAt).toLocaleTimeString()}
            </span>
            <span className="font-semibold min-w-[50px]">[{log.level.toUpperCase()}]</span>
            <span className="flex-1">{log.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

