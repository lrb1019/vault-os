import { App, TFile } from 'obsidian';
import { BatchFileOperationResult, executeSelectedFileOperation } from '../domain/batch-file-operation';
import { buildArchiveTargetPath } from '../domain/vault-file-path';

export interface FileOperationResult {
	status: 'success' | 'failed';
	sourcePath: string;
	targetPath?: string;
	errorMessage?: string;
}

/**
 * The only adapter allowed to perform confirmed Vault file operations.
 */
export class VaultFileOperationService {
	constructor(private readonly app: App) {}

	async trashConfirmedFiles(candidates: readonly TFile[], selectedPaths: readonly string[]): Promise<BatchFileOperationResult> {
		return executeSelectedFileOperation(candidates, selectedPaths, async (candidate) => {
			const currentFile = this.app.vault.getAbstractFileByPath(candidate.path);
			if (!(currentFile instanceof TFile)) {
				throw new Error('文件已不存在或不再是 Markdown 文件');
			}

			await this.app.fileManager.trashFile(currentFile);
		});
	}

	async archiveConfirmedFile(candidate: TFile, archiveFolder: string): Promise<FileOperationResult> {
		let targetPath: string | undefined;
		try {
			targetPath = buildArchiveTargetPath(archiveFolder, candidate.name);
			const currentFile = this.app.vault.getAbstractFileByPath(candidate.path);
			if (!(currentFile instanceof TFile)) throw new Error('源文件已不存在或不再是 Markdown 文件');
			if (this.app.vault.getAbstractFileByPath(targetPath)) throw new Error('归档目标已存在，不会覆盖现有文件');

			const parts = archiveFolder.trim().replace(/^\/+|\/+$/g, '').split('/');
			let currentPath = '';
			for (const part of parts) {
				currentPath = currentPath ? `${currentPath}/${part}` : part;
				if (!this.app.vault.getAbstractFileByPath(currentPath)) await this.app.vault.createFolder(currentPath);
			}

			await this.app.fileManager.renameFile(currentFile, targetPath);
			return { status: 'success', sourcePath: candidate.path, targetPath };
		} catch (error) {
			return {
				status: 'failed',
				sourcePath: candidate.path,
				targetPath,
				errorMessage: error instanceof Error ? error.message : '归档失败'
			};
		}
	}
}
