import StatusBadge from './StatusBadge';

export default function AccountCard({ account, onStart, onStop }) {
  return (
    <div className="bg-white overflow-hidden shadow rounded-lg">
      <div className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-medium text-gray-900">{account.username}</h3>
            <StatusBadge status={account.status} className="mt-2" />
          </div>
        </div>
        <div className="mt-4 text-sm text-gray-500">
          <p>ID: {account.id}</p>
          {account.proxy && <p>Proxy: {account.proxy}</p>}
          <p>Last Active: {new Date(account.lastActive).toLocaleString()}</p>
        </div>
        <div className="mt-4 flex space-x-2">
          {account.status === 'running' ? (
            <button
              onClick={onStop}
              className="flex-1 bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 text-sm"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={onStart}
              className="flex-1 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 text-sm"
            >
              Start
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

