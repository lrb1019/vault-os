import { moment } from 'obsidian';
import { type PeriodicCycle, type PeriodicNoteTarget, type PeriodicPathProvider, resolvePeriodicNoteTarget } from '../domain/periodic-note';

export interface NotebookNavigatorPeriodicConfig {
	rootFolder: string;
	patterns: Record<PeriodicCycle, string>;
}

/** Isolates Notebook Navigator's configuration from the rest of the diary workflow. */
export class NotebookNavigatorPeriodicPathProvider implements PeriodicPathProvider {
	readonly id = 'notebook-navigator';

	constructor(private readonly config: NotebookNavigatorPeriodicConfig) {}

	resolve(date: Date, cycle: PeriodicCycle): PeriodicNoteTarget {
		return resolvePeriodicNoteTarget(this.config.rootFolder, this.config.patterns[cycle], pattern => moment(date).format(pattern));
	}
}
