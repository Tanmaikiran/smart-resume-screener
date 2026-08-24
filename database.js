const Database = require('better-sqlite3');

const db = new Database('resume_screener.db');

db.prepare(`
    CREATE TABLE IF NOT EXISTS resumes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_name TEXT NOT NULL,
        resume_text TEXT NOT NULL,
        skills TEXT,
        experience TEXT,
        education TEXT,
        uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`).run();

db.prepare(`
    CREATE TABLE IF NOT EXISTS evaluations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        resume_id INTEGER NOT NULL,
        job_description TEXT NOT NULL,
        match_score INTEGER,
        decision TEXT,
        justification TEXT,
        evaluated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (resume_id) REFERENCES resumes(id)
    )
`).run();

module.exports = db;