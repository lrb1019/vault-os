import { App } from 'obsidian';
import { type ActionTemplateContext, renderActionTemplate } from '../domain/action-template';

interface ClaudianPlugin {
	activateView(): Promise<void>;
}

interface ObsidianAppWithPlugins {
	plugins?: {
		getPlugin(id: string): unknown;
	};
}

export interface ActionExecutionResult {
	status: 'success' | 'unavailable' | 'failed';
	message: string;
}

/**
 * Isolates the unstable Claudian plugin object and DOM hand-off. The public
 * Vault OS flow only receives a result and never reaches into plugin internals.
 */
export class ClaudianActionService {
	constructor(private readonly app: App) {}

	async execute(template: string, context: ActionTemplateContext): Promise<ActionExecutionResult> {
		const claudianPlugin = (this.app as unknown as ObsidianAppWithPlugins).plugins?.getPlugin('realclaudian') as ClaudianPlugin | null | undefined;
		if (!claudianPlugin || typeof claudianPlugin.activateView !== 'function') {
			return { status: 'unavailable', message: '未检测到 Claudian 插件，请先安装并启用。' };
		}

		try {
			await claudianPlugin.activateView();
			await new Promise<void>(resolve => window.setTimeout(resolve, 300));
			const textarea = activeDocument.querySelector<HTMLTextAreaElement>('.claudian-input-wrapper textarea.claudian-input');
			if (!textarea) {
				return { status: 'failed', message: '无法定位 Claudian 输入框，请确保其窗口已打开。' };
			}

			textarea.value = renderActionTemplate(template, context);
			textarea.dispatchEvent(new Event('input', { bubbles: true }));
			textarea.dispatchEvent(new KeyboardEvent('keydown', {
				key: 'Enter',
				code: 'Enter',
				keyCode: 13,
				which: 13,
				bubbles: true,
				cancelable: true
			}));
			return { status: 'success', message: '智能指令已交给 Claudian。' };
		} catch {
			return { status: 'failed', message: '调用 Claudian 失败，请检查其运行状态后重试。' };
		}
	}
}
