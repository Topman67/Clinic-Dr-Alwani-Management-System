import axios from 'axios';
import { emitDataChanged } from './sync';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api';
const AUTH_KEYS = ['cms_token', 'cms_role', 'cms_username'] as const;

export const api = axios.create({
  baseURL: API_BASE_URL,
});

api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('cms_token') ?? localStorage.getItem('cms_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use((response) => {
  const method = response.config.method?.toLowerCase();
  const url = response.config.url ?? '';
  const isWrite = method === 'post' || method === 'put' || method === 'patch' || method === 'delete';
  const isAuthCall = url.includes('/auth/');

  if (isWrite && !isAuthCall) {
    emitDataChanged();
  }

  return response;
});

api.interceptors.response.use(undefined, (error) => {
  const status = error.response?.status;
  const message = error.response?.data?.message;
  const url = error.config?.url ?? '';
  const isAuthCall = url.includes('/auth/');
  const shouldResetAuth =
    status === 401 &&
    !isAuthCall &&
    (message === 'Invalid token' || message === 'Missing token');

  if (shouldResetAuth && typeof window !== 'undefined') {
    for (const key of AUTH_KEYS) {
      sessionStorage.removeItem(key);
      localStorage.removeItem(key);
    }

    if (window.location.pathname !== '/login') {
      window.location.assign('/login');
    }
  }

  return Promise.reject(error);
});
