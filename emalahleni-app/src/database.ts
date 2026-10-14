import { neon } from '@neondatabase/serverless';

export interface Statement { query: string; params?: unknown[]; }
export class Database {
  private sql: ReturnType<typeof neon>;
  constructor(connection: string) {
    // Refuse accidental deployment with database-owner credentials.
    const url = new URL(connection);
    if (decodeURIComponent(url.username) !== 'emalahleni_worker' || !url.hostname.endsWith('.neon.tech') || url.searchParams.get('sslmode') !== 'require') throw new Error('DATABASE_UNCONFIGURED');
    this.sql = neon(connection);
  }
  async forActor(actor: string, statements: Statement[],readOnly=false): Promise<Record<string, any>[][]> {
    // One HTTP transaction keeps actor context on the same backend; LOCAL resets it at commit.
    const results = await this.sql.transaction([
      this.sql.query("SELECT set_config('app.actor_id', $1, true)", [actor]),
      ...statements.map(s => this.sql.query(s.query, s.params ?? []))
    ],readOnly?{isolationLevel:'RepeatableRead',readOnly:true}:undefined);
    return results.slice(1) as Record<string, any>[][];
  }
}
export const writeRoles = ['ADMIN', 'OFFICER', 'FIELD_OFFICER', 'ASSESSOR', 'MANAGER'];
export const writeScope = "EXISTS (SELECT 1 FROM public.project_memberships m WHERE m.project_id=a.project_id AND m.user_id=current_setting('app.actor_id',true) AND m.active AND m.role IN ('ADMIN','OFFICER','FIELD_OFFICER','ASSESSOR','MANAGER'))";
