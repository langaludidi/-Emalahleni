/**
 * Smart Capture SC-002: read-only Google Drive PDF discovery.
 * This is a provider adapter, NOT an authenticated route or a background job.
 * The caller must enforce project membership, configure one approved folder,
 * and store a credential server-side. No document bytes are retrieved here.
 */
import { HttpError } from './http';

export type DrivePdf = {
  providerFileId: string;
  name: string;
  mimeType: 'application/pdf';
  sizeBytes: number;
  modifiedTime: string;
  revision: string | null;
  checksum: string | null;
};

export interface DriveListResult {
  files: DrivePdf[];
  nextPageToken: string | null;
}

export type DriveFetcher = (request: Request) => Promise<Response>;
const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const FOLDER_ID = /^[A-Za-z0-9_-]{10,128}$/;
const MAX_ITEMS = 100;
const MAX_TOKEN_LENGTH = 1024;
const VALID_DATE = /^\d{4}-\d\d-\d\dT/;

export async function listBeneficiaryPdfs(input: {
  approvedFolderId: string;
  accessToken: string;
  pageToken?: string | null;
  fetcher?: DriveFetcher;
}): Promise<DriveListResult> {
  const { approvedFolderId, accessToken, pageToken = null } = input;
  if (!FOLDER_ID.test(approvedFolderId)) throw new HttpError(400, 'DRIVE_FOLDER_INVALID');
  if (!accessToken || /\s/.test(accessToken)) throw new HttpError(503, 'DRIVE_CREDENTIAL_UNAVAILABLE');
  if (pageToken !== null && (pageToken.length > MAX_TOKEN_LENGTH || !/^[A-Za-z0-9_./+=:-]+$/.test(pageToken))) {
    throw new HttpError(400, 'DRIVE_PAGE_TOKEN_INVALID');
  }

  const url = new URL(DRIVE_API);
  url.searchParams.set('q', `'${approvedFolderId}' in parents and mimeType = 'application/pdf' and trashed = false`);
  url.searchParams.set('pageSize', String(MAX_ITEMS));
  url.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType,size,modifiedTime,version,md5Checksum,parents,trashed)');
  url.searchParams.set('spaces', 'drive');
  url.searchParams.set('orderBy', 'name');
  url.searchParams.set('supportsAllDrives', 'true');
  url.searchParams.set('includeItemsFromAllDrives', 'true');
  if (pageToken) url.searchParams.set('pageToken', pageToken);

  let response: Response;
  try {
    response = await (input.fetcher ?? fetch)(new Request(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    }));
  } catch {
    throw new HttpError(503, 'DRIVE_FETCH_UNAVAILABLE');
  }
  if (!response.ok) {
    // Provider response bodies may contain paths or identifying details. Never relay them.
    if (response.status === 401 || response.status === 403) throw new HttpError(503, 'DRIVE_ACCESS_UNAVAILABLE');
    if (response.status === 429 || response.status >= 500) throw new HttpError(503, 'DRIVE_RETRY_REQUIRED');
    throw new HttpError(502, 'DRIVE_LIST_FAILED');
  }

  let payload: unknown;
  try { payload = await response.json(); } catch { throw new HttpError(502, 'DRIVE_RESPONSE_INVALID'); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new HttpError(502, 'DRIVE_RESPONSE_INVALID');
  const result = payload as Record<string, unknown>;
  if (!Array.isArray(result.files) || result.files.length > MAX_ITEMS) throw new HttpError(502, 'DRIVE_RESPONSE_INVALID');
  const next = result.nextPageToken;
  if (next != null && (typeof next !== 'string' || next.length > MAX_TOKEN_LENGTH || !/^[A-Za-z0-9_./+=:-]+$/.test(next))) {
    throw new HttpError(502, 'DRIVE_RESPONSE_INVALID');
  }

  const files: DrivePdf[] = [];
  const encountered = new Set<string>();
  for (const row of result.files) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new HttpError(502, 'DRIVE_RESPONSE_INVALID');
    const file = row as Record<string, unknown>;
    // Treat Drive output as untrusted. Never accept a returned file outside the approved folder.
    if (!Array.isArray(file.parents) || !file.parents.includes(approvedFolderId) ||
        file.trashed === true || file.mimeType !== 'application/pdf' ||
        typeof file.id !== 'string' || !FOLDER_ID.test(file.id) ||
        typeof file.name !== 'string' || file.name.length > 200 ||
        typeof file.modifiedTime !== 'string' || !VALID_DATE.test(file.modifiedTime) ||
        (typeof file.size !== 'string' && typeof file.size !== 'number') ||
        !/^\d+$/.test(String(file.size))) throw new HttpError(502, 'DRIVE_RESPONSE_INVALID');
    const size = Number(file.size);
    if (!Number.isSafeInteger(size) || size < 0) throw new HttpError(502, 'DRIVE_RESPONSE_INVALID');
    if (encountered.has(file.id)) throw new HttpError(502, 'DRIVE_RESPONSE_INVALID');
    encountered.add(file.id);
    const revision = file.version == null ? null : String(file.version);
    if (revision !== null && !/^\d{1,30}$/.test(revision)) throw new HttpError(502, 'DRIVE_RESPONSE_INVALID');
    const checksum = file.md5Checksum == null ? null : String(file.md5Checksum);
    if (checksum !== null && !/^[a-fA-F0-9]{32}$/.test(checksum)) throw new HttpError(502, 'DRIVE_RESPONSE_INVALID');
    files.push({
      providerFileId: file.id, name: file.name, mimeType: 'application/pdf',
      sizeBytes: size, modifiedTime: file.modifiedTime, revision, checksum,
    });
  }
  return {files, nextPageToken: next == null ? null : next};
}
