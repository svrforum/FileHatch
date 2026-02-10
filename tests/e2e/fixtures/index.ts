/**
 * FileHatch E2E Test Fixtures
 *
 * Custom test fixtures that extend Playwright's base test with
 * reusable utilities for authentication, file operations, and sharing.
 */
import { test as base } from '@playwright/test';
import { AuthFixture } from './auth.fixture';
import { FileFixture } from './file.fixture';
import { ShareFixture } from './share.fixture';

/**
 * Extended test type with custom fixtures
 */
export const test = base.extend<{
  authFixture: AuthFixture;
  fileFixture: FileFixture;
  shareFixture: ShareFixture;
}>({
  authFixture: async ({ page }, use) => {
    const fixture = new AuthFixture(page);
    await use(fixture);
  },
  fileFixture: async ({ page }, use) => {
    const fixture = new FileFixture(page);
    await use(fixture);
    await fixture.cleanup();
  },
  shareFixture: async ({ page }, use) => {
    const fixture = new ShareFixture(page);
    await use(fixture);
    await fixture.cleanup();
  },
});

export { expect } from '@playwright/test';
export { AuthFixture } from './auth.fixture';
export { FileFixture } from './file.fixture';
export { ShareFixture } from './share.fixture';
