import { v4 as uuidv4 } from 'uuid';

export interface FileRecord {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  tool: string;
  status: string;
  outputPath: string | null;
  createdAt: string;
}

export interface ErrorLog {
  id: string;
  tool: string;
  message: string;
  details: string | null;
  createdAt: string;
}

export class Database {
  constructor(private db: D1Database) {}

  async recordFile(
    filename: string,
    originalName: string,
    mime: string,
    size: number,
    tool: string,
    outputPath: string
  ): Promise<void> {
    try {
      const id = uuidv4();
      await this.db.prepare(
        'INSERT INTO FileRecord (id, filename, originalName, mimeType, size, tool, status, outputPath) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(id, filename, originalName, mime, size, tool, 'completed', outputPath).run();
    } catch (e) {
      console.error('[recordFile]', e);
    }
  }

  async logError(tool: string, message: string, details: string = ''): Promise<void> {
    try {
      const id = uuidv4();
      await this.db.prepare(
        'INSERT INTO ErrorLog (id, tool, message, details) VALUES (?, ?, ?, ?)'
      ).bind(id, tool, message, details).run();
    } catch (e) {
      console.error('[logError]', e);
    }
  }

  async getHistory(limit: number = 50): Promise<FileRecord[]> {
    const result = await this.db.prepare(
      'SELECT * FROM FileRecord ORDER BY createdAt DESC LIMIT ?'
    ).bind(limit).all();
    return result.results as unknown as FileRecord[];
  }

  async getErrors(limit: number = 50): Promise<ErrorLog[]> {
    const result = await this.db.prepare(
      'SELECT * FROM ErrorLog ORDER BY createdAt DESC LIMIT ?'
    ).bind(limit).all();
    return result.results as unknown as ErrorLog[];
  }

  async deleteHistoryRecord(id: string): Promise<boolean> {
    const record = await this.db.prepare(
      'SELECT * FROM FileRecord WHERE id = ?'
    ).bind(id).first();
    
    if (!record) return false;
    
    await this.db.prepare('DELETE FROM FileRecord WHERE id = ?').bind(id).run();
    return true;
  }

  async clearHistory(): Promise<number> {
    const result = await this.db.prepare('DELETE FROM FileRecord').run();
    return result.meta?.changes || 0;
  }
}
