import { App } from 'obsidian';
import { buildVaultFilePath } from '../domain/vault-file-path';

export interface HealthReportWriteResult {
	status: 'success' | 'failed';
	filePath?: string;
	errorMessage?: string;
}

/** The only adapter that creates Vault OS health report files. */
export class VaultHealthReportService {
	constructor(private readonly app: App) {}

	async createReport(outputFolder: string, fileName: string, content: string): Promise<HealthReportWriteResult> {
		let filePath: string | undefined;
		try {
			filePath = buildVaultFilePath(outputFolder, fileName);
			if (this.app.vault.getAbstractFileByPath(filePath)) {
				throw new Error('同名巡检报告已存在，不会覆盖现有文件');
			}

			const parts = outputFolder.trim().replace(/^\/+|\/+$/g, '').split('/');
			let currentPath = '';
			for (const part of parts) {
				currentPath = currentPath ? `${currentPath}/${part}` : part;
				if (!this.app.vault.getAbstractFileByPath(currentPath)) await this.app.vault.createFolder(currentPath);
			}

			await this.app.vault.create(filePath, content);
			return { status: 'success', filePath };
		} catch (error) {
			return {
				status: 'failed',
				filePath,
				errorMessage: error instanceof Error ? error.message : '创建巡检报告失败'
			};
		}
	}
}
