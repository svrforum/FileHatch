/**
 * File Operations Fixture for E2E Tests
 *
 * Provides reusable utilities for file and folder operations,
 * including upload, download, create folder, and cleanup.
 */
import { Page, expect } from '@playwright/test';
import { Selectors } from '../helpers/selectors';

export interface FileInfo {
  name: string;
  path?: string;
  content?: string;
  mimeType?: string;
}

export interface FolderInfo {
  name: string;
  path?: string;
}

export class FileFixture {
  private createdFiles: string[] = [];
  private createdFolders: string[] = [];

  constructor(private page: Page) {}

  /**
   * Wait for file list to be ready
   */
  async waitForFileList(): Promise<void> {
    await this.page.goto('/');
    await expect(this.page.locator('.file-list-wrapper')).toBeVisible({ timeout: 10000 });
  }

  /**
   * Create a new folder
   */
  async createFolder(folderName: string): Promise<void> {
    await this.page.locator('.new-folder-btn').click();
    await this.page
      .locator('input[placeholder*="폴더"], input[placeholder*="folder"], input[name="folderName"]')
      .fill(folderName);
    await this.page.locator('button:has-text("생성")').click();
    await expect(this.page.locator(`text=${folderName}`)).toBeVisible({ timeout: 15000 });
    this.createdFolders.push(folderName);
  }

  /**
   * Navigate into a folder
   */
  async navigateToFolder(folderName: string): Promise<void> {
    await this.page.locator(`text=${folderName}`).dblclick();
    await this.page.waitForTimeout(1000);
  }

