import axios from 'axios'

/** 默认请求超时（一般接口） */
export const DEFAULT_REQUEST_TIMEOUT = 120000

/** 智能搜片、润色延伸知识点等长耗时操作 */
export const LONG_REQUEST_TIMEOUT = 300000

const api = axios.create({
  baseURL: '/api',
  timeout: DEFAULT_REQUEST_TIMEOUT,
  withCredentials: true,
})

api.interceptors.response.use(
  (res) => {
    const data = res.data
    if (data && typeof data.code === 'number' && data.code !== 0) {
      return Promise.reject(new Error(data.message || '请求失败'))
    }
    return res
  },
  (err) => Promise.reject(err),
)

export default api

export function unwrap<T>(res: { data: { data: T } }): T {
  return res.data.data
}
