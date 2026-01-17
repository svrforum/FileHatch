/**
 * API Client - Centralized HTTP request handling
 *
 * Provides consistent error handling, authentication, and type safety
 * for all API calls.
 */

const API_BASE = '/api'

/**
 * API Error class with status code and optional details
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: unknown
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * Get the authentication token from localStorage
 */
export function getAuthToken(): string | null {
  const stored = localStorage.getItem('filehatch-auth')
  if (stored) {
    try {
      const { state } = JSON.parse(stored)
      return state?.token || null
    } catch {
      return null
    }
  }
  return null
}

/**
 * Get authorization headers
 */
export function getAuthHeaders(): HeadersInit {
  const token = getAuthToken()
  if (token) {
    return { Authorization: `Bearer ${token}` }
  }
  return {}
}

/**
 * Standard API response format
 */
export interface ApiResponse<T> {
  data: T
  success: boolean
}

/**
 * Standard API error response format
 */
export interface ApiErrorResponse {
  code: string
  error: string
  details?: unknown
}

/**
 * Request options for API client
 */
interface RequestOptions {
  /** Skip authentication header */
  noAuth?: boolean
  /** Custom headers */
  headers?: HeadersInit
  /** Request timeout in milliseconds */
  timeout?: number
  /** Abort signal */
  signal?: AbortSignal
}

/**
 * Parse error response from API
 */
async function parseErrorResponse(response: Response): Promise<ApiError> {
  try {
    const data = await response.json() as ApiErrorResponse
    return new ApiError(
      data.error || `Request failed with status ${response.status}`,
      response.status,
      data.code,
      data.details
    )
  } catch {
    return new ApiError(
      `Request failed with status ${response.status}`,
      response.status
    )
  }
}

/**
 * Core request function
 */
async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options: RequestOptions = {}
): Promise<T> {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`

  const headers: Record<string, string> = {
    ...((!options.noAuth ? getAuthHeaders() : {}) as Record<string, string>),
    ...((options.headers || {}) as Record<string, string>),
  }

  // Add Content-Type for JSON body
  if (body !== undefined && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
  }

  const fetchOptions: RequestInit = {
    method,
    headers,
    signal: options.signal,
  }

  if (body !== undefined) {
    fetchOptions.body = body instanceof FormData ? body : JSON.stringify(body)
  }

  // Create timeout if specified
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  if (options.timeout && !options.signal) {
    const controller = new AbortController()
    fetchOptions.signal = controller.signal
    timeoutId = setTimeout(() => controller.abort(), options.timeout)
  }

  try {
    const response = await fetch(url, fetchOptions)

    if (!response.ok) {
      throw await parseErrorResponse(response)
    }

    // Check if response has content
    const contentType = response.headers.get('content-type')
    if (contentType?.includes('application/json')) {
      return response.json()
    }

    // For non-JSON responses, return empty object
    // The caller should handle this appropriately
    return {} as T
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

/**
 * API Client singleton
 */
export const api = {
  /**
   * GET request
   */
  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return request<T>('GET', path, undefined, options)
  },

  /**
   * POST request
   */
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return request<T>('POST', path, body, options)
  },

  /**
   * PUT request
   */
  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return request<T>('PUT', path, body, options)
  },

  /**
   * DELETE request
   */
  delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return request<T>('DELETE', path, undefined, options)
  },

  /**
   * PATCH request
   */
  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return request<T>('PATCH', path, body, options)
  },
}

/**
 * URL helper functions
 */
export const apiUrl = {
  /**
   * Build URL with query parameters
   */
  withParams(path: string, params: Record<string, string | number | boolean | undefined>): string {
    const searchParams = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        searchParams.set(key, String(value))
      }
    }
    const queryString = searchParams.toString()
    return queryString ? `${path}?${queryString}` : path
  },

  /**
   * Encode path segments for file paths
   * e.g., "/home/admin/test file.txt" -> "home/admin/test%20file.txt"
   */
  encodePath(path: string): string {
    const cleanPath = path.startsWith('/') ? path.slice(1) : path
    return cleanPath
      .split('/')
      .map(segment => encodeURIComponent(segment))
      .join('/')
  },

  /**
   * Get full API URL for a file path
   */
  filePath(path: string): string {
    return `${API_BASE}/files/${apiUrl.encodePath(path)}`
  },
}
