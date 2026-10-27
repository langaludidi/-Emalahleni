/** Pure, side-effect-free SC-003 queue contract. Not an API or database writer. */
import type { DrivePdf } from './smart-capture-drive';

export const importStates = [
 'DISCOVERED','QUEUED','FETCHING','QUARANTINED','SCANNING',
 'EXTRACTING','NEEDS_REVIEW','VERIFIED','COMMITTING','COMMIT_UNCERTAIN',
 'COMMITTED','REJECTED','FAILED',
] as const;
export type ImportState = typeof importStates[number];

const edges: Record<ImportState, readonly ImportState[]> = {
 DISCOVERED:['QUEUED','REJECTED'],
 QUEUED:['FETCHING','REJECTED'],
 FETCHING:['QUARANTINED','FAILED'],
 QUARANTINED:['SCANNING','FAILED'],
 SCANNING:['EXTRACTING','FAILED','REJECTED'],
 EXTRACTING:['NEEDS_REVIEW','FAILED'],
 NEEDS_REVIEW:['VERIFIED','REJECTED'],
 VERIFIED:['COMMITTING','NEEDS_REVIEW'],
 COMMITTING:['COMMITTED','COMMIT_UNCERTAIN'],
 COMMIT_UNCERTAIN:['COMMITTED','NEEDS_REVIEW','FAILED'],
 COMMITTED:[],
 REJECTED:[],
 FAILED:['QUEUED','REJECTED'],
};

export function canTransition(from: ImportState, to: ImportState): boolean {
 return edges[from].includes(to);
}

/**
 * Drive's version is the preferred remote revision. Modified time plus
 * checksum are used only to identify a discovery snapshot when absent.
 * The processing worker must recalculate full SHA-256 of downloaded bytes.
 */
export function discoveryVersion(file: DrivePdf): string {
 if (file.revision !== null) return `v:${file.revision}`;
 const timestamp = Date.parse(file.modifiedTime);
 if (!Number.isFinite(timestamp) || !file.checksum) throw new Error('SOURCE_REVISION_UNAVAILABLE');
 return `m:${timestamp}:${file.checksum.toLowerCase()}`;
}

/** Do not equate a Drive PDF to a person; this is source deduplication only. */
export function sourceIdentity(projectId: string, sourceId: string, file: DrivePdf) {
 if (!/^[0-9a-f-]{36}$/i.test(projectId) || !/^[0-9a-f-]{36}$/i.test(sourceId))
   throw new Error('INVALID_IMPORT_SCOPE');
 return { projectId, sourceId, providerFileId:file.providerFileId, sourceVersion:discoveryVersion(file) };
}

export type ImportSummary = {
 id: string;
 projectId: string;
 state: ImportState;
 applicationId: string | null;
 attemptCount: number;
 errorCode: string | null;
};

/** Redacted shape suitable for a project-authorised list response. */
export function publicImportSummary(row: ImportSummary) {
 return { id:row.id, state:row.state, applicationId:row.applicationId,
   attemptCount:row.attemptCount,errorCode:row.errorCode };
}
