-- D1 Database Schema for Excel Suite

CREATE TABLE IF NOT EXISTS FileRecord (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  originalName TEXT NOT NULL,
  mimeType TEXT NOT NULL,
  size INTEGER NOT NULL,
  tool TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  outputPath TEXT,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ErrorLog (
  id TEXT PRIMARY KEY,
  tool TEXT NOT NULL,
  message TEXT NOT NULL,
  details TEXT,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS FileRecord_createdAt ON FileRecord(createdAt);
CREATE INDEX IF NOT EXISTS FileRecord_tool ON FileRecord(tool);
CREATE INDEX IF NOT EXISTS ErrorLog_createdAt ON ErrorLog(createdAt);
