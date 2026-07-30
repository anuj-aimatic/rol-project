import axios from 'axios'

import { APP_CONFIG } from '@/config/app-config'

export const apiClient = axios.create({
  baseURL: APP_CONFIG.apiBaseUrl,
  timeout: 180000,
})
