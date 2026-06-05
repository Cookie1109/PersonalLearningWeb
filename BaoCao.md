BÁO CÁO BÀI TẬP CÁ NHÂN
Môn học: Lập trình Python
Dự án: NEXL – Nền tảng Học tập Cá nhân Tích hợp AI
Họ và tên sinh viên:Trương Võ Trọng NhânMã sinh viên:2312708Lớp:CTK47AGiáo viên hướng dẫn:ThS. Phan Thị Thanh Nga
Đà Lạt, tháng 5 năm 2025

1. TỔNG QUAN DỰ ÁN
NEXL (Personal Learning Web) là nền tảng học tập cá nhân tích hợp Trí Tuệ Nhân Tạo, được xây dựng nhằm giúp người dùng chuyển đổi các tài liệu thô (PDF, DOCX, URL, văn bản thuần) thành một không gian học tập thông minh. Sản phẩm hướng đến mục tiêu tự động hóa quy trình tạo nội dung ôn tập, thay thế việc ghi chép thủ công bằng các công cụ AI có chiều sâu sư phạm.
1.1. Mục tiêu cốt lõi

Biến tài liệu học tập thành bài giảng có cấu trúc Markdown một cách tự động, hoàn toàn minh bạch với người dùng.
Cung cấp hệ thống ôn tập đa dạng: Quiz trắc nghiệm (10 câu), Flashcard ghi nhớ 3D, AI Tutor hỏi đáp theo tài liệu.
Duy trì động lực học thông qua cơ chế Gamification (EXP lũy tiến, Level, Streak, Daily Quests, Progress Heatmap).
Đảm bảo độ tin cậy: chống spam bằng Redis Rate Limit theo User_ID, bảo mật JWT Firebase, Idempotency Key.

1.2. Kiến trúc công nghệ
TầngCông nghệFrontendReact 18 + TypeScript + Vite, Tailwind CSS, Motion/React, Radix UI, React RouterBackendPython FastAPI, SQLAlchemy + MySQL, Redis (Cache & Rate Limit), Alembic MigrationAI / LLMGemini API – Flash (Streaming Chat & Flashcard) & Pro (Quiz generation & Parser phức tạp)Dịch vụFirebase Auth, Cloudinary (ảnh đại diện), DockerTestingPytest + Monkeypatch (Backend), Vitest (Frontend)
1.3. Sơ đồ luồng hệ thống (Workflow)
Người dùng tải tài liệu lên → Backend trích xuất văn bản → Gemini API sinh bài giảng Markdown (kèm Auto-Continuation) → Người dùng học bài giảng, làm Quiz, ôn Flashcard → AI Tutor / Document Chat hỗ trợ hỏi đáp → Hệ thống Gamification cập nhật EXP, Level, Streak và Daily Quests theo thời gian thực.

2. MÔ TẢ CHỨC NĂNG SẢN PHẨM
2.1. Quản lý Workspace & Tài liệu
Người dùng khởi tạo Workspace từ nhiều nguồn tài liệu. Giao diện hỗ trợ trạng thái Loading/Extracting thời gian thực và có cơ chế kiểm soát đầu vào nghiêm ngặt:

Văn bản thuần: Bộ đếm ký tự cảnh báo màu tại 40.000 ký tự, chặn tối đa ở 45.000 ký tự để kiểm soát giới hạn token AI.
Đường dẫn web (URL): Backend dùng thư viện trafilatura cào và lọc nội dung chính, tự động loại bỏ quảng cáo, menu, footer.
Tệp tin (PDF/DOCX): Hỗ trợ kéo-thả (Drag & Drop), validate dung lượng ≤ 15MB và kiểm tra MIME type phía Client trước khi upload.

