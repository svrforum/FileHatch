/**
 * API Helper Utilities for E2E Tests
 *
 * Provides direct API access for test setup, cleanup,
 * and scenarios that require backend interaction.
 */
import { APIRequestContext, Page, request } from '@playwright/test';

const API_BASE = process.env.BASE_URL || 'http://localhost:3080';

export interface ApiHelper {
  request: APIRequestContext;
  token: string | null;
}

/**
 * Create an API helper instance
 */
export async function createApiHelper(): Promise<{
  request: APIRequestContext;
  token: string | null;
  dispose: () => Promise<void>;
}> {
  const apiRequest = await request.newContext({
    baseURL: API_BASE,
  });

  return {
    request: apiRequest,
    token: null,
    dispose: async () => {
      await apiRequest.dispose();
    },
  };
}

/**
 * Login and get auth token via API
 */
export async function apiLogin(
  apiRequest: APIRequestContext,
  username: string,
  password: string
): Promise<string> {
  const response = await apiRequest.post('/api/auth/login', {
    data: { username, password },
  });

  if (!response.ok()) {
    throw new Error(`Login failed: ${response.status()}`);
  }

  const data = await response.json();
  return data.token;
}

/**
 * Create a user via API (requires admin token)
 */
export async function apiCreateUser(
  apiRequest: APIRequestContext,
  token: string,
  userData: {
    username: string;
    email?: string;
    password: string;
    isAdmin?: boolean;
  }
): Promise<{ id: number; username: string }> {
  const response = await apiRequest.post('/api/admin/users', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    data: userData,
  });

  if (!response.ok()) {
    throw new Error(`Create user failed: ${response.status()}`);
  }

  return response.json();
}

/**
 * Delete a user via API (requires admin token)
 */
export async function apiDeleteUser(
  apiRequest: APIRequestContext,
  token: string,
  userId: number
): Promise<void> {
  const response = await apiRequest.delete(`/api/admin/users/${userId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok()) {
    throw new Error(`Delete user failed: ${response.status()}`);
  }
}

/**
 * Create a folder via API
 */
export async function apiCreateFolder(
  apiRequest: APIRequestContext,
  token: string,
  folderPath: string
): Promise<void> {
  const response = await apiRequest.post('/api/files/folder', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    data: { path: folderPath },
  });

  if (!response.ok()) {
    throw new Error(`Create folder failed: ${response.status()}`);
  }
}

/**
 * Delete a file or folder via API
 */
export async function apiDeleteFile(
  apiRequest: APIRequestContext,
  token: string,
  filePath: string
): Promise<void> {
  const response = await apiRequest.delete('/api/files', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    data: { path: filePath },
  });

  if (!response.ok()) {
    throw new Error(`Delete file failed: ${response.status()}`);
  }
}

/**
 * Create a share link via API
 */
export async function apiCreateShare(
  apiRequest: APIRequestContext,
  token: string,
  shareData: {
    path: string;
    type?: 'download' | 'upload';
    password?: string;
    expiresAt?: string;
    maxDownloads?: number;
  }
): Promise<{ token: string; url: string }> {
  const response = await apiRequest.post('/api/shares', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    data: shareData,
  });

  if (!response.ok()) {
    throw new Error(`Create share failed: ${response.status()}`);
  }

  return response.json();
}

/**
 * Delete a share via API
 */
export async function apiDeleteShare(
  apiRequest: APIRequestContext,
  token: string,
  shareId: string
): Promise<void> {
  const response = await apiRequest.delete(`/api/shares/${shareId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok()) {
    throw new Error(`Delete share failed: ${response.status()}`);
  }
}

/**
 * Get current user info via API
 */
export async function apiGetCurrentUser(
  apiRequest: APIRequestContext,
  token: string
): Promise<{ id: number; username: string; email: string; isAdmin: boolean }> {
  const response = await apiRequest.get('/api/auth/me', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok()) {
    throw new Error(`Get current user failed: ${response.status()}`);
  }

  return response.json();
}

/**
 * Get storage state (token) from page
 */
export async function getTokenFromPage(page: Page): Promise<string | null> {
  const storageState = await page.context().storageState();
  const authStorage = storageState.origins.find((origin) =>
    origin.localStorage.some((item) => item.name === 'auth-storage')
  );

  if (authStorage) {
    const authItem = authStorage.localStorage.find((item) => item.name === 'auth-storage');
    if (authItem) {
      try {
        const authData = JSON.parse(authItem.value);
        return authData.state?.token || null;
      } catch {
        return null;
      }
    }
  }

  return null;
}

/**
 * Create a shared folder via API (admin)
 */
export async function apiCreateSharedFolder(
  apiRequest: APIRequestContext,
  token: string,
  folderData: {
    name: string;
    description?: string;
  }
): Promise<{ id: number; name: string }> {
  const response = await apiRequest.post('/api/admin/shared-folders', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    data: folderData,
  });

  if (!response.ok()) {
    throw new Error(`Create shared folder failed: ${response.status()}`);
  }

  return response.json();
}

/**
 * Add member to shared folder via API (admin)
 */
export async function apiAddSharedFolderMember(
  apiRequest: APIRequestContext,
  token: string,
  folderId: number,
  memberData: {
    userId: number;
    permission: 'read' | 'write' | 'admin';
  }
): Promise<void> {
  const response = await apiRequest.post(`/api/admin/shared-folders/${folderId}/members`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    data: memberData,
  });

  if (!response.ok()) {
    throw new Error(`Add shared folder member failed: ${response.status()}`);
  }
}

/**
 * Get notifications via API
 */
export async function apiGetNotifications(
  apiRequest: APIRequestContext,
  token: string
): Promise<{ notifications: Array<{ id: number; type: string; read: boolean }> }> {
  const response = await apiRequest.get('/api/notifications', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok()) {
    throw new Error(`Get notifications failed: ${response.status()}`);
  }

  return response.json();
}

/**
 * Mark notification as read via API
 */
export async function apiMarkNotificationRead(
  apiRequest: APIRequestContext,
  token: string,
  notificationId: number
): Promise<void> {
  const response = await apiRequest.patch(`/api/notifications/${notificationId}/read`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok()) {
    throw new Error(`Mark notification read failed: ${response.status()}`);
  }
}

/**
 * Delete all notifications via API
 */
export async function apiClearNotifications(
  apiRequest: APIRequestContext,
  token: string
): Promise<void> {
  const response = await apiRequest.delete('/api/notifications', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok()) {
    throw new Error(`Clear notifications failed: ${response.status()}`);
  }
}

/**
 * Empty trash via API
 */
export async function apiEmptyTrash(
  apiRequest: APIRequestContext,
  token: string
): Promise<void> {
  const response = await apiRequest.delete('/api/trash', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok()) {
    throw new Error(`Empty trash failed: ${response.status()}`);
  }
}

/**
 * Restore file from trash via API
 */
export async function apiRestoreFromTrash(
  apiRequest: APIRequestContext,
  token: string,
  trashItemId: number
): Promise<void> {
  const response = await apiRequest.post(`/api/trash/${trashItemId}/restore`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok()) {
    throw new Error(`Restore from trash failed: ${response.status()}`);
  }
}
