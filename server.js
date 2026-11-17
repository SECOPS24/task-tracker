const path = require('path');
const fs = require('fs');
const express = require('express');

const PORT = 3000;
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'data', 'tasks.db');
const TITLE_MAX = 200;
const NOTES_MAX = 2000;

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '50kb' }));

// Health check: no database, no logic.
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// The database is opened lazily so the server (and /health, /) come up
// even if the database is slow or unavailable.
let db = null;
function getDb() {
  if (db) return db;
  const Database = require('better-sqlite3');
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const conn = new Database(DB_PATH);
  conn.pragma('journal_mode = WAL');
  conn.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT    NOT NULL,
      notes      TEXT    NOT NULL DEFAULT '',
      completed  INTEGER NOT NULL DEFAULT 0,
      created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `);
  db = conn;
  return db;
}

function toTask(row) {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    completed: row.completed === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseId(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: 'Task id must be a positive whole number.' });
    return null;
  }
  return id;
}

// Validates the fields present in a request body. Returns { error } or { fields }.
function readFields(body, { requireTitle }) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Send a JSON object.' };
  }
  const fields = {};

  if (body.title !== undefined) {
    if (typeof body.title !== 'string') return { error: 'Title must be text.' };
    const title = body.title.trim();
    if (!title) return { error: 'Title cannot be empty.' };
    if (title.length > TITLE_MAX) return { error: `Title must be ${TITLE_MAX} characters or fewer.` };
    fields.title = title;
  } else if (requireTitle) {
    return { error: 'Title is required.' };
  }

  if (body.notes !== undefined) {
    if (typeof body.notes !== 'string') return { error: 'Notes must be text.' };
    const notes = body.notes.trim();
    if (notes.length > NOTES_MAX) return { error: `Notes must be ${NOTES_MAX} characters or fewer.` };
    fields.notes = notes;
  }

  if (body.completed !== undefined) {
    if (typeof body.completed !== 'boolean') return { error: 'Completed must be true or false.' };
    fields.completed = body.completed ? 1 : 0;
  }

  return { fields };
}

// List
app.get('/api/tasks', (req, res) => {
  const rows = getDb()
    .prepare('SELECT * FROM tasks ORDER BY completed ASC, id DESC')
    .all();
  res.json(rows.map(toTask));
});

// Read one
app.get('/api/tasks/:id', (req, res) => {
  const id = parseId(req, res);
  if (id === null) return;
  const row = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Task not found.' });
  res.json(toTask(row));
});

// Create
app.post('/api/tasks', (req, res) => {
  const { error, fields } = readFields(req.body, { requireTitle: true });
  if (error) return res.status(400).json({ error });
  const info = getDb()
    .prepare('INSERT INTO tasks (title, notes, completed) VALUES (?, ?, ?)')
    .run(fields.title, fields.notes || '', fields.completed || 0);
  const row = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(toTask(row));
});

// Update (edit title/notes, complete or reopen)
app.patch('/api/tasks/:id', (req, res) => {
  const id = parseId(req, res);
  if (id === null) return;
  const { error, fields } = readFields(req.body, { requireTitle: false });
  if (error) return res.status(400).json({ error });
  const names = Object.keys(fields);
  if (names.length === 0) {
    return res.status(400).json({ error: 'Nothing to update: send title, notes, or completed.' });
  }
  const sets = names.map((n) => `${n} = ?`).join(', ');
  const info = getDb()
    .prepare(`UPDATE tasks SET ${sets}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
    .run(...names.map((n) => fields[n]), id);
  if (info.changes === 0) return res.status(404).json({ error: 'Task not found.' });
  const row = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  res.json(toTask(row));
});

// Delete
app.delete('/api/tasks/:id', (req, res) => {
  const id = parseId(req, res);
  if (id === null) return;
  const info = getDb().prepare('DELETE FROM tasks WHERE id = ?').run(id);
  if (info.changes === 0) return res.status(404).json({ error: 'Task not found.' });
  res.status(204).end();
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// Front end. GET / serves public/index.html with a 200.
app.use(express.static(path.join(__dirname, 'public')));

// Errors: malformed JSON, database failures, anything else.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body is not valid JSON.' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Task Tracker listening on 0.0.0.0:${PORT}`);
});

function shutdown() {
  server.close(() => {
    if (db) db.close();
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
