CREATE TABLE IF NOT EXISTS documents (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    mysql_lesson_id INT NULL,
    title VARCHAR(255) NOT NULL,
    source_content LONGTEXT NOT NULL,
    content_markdown LONGTEXT,
    source_file_url VARCHAR(1024),
    source_file_name VARCHAR(255),
    source_file_mime_type VARCHAR(128),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_documents_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS document_hash (
    hash VARCHAR(64) NOT NULL,
    user_id INT NOT NULL,
    document_id INT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (hash, user_id),
    FOREIGN KEY (document_id) REFERENCES lessons(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cache_hit (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    hash VARCHAR(64) NOT NULL,
    hit_count INT NOT NULL DEFAULT 1,
    last_hit_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (hash, user_id) REFERENCES document_hash(hash, user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_jobs (
    id VARCHAR(50) PRIMARY KEY,
    user_id INT NOT NULL,
    job_type VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    payload JSON,
    result JSON,
    error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_ai_jobs_user_status (user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS concept_tags (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY uq_user_tag_name (user_id, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS concept_edges (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    source_tag_id INT NOT NULL,
    target_tag_id INT NOT NULL,
    weight FLOAT DEFAULT 1.0,
    relationship_type VARCHAR(50) DEFAULT 'related_to',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (source_tag_id) REFERENCES concept_tags(id) ON DELETE CASCADE,
    FOREIGN KEY (target_tag_id) REFERENCES concept_tags(id) ON DELETE CASCADE,
    UNIQUE KEY uq_user_source_target (user_id, source_tag_id, target_tag_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS concept_weakness (
    user_id INT NOT NULL,
    tag_id INT NOT NULL,
    weakness_score FLOAT NOT NULL DEFAULT 0.5,
    card_count INT NOT NULL DEFAULT 0,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, tag_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES concept_tags(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fsrs_cards (
    card_id INT PRIMARY KEY,
    state INT NOT NULL DEFAULT 1,
    step INT NULL,
    stability FLOAT NULL,
    difficulty FLOAT NULL,
    due DATETIME NOT NULL,
    last_review DATETIME NULL,
    FOREIGN KEY (card_id) REFERENCES flashcards(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fsrs_reviews (
    id INT AUTO_INCREMENT PRIMARY KEY,
    card_id INT NOT NULL,
    rating INT NOT NULL,
    review_datetime DATETIME NOT NULL,
    review_duration INT NULL,
    FOREIGN KEY (card_id) REFERENCES flashcards(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lesson_tags (
    lesson_id INT NOT NULL,
    tag_id INT NOT NULL,
    PRIMARY KEY (lesson_id, tag_id),
    FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES concept_tags(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS flashcard_tags (
    flashcard_id INT NOT NULL,
    tag_id INT NOT NULL,
    PRIMARY KEY (flashcard_id, tag_id),
    FOREIGN KEY (flashcard_id) REFERENCES flashcards(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES concept_tags(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

