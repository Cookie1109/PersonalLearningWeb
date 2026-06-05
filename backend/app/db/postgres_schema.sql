-- Schema for PostgreSQL (Supabase / Local)
CREATE TABLE IF NOT EXISTS documents (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL,
    mysql_lesson_id INT, -- links to MySQL lessons.id
    title VARCHAR(255) NOT NULL,
    source_content TEXT NOT NULL,
    content_markdown TEXT,
    source_file_url VARCHAR(1024),
    source_file_name VARCHAR(255),
    source_file_mime_type VARCHAR(128),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);


CREATE TABLE IF NOT EXISTS document_hash (
    hash VARCHAR(64) PRIMARY KEY,
    document_id INT NOT NULL, -- logical FK to documents.id
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cache_hit (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL,
    hash VARCHAR(64) REFERENCES document_hash(hash) ON DELETE CASCADE,
    hit_count INT NOT NULL DEFAULT 1,
    last_hit_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_jobs (
    id VARCHAR(50) PRIMARY KEY,
    user_id INT NOT NULL,
    job_type VARCHAR(50) NOT NULL, -- e.g. 'process_upload'
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, processing, completed, failed
    payload JSONB,
    result JSONB,
    error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_user_status ON ai_jobs(user_id, status);
