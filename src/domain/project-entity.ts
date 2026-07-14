import { matchesScopeRule, type ScopeRule, type VaultFileDescriptor } from './vault-profile.ts';
import { normalizeProjectStatus, type ProjectStatus, type ProjectStatusNormalizationConfig } from './project-status.ts';

export interface ProjectEntityRecognitionConfig {
	entryRule?: ScopeRule;
}

export interface ProjectEntityFile extends VaultFileDescriptor {
	path: string;
}

export interface ProjectEntity {
	path: string;
	status: ProjectStatus;
}

function normalizeValue(value: string): string {
	return value.trim().toLocaleLowerCase();
}

function getStringProperty(file: ProjectEntityFile, key: string): string | undefined {
	const value = file.properties?.[key];
	return typeof value === 'string' ? value : undefined;
}

function isFolderHomepage(path: string): boolean {
	const normalizedPath = path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
	const separatorIndex = normalizedPath.lastIndexOf('/');
	if (separatorIndex <= 0 || !normalizedPath.toLocaleLowerCase().endsWith('.md')) return false;

	const folder = normalizedPath.slice(0, separatorIndex);
	const parentSeparatorIndex = folder.lastIndexOf('/');
	const folderName = folder.slice(parentSeparatorIndex + 1);
	const fileName = normalizedPath.slice(separatorIndex + 1, -3);
	return normalizeValue(folderName) === normalizeValue(fileName);
}

/**
 * Identifies a project entity before any project-status logic runs. A file in
 * the Projects scope is not automatically a project entity.
 */
export function isProjectEntity(
	file: ProjectEntityFile,
	config: ProjectEntityRecognitionConfig = {}
): boolean {
	if (normalizeValue(getStringProperty(file, 'layer') || '') === 'project') return true;
	if (config.entryRule && matchesScopeRule(file, config.entryRule)) return true;
	return isFolderHomepage(file.path);
}

/**
 * The only domain entry point that attaches a normalized status to a Project.
 * Non-entity files deliberately return undefined even when they have status.
 */
export function identifyProjectEntity(
	file: ProjectEntityFile,
	config: ProjectEntityRecognitionConfig = {},
	statusConfig: ProjectStatusNormalizationConfig = {}
): ProjectEntity | undefined {
	if (!isProjectEntity(file, config)) return undefined;
	return {
		path: file.path,
		status: normalizeProjectStatus(file.properties?.status, statusConfig)
	};
}