2.2. Tự động sinh Bài giảng
AI phân tích toàn bộ tài liệu đầu vào và tái cấu trúc thành bài giảng chuyên nghiệp dạng Markdown theo mô hình "Chắt lọc Sư phạm": LỌC NHIỄU, TÁI CẤU TRÚC ý tưởng (chia nhóm ý, tạo title), BẢO TOÀN 100% code block kỹ thuật.

Hiển thị: Dùng react-markdown + remark-gfm (bảng biểu, bold, italic) và rehype-highlight tô màu cú pháp code tự động.
Auto-Continuation: Backend tự phát hiện khi LLM sinh dở nội dung (heuristic kiểm tra cấu trúc kết thúc Markdown), tự động nối lệnh để hoàn thiện bài giảng liền mạch – hoàn toàn minh bạch với người dùng.

2.3. Hệ thống Câu hỏi ôn tập (Quiz) & Thẻ nhớ (Flashcard)
Quiz:

Sinh 10 câu trắc nghiệm từ nội dung bài học, xáo trộn câu hỏi và đáp án mỗi lần fetch để chống học vẹt vị trí.
Cool-down Block: Nếu điểm dưới ngưỡng, UI bắt chờ 30s–1 phút trước khi làm lại, chặn thói quen dập bừa đáp án.
Nhận diện chủ đề IT để sinh câu hỏi dạng fill_code hoặc find_bug thay vì chỉ hỏi lý thuyết.

Flashcard:

Thẻ nhớ 3D flip animation (CSS preserve-3d), theo dõi tiến độ hoàn thành Deck.
Nút "Giải thích" (icon bóng đèn): gọi AI phân tích sâu khái niệm, trả về Markdown ghim bên dưới thẻ.

2.4. AI Tutor & Document Chat (Gia sư AI)

NEXL Tutor: Chat SSE Streaming qua fetch + POST + ReadableStream (bảo mật JWT), auto-scroll, ghim ngữ cảnh tài liệu đang mở, cho phép mở rộng kiến thức chuyên ngành.
Document Chat (NotebookLM Mini): Chế độ nghiêm ngặt – AI bắt buộc trả lời "Tài liệu không đề cập" nếu thông tin không có trong tài liệu nguồn, cấm tự sáng tác ngoài lề.

2.5. Hệ thống Thư viện
Màn hình quản lý các Workspace đã tạo, hiển thị dạng lưới thẻ (Grid Cards).

Tìm kiếm real-time với kỹ thuật Debounce (đợi ngưng gõ mới gọi API) và phím tắt Ctrl+K / Cmd+K.
Phân trang (Pagination): Tải dữ liệu từ Backend, chuyển trang nhẹ nhàng.
Đổi tên (Rename) và Xóa (Delete) Workspace kèm hộp thoại xác nhận (Confirm Modal) an toàn.

2.6. Hệ thống Gamification (Trò chơi hóa)
Dashboard được thiết kế xoay quanh Gamification nhằm giữ chân người dùng (Retention):

Widget Level & EXP: Thanh tiến trình lũy tiến theo công thức Level × 1000, trực quan hóa hành trình tích lũy kiến thức.
Progress Heatmap: Mô phỏng GitHub Activity Graph, đổi màu nhạt → đậm theo EXP tích lũy mỗi ngày (tối đa 800+ EXP).
Daily Quests: Nhiệm vụ hàng ngày dạng RPG (Dễ/Trung bình/Khó), reset theo múi giờ Việt Nam, có All-clear Bonus EXP.
Streak: Hiển thị chuỗi ngọn lửa kỷ luật. Modal popup "Streak Lost" tự động nhắc nhở khi đứt chuỗi.

2.7. Tài khoản, Bảo mật & Chống Spam

Firebase Auth + Cloudinary: Upload ảnh đại diện với validate ≤ 5MB và kiểm tra định dạng file phía Client.
Redis Rate Limit: Tối đa 3 lần sinh Quiz/10 phút; 5 giải thích Flashcard/1 phút. UI hiển thị Toast Notification màu đỏ khi nhận HTTP 429.
Idempotency Key: Mọi hành động Gamification cộng EXP đều có Key định danh Redis – tránh cộng dư điểm do lag mạng gửi request trùng.
Dark Mode / Light Mode: Toggle đặt ở Layout Component, lưu preferences trên LocalStorage theo hệ thống.

