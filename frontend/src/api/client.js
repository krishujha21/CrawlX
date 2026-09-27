import axios from 'axios';

// In dev: VITE_API_URL=http://localhost:8000
// In prod: empty (nginx proxies /api → backend)
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  headers: {
    'Content-Type': 'application/json',
  },
});

export const startCrawl = async (url, maxPages) => {
  const response = await api.post('/crawl', { url, max_pages: maxPages });
  return response.data;
};

export const getJobStatus = async (jobId) => {
  const response = await api.get(`/job/${jobId}`);
  return response.data;
};

export const stopCrawl = async (jobId) => {
  try {
    const response = await api.post(`/job/${jobId}/stop`);
    return response.data;
  } catch (err) {
    console.warn('Failed to stop crawl job', err);
    return null;
  }
};

export const search = async (query) => {
  const response = await api.get('/search', { params: { q: query } });
  return response.data;
};

export const getStats = async () => {
  const response = await api.get('/stats');
  return response.data;
};

export const resetDatabase = async () => {
  const response = await api.post('/reset');
  return response.data;
};

export default api;
