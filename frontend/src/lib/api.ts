import axios from 'axios';
import { emitDataChanged } from './sync';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api';

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