2.8. Kiến trúc Module Backend
ModuleVai tròMô tảapi / routersĐịnh tuyến HTTPTách biệt endpoint theo domain: workspace, quiz, flashcard, gamification, authservicesTầng nghiệp vụOrchestrate logic AI: gọi Gemini, xử lý Auto-Continuation, tính EXP, kiểm tra IdempotencymodelsORM DatabaseĐịnh nghĩa bảng User, Workspace, Quiz, Flashcard, DailyQuest, GamificationLog (SQLAlchemy)middlewareXử lý xuyên suốtRedis Rate Limit theo User_ID (JWT), CORS, xác thực Firebase tokenutils / parsersTiện ích dùng chungTrích xuất tài liệu (trafilatura, pymupdf4llm), parse Markdown, heuristic token-cut detection

3. QUÁ TRÌNH SỬ DỤNG AI & CÁC PROMPT ĐÃ THỰC HIỆN
Phần này trình bày chi tiết các prompt sinh viên đã sử dụng khi tương tác với AI (Gemini, Claude) trong suốt quá trình phát triển dự án NEXL – từ giai đoạn phân tích kiến trúc, thiết kế database, sinh code backend/frontend, đến tối ưu hóa hệ thống bảo mật và gamification.
STTPrompt đã sử dụngMục đích1"Tôi muốn xây dựng nền tảng học tập cá nhân tích hợp AI. Người dùng upload tài liệu (PDF, DOCX, URL, văn bản thuần), hệ thống tự động sinh bài giảng Markdown, bộ Quiz 10 câu, Flashcard và chatbot hỏi đáp theo tài liệu. Hãy phân tích bài toán, đề xuất kiến trúc hệ thống và stack công nghệ phù hợp."Phân tích2"Thiết kế schema database cho hệ thống NEXL gồm các bảng: users (EXP, Level, Streak, avatar), workspaces (tài liệu nguồn, bài giảng đã sinh), quizzes, flashcards, daily_quests và gamification_logs. Sử dụng SQLAlchemy với MySQL, có Alembic Migration."Tạo code3"Viết FastAPI endpoint nhận tệp PDF/DOCX (kéo-thả, tối đa 15MB), validate MIME type và dung lượng phía server, trích xuất văn bản, sau đó gọi Gemini API sinh bài giảng Markdown. Xử lý trường hợp LLM bị giới hạn Output Token giữa chừng."Tạo code4"Hãy viết một system prompt AI để sinh 10 câu hỏi trắc nghiệm JSON từ nội dung bài học. Yêu cầu: nhận diện chủ đề IT để tạo câu hỏi dạng fill_code hoặc find_bug. Output JSON phải có đủ field: question, options (A–D), answer, type."Phân tích5"Xây dựng component Flashcard React có hiệu ứng flip 3D (CSS transform preserve-3d). Tích hợp nút 'Giải thích' (icon bóng đèn): khi click, gọi API AI phân tích sâu khái niệm và render kết quả Markdown bên dưới thẻ."Tạo code6"Tôi muốn AI Tutor streaming từng chữ như ChatGPT. Hiện dùng EventSource nhưng không đính kèm được Authorization Header JWT Firebase. Hãy đề xuất giải pháp bảo mật và triển khai streaming SSE kèm xác thực token."Phân tích7"Thiết kế hệ thống Rate Limit cho FastAPI với Redis: tối đa 3 lần sinh Quiz/10 phút và 5 lần giải thích Flashcard/1 phút. Dùng User_ID từ JWT làm key (không dùng IP). Khi vượt hạn mức trả về HTTP 429."Tạo code8"Xây dựng hệ thống Gamification: cộng EXP khi hoàn thành bài học, làm Quiz, học Flashcard. Tính Level theo công thức lũy tiến Level × 1000. Thiết kế Idempotency Key Redis để chống cộng dư EXP khi client gửi request trùng do lag mạng."Tạo code9"Vẽ Progress Heatmap mô phỏng GitHub Activity Graph bằng React. Mỗi ô là một ngày trong năm, đổi màu từ nhạt đến đậm dựa theo tổng EXP cày được trong ngày (màu tối nhất ở mức 800+ EXP). Dữ liệu lấy từ API /api/gamification/heatmap."Tạo code10"Thiết kế Document Chat 'NotebookLM Mini' với system prompt nghiêm ngặt: AI chỉ trả lời dựa trên tài liệu người dùng đã upload. Nếu không tìm thấy trong tài liệu, bắt buộc trả lời: 'Tài liệu không đề cập đến vấn đề này.' – tuyệt đối không được suy đoán ngoài lề."Phân tích11"Xây dựng hệ thống Daily Quests theo múi giờ Việt Nam (UTC+7): reset nhiệm vụ lúc 00:00 mỗi ngày, phân loại Dễ/Trung bình/Khó, cộng All-clear Bonus EXP khi hoàn thành toàn bộ. Backend dùng FastAPI + Redis, Frontend hiển thị dạng checklist RPG."Tạo code12"Triển khai cơ chế Auto-Continuation cho Lesson Generation: Backend phát hiện khi Gemini Flash sinh dở bài giảng Markdown bằng heuristic kiểm tra cấu trúc kết thúc. Tự động nối lệnh prompt để sinh tiếp và ghép seamless – người dùng không nhận ra sự gián đoạn."Phân tích
3.1. Các chỉnh sửa sau khi AI sinh code