  /**
   * Navigate to parent folder (go back)
   */
  async navigateToParent(): Promise<void> {
    await this.page.locator('.breadcrumb-home, .breadcrumb >> text=홈').click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Upload a file using the upload button
   */
  async uploadFile(file: FileInfo): Promise<void> {
    const fileName = file.name;
    const content = file.content || 'Test file content';
    const mimeType = file.mimeType || 'text/plain';

    await this.page.locator('.upload-btn').click();
    const fileChooserPromise = this.page.waitForEvent('filechooser');
    await this.page.locator('text=파일 선택').click();
    const fileChooser = await fileChooserPromise;

    await fileChooser.setFiles({
      name: fileName,
      mimeType,
      buffer: Buffer.from(content),
    });
    /*
     * The upload modal closes itself once the transfer finishes. Without
     * waiting for it, the next click lands on .modal-overlay instead of the
     * file row and the context menu never opens.
     */
    await expect(page.locator(Selectors.uploadModal.overlay)).toBeHidden({ timeout: 30000 });

    await expect(this.page.locator('.upload-modal-overlay')).not.toBeVisible({ timeout: 30000 });
    await expect(this.page.locator(`text=${fileName}`)).toBeVisible({ timeout: 30000 });

    this.createdFiles.push(fileName);
  }

  /**
   * Upload multiple files
   */
  async uploadMultipleFiles(files: FileInfo[]): Promise<void> {
    for (const file of files) {
      await this.uploadFile(file);
    }
  }

  /**
   * Upload a file via drag and drop
   */
  async uploadFileDragDrop(file: FileInfo): Promise<void> {
    const fileName = file.name;
    const content = file.content || 'Drag and drop content';

    const dataTransfer = await this.page.evaluateHandle(() => new DataTransfer());

    await this.page.evaluate(
      ({ dt, name, fileContent }) => {
        const f = new File([fileContent], name, { type: 'text/plain' });
        (dt as DataTransfer).items.add(f);
      },
      { dt: dataTransfer, name: fileName, fileContent: content }
    );

    const dropZone = this.page.locator('.file-list-container');
    await dropZone.dispatchEvent('dragenter', { dataTransfer });
    await dropZone.dispatchEvent('drop', { dataTransfer });

    await expect(this.page.locator(`text=${fileName}`)).toBeVisible({ timeout: 30000 });
    this.createdFiles.push(fileName);
  }

  /**
   * Download a file
   */
  async downloadFile(fileName: string): Promise<string> {
    await this.openContextMenu(fileName);
    const downloadPromise = this.page.waitForEvent('download');
    await this.page.locator('.context-menu >> text=다운로드').click();
    const download = await downloadPromise;
    return download.suggestedFilename();
  }

  /**
   * Rename a file
   */
  async renameFile(oldName: string, newName: string): Promise<void> {
    await this.openContextMenu(oldName);
    await this.page.locator('.context-menu >> text=이름 변경').click();
    await this.page.locator('input[value*="' + oldName.split('.')[0] + '"], input[placeholder*="이름"]').fill(newName);
    await this.page.locator('button:has-text("변경")').click();
    await expect(this.page.locator(`.file-list-container >> text=${newName}`)).toBeVisible({ timeout: 5000 });

    const index = this.createdFiles.indexOf(oldName);
    if (index > -1) {
      this.createdFiles[index] = newName;
    }
  }

  /**
   * Delete a file (move to trash)
   */
  async deleteFile(fileName: string): Promise<void> {
    await this.openContextMenu(fileName);
    await this.page.locator('.context-menu >> .context-menu-item.danger').click();
    await this.page.locator(Selectors.confirmModal.confirmBtn).click();
    await expect(this.page.locator(`text=${fileName}`)).not.toBeVisible({ timeout: 5000 });

    const index = this.createdFiles.indexOf(fileName);
    if (index > -1) {
      this.createdFiles.splice(index, 1);
    }
  }

  /**
   * Open context menu for a file
   */
  async openContextMenu(fileName: string): Promise<void> {
    await this.page.locator(`text=${fileName}`).click({ button: 'right' });
    await expect(this.page.locator('.context-menu')).toBeVisible({ timeout: 5000 });
  }

  /**
   * Select a file (click)
   */
  async selectFile(fileName: string): Promise<void> {
    await this.page.locator(`text=${fileName}`).click();
  }

  /**
   * Select multiple files (Ctrl+click)
   */
  async selectMultipleFiles(fileNames: string[]): Promise<void> {
    for (let i = 0; i < fileNames.length; i++) {
      if (i === 0) {
        await this.page.locator(`text=${fileNames[i]}`).click();
      } else {
        await this.page.locator(`text=${fileNames[i]}`).click({ modifiers: ['Control'] });
      }
    }
  }

  /**
   * Check if a file exists in the current view
   */
  async fileExists(fileName: string): Promise<boolean> {
    return await this.page.locator(`text=${fileName}`).isVisible().catch(() => false);
  }

  /**
   * Get file count in current view
   */
  async getFileCount(): Promise<number> {
    const files = await this.page.locator('.file-list-item, .file-row').all();
    return files.length;
  }

  /**
   * Search for files
   */
  async searchFiles(query: string): Promise<void> {
    await this.page.locator('.search-expand-btn').click();
    await this.page
      .locator('input[placeholder*="검색"], input[placeholder*="search"], input[type="search"]')
      .fill(query);
    await this.page.waitForTimeout(500);
  }

  /**
   * Clear search
   */
  async clearSearch(): Promise<void> {
    await this.page.locator('.search-clear-btn').click().catch(() => {
      // Fallback: navigate home
      this.page.goto('/');
    });
  }

  /**
   * Compress files/folders
   */
  async compressFiles(fileNames: string[], archiveName: string): Promise<void> {
    await this.selectMultipleFiles(fileNames);
    await this.page.locator(`text=${fileNames[0]}`).click({ button: 'right' });
    await expect(this.page.locator('.context-menu')).toBeVisible({ timeout: 5000 });
    await this.page.locator('.context-menu >> text=압축').click();

    // Fill archive name if modal appears
    const archiveInput = this.page.locator('input[placeholder*="압축"], input[name="archiveName"]');
    if (await archiveInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await archiveInput.fill(archiveName);
      await this.page.locator('button:has-text("압축"), button:has-text("생성")').click();
    }

    await expect(this.page.locator(`text=${archiveName}`)).toBeVisible({ timeout: 30000 });
    this.createdFiles.push(archiveName);
  }

  /**
   * Extract archive
   */
  async extractArchive(archiveName: string): Promise<void> {
    await this.openContextMenu(archiveName);
    await this.page.locator('.context-menu >> text=압축 해제').click();
    await this.page.waitForTimeout(2000);
  }

  /**
   * Cleanup created files and folders
   */
  async cleanup(): Promise<void> {
    // Try to clean up created files
    for (const file of [...this.createdFiles]) {
      try {
        if (await this.fileExists(file)) {
          await this.deleteFile(file);
        }
      } catch {
        // Ignore cleanup errors
      }
    }

    // Try to clean up created folders
    for (const folder of [...this.createdFolders]) {
      try {
        if (await this.fileExists(folder)) {
          await this.openContextMenu(folder);
          await this.page.locator('.context-menu >> .context-menu-item.danger').click();
          await this.page
            .locator(Selectors.confirmModal.confirmBtn)
            .click()
            .catch(() => {});
        }
      } catch {
        // Ignore cleanup errors
      }
    }

    this.createdFiles = [];
    this.createdFolders = [];
  }
}
