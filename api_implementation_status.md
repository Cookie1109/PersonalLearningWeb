# API Implementation Status

Document purpose: review-ready diff pack for the migration from mock data to production data contracts.

## 1) The API Contract Matrix

| Feature Domain | Endpoint | Request DTO (Pydantic / TS) | Response DTO (Pydantic / TS) | React Component Usage |
|---|---|---|---|---|
| Auth | POST /api/auth/login | Missing (must add LoginRequestDTO / LoginRequestDTO) | Missing (must add LoginResponseDTO / LoginResponseDTO) | Planned: auth service + route guards (not wired yet) |
| Auth | POST /api/auth/refresh | Missing (must add RefreshTokenRequestDTO or cookie-only contract) | Missing (must add RefreshTokenResponseDTO) | Planned: Axios interceptor in src/api/client.ts |
| Auth | POST /api/auth/logout | Missing (must add LogoutRequestDTO) | Missing (must add GenericStatusDTO) | Planned: settings/profile actions |
| Roadmap | POST /api/roadmaps/generate | RoadmapGenerateRequestDTO / RoadmapGenerateRequestDTO | RoadmapGenerateResponseDTO / RoadmapGenerateResponseDTO | src/app/pages/RoadmapGenerator.tsx via src/api/learning.ts |
| Lesson | POST /api/lessons/content | Missing in backend schemas for request shape (recommended: LessonContentRequestDTO). Frontend currently sends inline payload { lessonTitle, weekTitle } | LessonContentDTO / LessonContentDTO | src/app/pages/LearningWorkspace.tsx via src/api/learning.ts |
| Lesson | GET /api/content/youtube | Query param q (not yet formalized as DTO) | YouTubeVideoDTO list / YouTubeVideoDTO[] | src/app/pages/LearningWorkspace.tsx via src/api/learning.ts |
| Lesson (Tutor) | POST /api/chat/socratic | ChatRequestDTO / ChatRequestDTO | ChatResponseDTO / ChatResponseDTO | src/app/components/ChatTutor.tsx via src/api/chat.ts |
| Quiz | GET /api/lessons/{lesson_id}/quiz | Path param lesson_id (not DTO body) | QuizResponseDTO / QuizResponseDTO | src/app/pages/QuizPage.tsx via src/api/quiz.ts |
| Quiz | POST /api/quizzes/submit | QuizSubmitRequestDTO / QuizSubmitRequestDTO | QuizSubmitResponseDTO / QuizSubmitResponseDTO | src/app/pages/QuizPage.tsx via src/api/quiz.ts |

Security highlight:
- CRITICAL: GET /api/lessons/{lesson_id}/quiz must never include correct_answer or explanation.
- Current contract is compliant: QuizResponseDTO only contains quiz_id, lesson_id, questions(question_id, text, options).
- Disclosure of correct_answer and explanation is allowed only in QuizSubmitResponseDTO.results after submit.

## 2) Frontend Data Binding Status

### 2.1 Completed: mock-free or DTO/props-ready binding

- src/app/components/ChatTutor.tsx
  - Converted to typed props (ChatTutorProps) and API-driven response handler.
  - No direct third-party API call.

- src/app/components/FlashCard.tsx
  - Uses typed props for card data and completion callback.
  - Ready to bind backend-provided flashcard payload.

- src/app/components/Layout.tsx
  - Uses typed props fallback (LayoutProps) for user and roadmap display state.

- src/app/pages/RoadmapGenerator.tsx
  - Uses src/api/learning.ts and typed callback prop onGenerateRoadmap.
  - Suggested goals are props-driven (suggestedGoalOptions), no hard dependency on mock file.

- src/app/pages/LearningWorkspace.tsx
  - Uses src/api/learning.ts for lesson content and video enrichment.
  - Video payload typed with YouTubeVideoDTO.

- src/app/pages/QuizPage.tsx
  - Uses QuizResponseDTO and QuizSubmitResponseDTO through src/api/quiz.ts.
  - Submission flow is server-graded; no local correct answer source in fetch payload.

- src/app/context/AppContext.tsx
  - Removed direct import dependency on mockData.
  - Accepts initial typed data through AppProvider props.

- src/app/lib/types.ts
  - Mapped to DTO-aligned typing bridge between API contracts and UI-facing models.

### 2.2 Remaining hard-code / refactor candidates

