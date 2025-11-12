export default function StatusBadge({ status, className = '' }) {
  const statusColors = {
    idle: 'bg-gray-100 text-gray-800',
    running: 'bg-green-100 text-green-800',
    paused: 'bg-yellow-100 text-yellow-800',
    error: 'bg-red-100 text-red-800',
    stopped: 'bg-gray-100 text-gray-800'
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColors[status] || statusColors.idle} ${className}`}>
      {status || 'idle'}
    </span>
  );
}

