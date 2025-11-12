import { useState, useEffect } from 'react';
import { reelsAPI, outreachAPI } from '../api/apiClient';

export default function Analytics() {
  const [reels, setReels] = useState([]);
  const [outreach, setOutreach] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalReels: 0,
    highViewReels: 0,
    totalOutreach: 0,
    sentOutreach: 0
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [reelsData, outreachData] = await Promise.all([
        reelsAPI.getAll({ limit: 100 }),
        outreachAPI.getAll({ limit: 100 })
      ]);

      setReels(reelsData);
      setOutreach(outreachData);

      const highViewReels = reelsData.filter(r => r.views >= 100000).length;
      const sentOutreach = outreachData.filter(o => o.sent).length;

      setStats({
        totalReels: reelsData.length,
        highViewReels,
        totalOutreach: outreachData.length,
        sentOutreach
      });
    } catch (error) {
      console.error('Error loading analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="text-center py-12">Loading...</div>;
  }

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Analytics</h1>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        <div className="bg-white overflow-hidden shadow rounded-lg p-5">
          <div className="text-2xl font-bold text-gray-900">{stats.totalReels}</div>
          <div className="text-sm text-gray-500">Total Reels</div>
        </div>
        <div className="bg-white overflow-hidden shadow rounded-lg p-5">
          <div className="text-2xl font-bold text-blue-600">{stats.highViewReels}</div>
          <div className="text-sm text-gray-500">Reels &gt;100k Views</div>
        </div>
        <div className="bg-white overflow-hidden shadow rounded-lg p-5">
          <div className="text-2xl font-bold text-purple-600">{stats.totalOutreach}</div>
          <div className="text-sm text-gray-500">Total Outreach</div>
        </div>
        <div className="bg-white overflow-hidden shadow rounded-lg p-5">
          <div className="text-2xl font-bold text-green-600">{stats.sentOutreach}</div>
          <div className="text-sm text-gray-500">Sent Outreach</div>
        </div>
      </div>

      {/* Recent Reels */}
      <div className="bg-white shadow rounded-lg mb-6">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-bold">Recent Reels</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">URL</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Views</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Is Ad</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Is Live</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Processed</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {reels.slice(0, 20).map((reel) => (
                <tr key={reel.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <a href={reel.reelUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                      {reel.reelUrl.substring(0, 50)}...
                    </a>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">{reel.views.toLocaleString()}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">{reel.isAd ? 'Yes' : 'No'}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">{reel.isLive ? 'Yes' : 'No'}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">{new Date(reel.processedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Outreach */}
      <div className="bg-white shadow rounded-lg">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-bold">Recent Outreach</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Target User</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Message</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Sent At</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {outreach.slice(0, 20).map((item) => (
                <tr key={item.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">{item.targetUser}</td>
                  <td className="px-6 py-4 text-sm">{item.message.substring(0, 50)}...</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    {item.sent ? (
                      <span className="text-green-600">Sent</span>
                    ) : (
                      <span className="text-yellow-600">Pending</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    {item.sentAt ? new Date(item.sentAt).toLocaleString() : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

