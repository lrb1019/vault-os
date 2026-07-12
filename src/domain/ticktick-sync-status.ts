export type TickTickSyncState = 'idle' | 'syncing' | 'success' | 'error';
export type TickTickRemoteState = 'unknown' | 'success' | 'error';
export type TickTickCacheState = 'idle' | 'loaded' | 'persisted' | 'read-error' | 'write-error';

export interface TickTickSyncStatus {
	state: TickTickSyncState;
	lastSyncedAt: number | null;
	errorMessage: string | null;
	remoteState: TickTickRemoteState;
	cacheState: TickTickCacheState;
}

export interface CacheWriteResult {
	ok: boolean;
}

export function createRemoteSyncStatus(lastSyncedAt: number, cacheWrite: CacheWriteResult): TickTickSyncStatus {
	return cacheWrite.ok
		? {
			state: 'success',
			lastSyncedAt,
			errorMessage: null,
			remoteState: 'success',
			cacheState: 'persisted'
		}
		: {
			state: 'success',
			lastSyncedAt,
			errorMessage: '远端 TickTick 数据已同步，但本地缓存写入失败。请检查 Vault 写入权限后重新同步。',
			remoteState: 'success',
			cacheState: 'write-error'
		};
}
