/**
 * Test Data Utilities for E2E Tests
 *
 * Provides functions for generating unique test data
 * and predefined test values.
 */

/**
 * Generate a unique name with timestamp and random suffix
 */
export function generateUniqueName(prefix: string): string {
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substring(2, 7);
  return `${prefix}-${timestamp}-${randomSuffix}`;
}

/**
 * Generate a unique file name
 */
export function generateFileName(prefix: string = 'test-file', extension: string = 'txt'): string {
  return `${generateUniqueName(prefix)}.${extension}`;
}

/**
 * Generate a unique folder name
 */
export function generateFolderName(prefix: string = 'test-folder'): string {
  return generateUniqueName(prefix);
}

/**
 * Generate a unique username
 */
export function generateUsername(prefix: string = 'testuser'): string {
  const name = generateUniqueName(prefix);
  // Keep username short (max 20 chars) and valid
  return name.slice(0, 20).replace(/-/g, '_');
}

/**
 * Generate a unique email
 */
export function generateEmail(prefix: string = 'test'): string {
  const unique = generateUniqueName(prefix);
  return `${unique}@test.com`.slice(0, 50);
}

/**
 * Default test users
 */
export const TestUsers = {
  admin: {
    username: process.env.TEST_ADMIN || 'admin',
    password: process.env.TEST_ADMIN_PASSWORD || 'admin1234',
    isAdmin: true,
  },
  user: {
    username: process.env.TEST_USER || 'admin',
    password: process.env.TEST_PASSWORD || 'admin1234',
    isAdmin: false,
  },
  user2fa: {
    username: process.env.TEST_2FA_USER || 'user2fa',
    password: process.env.TEST_2FA_PASSWORD || 'password123',
    has2FA: true,
  },
} as const;

/**
 * Default test file content
 */
export const TestFileContent = {
  small: 'Small test file content',
  medium: 'Medium test file content.\n'.repeat(100),
  large: 'Large test file content.\n'.repeat(10000),
  binary: Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]),
  json: JSON.stringify({ key: 'value', number: 123, array: [1, 2, 3] }),
  html: '<!DOCTYPE html><html><body><h1>Test</h1></body></html>',
} as const;

/**
 * MIME types for test files
 */
export const MimeTypes = {
  text: 'text/plain',
  html: 'text/html',
  json: 'application/json',
  pdf: 'application/pdf',
  zip: 'application/zip',
  image: 'image/png',
  video: 'video/mp4',
  audio: 'audio/mp3',
} as const;

/**
 * Generate a test file object for upload
 */
export function generateTestFile(
  options: {
    name?: string;
    content?: string;
    mimeType?: string;
    extension?: string;
  } = {}
): { name: string; content: string; mimeType: string; buffer: Buffer } {
  const extension = options.extension || 'txt';
  const name = options.name || generateFileName('test-file', extension);
  const content = options.content || TestFileContent.small;
  const mimeType = options.mimeType || MimeTypes.text;

  return {
    name,
    content,
    mimeType,
    buffer: Buffer.from(content),
  };
}

/**
 * Generate multiple test files
 */
export function generateTestFiles(
  count: number,
  prefix: string = 'multi-test'
): { name: string; content: string; mimeType: string; buffer: Buffer }[] {
  return Array.from({ length: count }, (_, i) =>
    generateTestFile({
      name: `${generateUniqueName(prefix)}-${i + 1}.txt`,
      content: `Test file ${i + 1} content`,
    })
  );
}

/**
 * Test share tokens (from environment, for pre-configured test scenarios)
 */
export const TestShareTokens = {
  public: process.env.TEST_SHARE_TOKEN || null,
  protected: process.env.TEST_PROTECTED_SHARE_TOKEN || null,
  expired: process.env.TEST_EXPIRED_SHARE_TOKEN || null,
  upload: process.env.TEST_UPLOAD_SHARE_TOKEN || null,
} as const;

/**
 * Common test passwords
 */
export const TestPasswords = {
  valid: 'ValidPass123!',
  weak: '123456',
  strong: 'VeryStr0ng!P@ssw0rd#2024',
  share: 'sharepassword123',
  newPassword: 'NewPassword123!',
} as const;

/**
 * Storage quota values for testing
 */
export const StorageQuotas = {
  oneGB: 1073741824, // 1 GB in bytes
  tenGB: 10737418240, // 10 GB in bytes
  hundredGB: 107374182400, // 100 GB in bytes
  unlimited: 0, // 0 means unlimited
} as const;

/**
 * Time constants for tests
 */
export const TimeConstants = {
  shortWait: 500,
  mediumWait: 1000,
  longWait: 2000,
  uploadTimeout: 30000,
  pageLoadTimeout: 10000,
  animationTimeout: 300,
} as const;

/**
 * Date utilities for testing
 */
export const DateUtils = {
  today: (): string => new Date().toISOString().split('T')[0],
  tomorrow: (): string => {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    return date.toISOString().split('T')[0];
  },
  weekAgo: (): string => {
    const date = new Date();
    date.setDate(date.getDate() - 7);
    return date.toISOString().split('T')[0];
  },
  monthAgo: (): string => {
    const date = new Date();
    date.setMonth(date.getMonth() - 1);
    return date.toISOString().split('T')[0];
  },
} as const;

/**
 * Tags for test categorization
 */
export const TestTags = {
  smoke: '@smoke',
  critical: '@critical',
  regression: '@regression',
  slow: '@slow',
  flaky: '@flaky',
  admin: '@admin',
  auth: '@auth',
  files: '@files',
  sharing: '@sharing',
} as const;
