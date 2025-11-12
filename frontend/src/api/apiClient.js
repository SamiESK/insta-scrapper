import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json'
  }
});

// Request interceptor
apiClient.interceptors.request.use(
  (config) => {
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor
apiClient.interceptors.response.use(
  (response) => response.data,
  (error) => {
    const message = error.response?.data?.error || error.message || 'An error occurred';
    return Promise.reject(new Error(message));
  }
);

// Accounts API
export const accountsAPI = {
  getAll: () => apiClient.get('/accounts'),
  getById: (id) => apiClient.get(`/accounts/${id}`),
  create: (data) => apiClient.post('/accounts', data),
  update: (id, data) => apiClient.put(`/accounts/${id}`, data),
  delete: (id) => apiClient.delete(`/accounts/${id}`),
  start: (id) => apiClient.post(`/accounts/${id}/start`),
  stop: (id) => apiClient.post(`/accounts/${id}/stop`)
};

// Reels API
export const reelsAPI = {
  getAll: (params) => apiClient.get('/reels', { params }),
  getById: (id) => apiClient.get(`/reels/${id}`),
  getByAccount: (accountId, params) => apiClient.get(`/reels/account/${accountId}`, { params }),
  create: (data) => apiClient.post('/reels', data)
};

// Outreach API
export const outreachAPI = {
  getAll: (params) => apiClient.get('/outreach', { params }),
  getByReel: (reelId) => apiClient.get(`/outreach/reel/${reelId}`),
  create: (data) => apiClient.post('/outreach', data),
  update: (id, data) => apiClient.put(`/outreach/${id}`, data)
};

// Logs API
export const logsAPI = {
  getByAccount: (accountId, params) => apiClient.get(`/logs/${accountId}`, { params })
};

export default apiClient;

