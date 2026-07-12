export interface ActionTemplateContext {
	dailyPath: string;
	inboxPath: string;
	atomicsPath: string;
	archivePath: string;
	outputPath: string;
	input?: string;
}

export function renderActionTemplate(template: string, context: ActionTemplateContext): string {
	return template
		.replace(/\{\{daily_path\}\}/g, context.dailyPath)
		.replace(/\{\{inbox_path\}\}/g, context.inboxPath)
		.replace(/\{\{atomics_path\}\}/g, context.atomicsPath)
		.replace(/\{\{archive_path\}\}/g, context.archivePath)
		.replace(/\{\{output_path\}\}/g, context.outputPath)
		.replace(/\{\{input\}\}/g, context.input || '');
}