Chỉnh sửa 1 – Bảo mật SSE: AI đề xuất dùng EventSource nhưng trình duyệt không cho phép đính kèm Authorization Header (JWT Firebase) → chuyển sang fetch API + POST + ReadableStream() để vừa bảo mật vừa giữ hiệu ứng streaming.
Chỉnh sửa 2 – Rate Limit theo User_ID: AI dùng IP làm key Redis – sai lầm vì môi trường NAT dùng chung IP. Cấu hình lại Middleware đọc JWT Token để lấy User_ID làm khóa định danh.
Chỉnh sửa 3 – Auto-Continuation: AI đề xuất đơn giản kiểm tra độ dài response. Nâng cấp thành heuristic phát hiện cấu trúc Markdown bị cắt (thiếu dấu kết thúc heading, block code chưa đóng) rồi tự động nối lệnh sinh tiếp.
Chỉnh sửa 4 – Idempotency Key: AI sinh code cộng EXP trực tiếp user.exp += value. Bổ sung cơ chế Key Redis định danh theo hành động + ngày, bỏ qua request đã xử lý, tránh cộng dư khi mạng chậm.


4. KẾT QUẢ ĐẠT ĐƯỢC
Tính năngMô tả ngắnTrạng tháiNhập liệu đa nguồnHỗ trợ Raw Text (≤ 45.000 ký tự), URL (trafilatura), PDF/DOCX (Drag & Drop, ≤ 15MB)✔ Hoàn thiệnTự động sinh Bài giảngMarkdown tự động, Auto-Continuation xử lý token limit, Syntax Highlight code✔ Hoàn thiệnQuiz trắc nghiệm10 câu, xáo trộn, Cool-down Block (30s–1 phút), dạng fill_code / find_bug✔ Hoàn thiệnFlashcard 3DFlip animation, tracking tiến độ Deck, nút Giải thích AI (Markdown inline)✔ Hoàn thiệnAI Tutor (NEXL Tutor)SSE qua fetch + POST + ReadableStream, auto-scroll, ghim context tài liệu✔ Hoàn thiệnDocument ChatChế độ nghiêm ngặt NotebookLM Mini, cấm AI sáng tác ngoài tài liệu nguồn✔ Hoàn thiệnThư viện WorkspaceGrid Cards, tìm kiếm Debounce (Ctrl+K), phân trang Backend, Rename / Delete✔ Hoàn thiệnGamificationLevel/EXP lũy tiến, Heatmap GitHub, Daily Quests múi giờ VN, Streak + Modal Popup✔ Hoàn thiệnAuth & ProfileFirebase Auth, Cloudinary upload avatar, validate Client-side ≤ 5MB✔ Hoàn thiệnRate Limit & Anti-SpamRedis Rate Limit theo User_ID (JWT), Toast HTTP 429, Idempotency Key EXP✔ Hoàn thiện