- src/app/pages/LearningWorkspace.tsx
  - Still applies local reward message and local +50 EXP behavior in UI flow (completeLesson/addExpAndStreak), should come from backend lesson-complete response.

- src/app/pages/QuizPage.tsx
  - Still computes EXP gain in frontend from score, should be server-authoritative reward ledger response.

- src/app/pages/Dashboard.tsx
  - Contains static reward card constants and quick suggestions; should be migrated to backend-configurable payload.

- src/app/context/AppContext.tsx
  - Keeps client-side mutations for roadmap/user progression; long-term should be replaced by API state sync and cache layer (Dexie + server truth).

- src/app/pages/RoadmapGenerator.tsx
  - Uses static generation step texts and static UX labels referencing AI provider; optional but recommended to move to config/content payload.

- src/app/components/figma/ImageWithFallback.tsx
  - Functionally fine. No API binding required. Keep as presentational utility.

## 3) Backend Gap Analysis (FastAPI)

Current backend status in repository:
- Present: schema layer only (backend/app/schemas/dto.py).
- Missing: routers, controllers/services, middleware stack, SQLAlchemy models, migrations, auth/security modules.

### 3.1 Mandatory FastAPI implementation checklist

- [ ] Create app entrypoint and dependency wiring (FastAPI app factory, settings, DI).
- [ ] Implement auth router group (/api/auth/login, /api/auth/refresh, /api/auth/logout, optional /api/auth/logout-all).
- [ ] Implement roadmap router: POST /api/roadmaps/generate using RoadmapGenerateRequestDTO -> RoadmapGenerateResponseDTO.
- [ ] Implement lesson router: POST /api/lessons/content with explicit request DTO and response LessonContentDTO.
- [ ] Implement enrichment router: GET /api/content/youtube with typed response list[YouTubeVideoDTO].
- [ ] Implement chat router: POST /api/chat/socratic with ChatRequestDTO -> ChatResponseDTO.
- [ ] Implement quiz router: GET /api/lessons/{lesson_id}/quiz with strict QuizResponseDTO.
- [ ] Implement quiz router: POST /api/quizzes/submit with QuizSubmitRequestDTO -> QuizSubmitResponseDTO.
- [ ] Add strict response filtering to guarantee GET quiz never leaks correct_answer/explanation.
- [ ] Add JWT verification middleware/dependency for protected routes.
- [ ] Add refresh-token rotation and replay detection flow (Redis-backed token family state).
- [ ] Add rate limit middleware (Redis) for roadmap generation, lesson generation, quiz submit, chat.
- [ ] Add idempotency-key middleware for POST /api/quizzes/submit.
- [ ] Add centralized exception handlers mapping to 401/403/409/429/503 semantics.
- [ ] Add request correlation ID and audit logging middleware.

### 3.2 SQLAlchemy models and persistence checklist

- [ ] users
- [ ] roadmaps
- [ ] lessons (including version or updated_at for cache coherency)
- [ ] learning_logs
- [ ] exp_ledger (with UNIQUE(user_id, lesson_id, action_type))
- [ ] quiz_attempts (with index on (user_id, lesson_id))
- [ ] quiz_items or lesson_quiz_payload storage model for answer key persistence on server
- [ ] security_audit_logs
- [ ] Alembic migrations for all tables and indexes

### 3.3 Redis state checklist (operational contracts)

- [ ] Refresh token family state (user_id + device_id + active jti)
- [ ] Replay detection and family revoke policy
- [ ] Idempotency key state for quiz submit (IN_PROGRESS/COMPLETED with TTL)
- [ ] Rate-limit counters per user and endpoint
- [ ] Token budget counters for AI usage guardrails

### 3.4 Contract completeness gaps to close next

- [ ] Add missing Auth DTOs in backend/app/schemas/dto.py and src/api/dto.ts.
- [ ] Add LessonContentRequestDTO (backend + TS) for POST /api/lessons/content request body.
- [ ] Add YouTube query DTO or typed query validator for GET /api/content/youtube.
- [ ] Add common ErrorResponseDTO contract and use consistently across all endpoints.

---

Status summary:
- DTO foundation is in place and frontend consumption is mostly contract-driven.
- The backend implementation layer is still at zero-percent beyond schemas.
- Highest-priority next move: implement protected quiz endpoints and auth middleware before enabling real user traffic.
