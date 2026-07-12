import { moment } from 'obsidian';
import { type ManualPeriodicConfig, type PeriodicCycle, type PeriodicNoteTarget, type PeriodicPathProvider, resolvePeriodicNoteTarget } from '../domain/periodic-note';

/** Uses Vault OS-owned settings when no external periodic-note provider is enabled. */
export class ConfiguredManualPeriodicPathProvider implements PeriodicPathProvider {
	readonly id = 'configured-manual';

	constructor(private readonly config: ManualPeriodicConfig) {}

	resolve(date: Date, cycle: PeriodicCycle): PeriodicNoteTarget {
		return resolvePeriodicNoteTarget(this.config.rootFolder, this.config.patterns[cycle], pattern => moment(date).format(pattern));
	}
}