5. KHÓ KHĂN VÀ BÀI HỌC KINH NGHIỆM
5.1. Khó khăn đã gặp

Khó khăn 1 – LLM bị cắt giữa chừng: Gemini Flash có giới hạn Output Token, khiến bài giảng bị sinh dở. Giải pháp: Auto-Continuation phát hiện qua heuristic và nối tiếp tự động.
Khó khăn 2 – SSE không truyền được JWT Token: Trình duyệt không cho phép đính kèm Header vào EventSource. Giải pháp: chuyển sang fetch + ReadableStream() với method POST.
Khó khăn 3 – Rate Limit theo IP bị lỗi NAT: Môi trường trường học dùng chung IP khiến nhiều người bị khóa oan. Giải pháp: đọc User_ID từ JWT làm khóa Redis.
Khó khăn 4 – Cộng dư EXP do lag mạng: Client gửi request trùng khi mạng chậm. Giải pháp: Idempotency Key lưu Redis, bỏ qua request đã xử lý trong ngày.

5.2. Bài học kinh nghiệm

AI là công cụ hỗ trợ, không thay thế tư duy thiết kế: AI sinh code nhanh nhưng cần con người kiểm tra edge cases và đảm bảo kiến trúc tổng thể hợp lý.
Luôn kiểm tra bảo mật ngay từ đầu: Lỗ hổng SSE/EventSource là minh chứng cho việc cần tư duy bảo mật từ giai đoạn thiết kế.
Xử lý edge case quan trọng hơn happy path: Các vấn đề thực tế (NAT, lag mạng, token limit) xuất hiện ở những trường hợp không lường trước.
Thiết kế UX tốt đi đôi với Backend chắc chắn: Toast 429 màu đỏ, Cool-down Block đều là phản hồi người dùng xuất phát từ xử lý lỗi Backend có chiều sâu.


6. KẾT LUẬN VÀ HƯỚNG PHÁT TRIỂN
6.1. Kết luận
NEXL là minh chứng thực tiễn cho việc ứng dụng AI vào giáo dục. Hệ thống hoàn thiện 10 nhóm tính năng lớn, hoạt động ổn định, bảo mật và cung cấp trải nghiệm học tập tương tác cao. Quan trọng hơn, quá trình phát triển đã rèn luyện tư duy phản biện: biết khi nào nên tin AI, khi nào cần tự nghiên cứu và giải quyết vấn đề thực tiễn mà AI không thể tự phát hiện.
6.2. Hướng phát triển

Tích hợp phân tích hình ảnh và công thức toán học (LaTeX) từ file slide PowerPoint.
Hệ thống đề xuất bài học cá nhân hóa dựa trên lịch sử làm Quiz và điểm yếu người dùng.
Hỗ trợ học tập nhóm trong cùng một Workspace tài liệu (Collaborative Learning).
Tích hợp Spaced Repetition System (SRS) cho Flashcard theo thuật toán SuperMemo/SM-2.
Phát triển ứng dụng Mobile (React Native) để học mọi lúc mọi nơi.