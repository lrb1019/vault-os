function normalizeFolder(folderPath: string): string {
	const normalized = folderPath.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
	if (normalized === '') throw new Error('未配置目标文件夹');
	if (normalized.split('/').some(segment => segment === '.' || segment === '..' || segment === '')) {
		throw new Error('目标文件夹路径无效');
	}
	return normalized;
}

export function buildVaultFilePath(folderPath: string, fileNameInput: string): string {
	const folder = normalizeFolder(folderPath);
	const fileName = fileNameInput.trim();
	if (fileName === '' || fileName.includes('/') || fileName.includes('\\')) {
		throw new Error('源文件名无效');
	}
	return `${folder}/${fileName}`;
}

export function buildArchiveTargetPath(archiveFolder: string, sourceFileName: string): string {
	return buildVaultFilePath(archiveFolder, sourceFileName);
}
