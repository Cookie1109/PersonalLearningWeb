# Báo cáo Chi tiết Chức năng Dự án PersonalLearningWeb (NEXL)

## 1. Giới thiệu tổng quan
NEXL là nền tảng học tập cá nhân tích hợp AI, giúp người dùng chuyển đổi các tài liệu thô (PDF, DOCX, URL, Text) thành một không gian học tập thông minh (Workspace). Hệ thống tự động sinh bài giảng, câu hỏi ôn tập (Quiz), thẻ nhớ (Flashcard) và hỗ trợ hỏi đáp chuyên sâu theo tài liệu. Giao diện người dùng (UI) được thiết kế hiện đại, hỗ trợ chuẩn Dark/Light Mode, tập trung vào trải nghiệm Gamification để duy trì động lực học.

---

## 2. Các chức năng chính và Quy trình hoạt động

### 2.1. Quản lý Workspace & Tài liệu (Document Management)
*   **Mô tả**: Khởi tạo không gian học tập từ tài liệu đầu vào. UI có trạng thái Loading/Extracting thời gian thực và có các rào chắn kiểm tra đầu vào nghiêm ngặt.
*   **Các nguồn hỗ trợ thực tế trong UI**:
    *   **Văn bản thuần (Raw Text)**: Nhập liệu text trực tiếp. Có bộ đếm ký tự hiển thị cảnh báo màu sắc khi chạm mốc 40.000 ký tự và chặn giới hạn tối đa ở 45.000 ký tự để tránh vượt hạn mức token của AI.
    *   **Đường dẫn web (URL)**: Dán link bài viết URL. Phía Backend sử dụng các thư viện như `trafilatura` để cào và lọc văn bản chính, tự động loại bỏ quảng cáo, trình đơn, footer rác.
    *   **Tệp tin (PDF/DOCX)**: Hỗ trợ vùng lấp Kéo-Thả (Drag & Drop UI) tiện dụng. Giao diện có kiểm duyệt dung lượng trực tiếp (giới hạn tối đa 15MB) và đảm bảo định dạng MIME hợp lệ trước khi tải lên hệ thống để trích xuất.

### 2.2. Thư viện Lưu trữ (Library)
*   **Mô tả**: Màn hình quản lý các Workspace đã tạo, được thiết kế hiển thị dạng lưới thẻ (Grid Cards).
*   **Tính năng UI**:
    *   **Tìm kiếm thông minh (Search)**: Tích hợp ô tìm kiếm real-time kèm kỹ thuật Debounce (Đợi ngưng gõ mới gọi API) để tối ưu hiệu năng. Hỗ trợ phím tắt (Ctrl+K hoặc Cmd+K) để focus nhanh vào thanh tìm kiếm.
    *   **Phân trang (Pagination)**: Dữ liệu tài liệu được fetch và phân trang ở Backend, giao diện cho phép chuyển trang qua lại nhẹ nhàng.
    *   **Quản lý**: Hỗ trợ tuỳ chọn Đổi tên (Rename) hoặc Xóa (Delete) Workspace kèm theo hộp thoại xác nhận (Confirm Modal) an toàn.

### 2.3. Tự động sinh Bài giảng (Lesson Generation)
*   **Mô tả**: AI phân tích tài liệu và cấu trúc lại thành một bài giảng chuyên nghiệp định dạng Markdown gồm nhiều đề mục.
*   **Hiển thị UI (Rendering)**: Giao diện học (Learning Workspace) sử dụng các thư viện như `react-markdown`, `remark-gfm` để hỗ trợ hiển thị bảng biểu, format text và `rehype-highlight` tự động tô màu cú pháp (Syntax Highlighting) sinh động cho các khối code.
*   **Cơ chế Auto-Continuation (Chống đứt gãy)**: Hệ thống Backend tự động phát hiện tình trạng bài giảng bị sinh thiếu nửa chừng (do giới hạn Output Token của LLM). Sau đó tự động nối lệnh sinh tiếp để ráp thành một nội dung Markdown hoàn chỉnh trả về Front-end.
*   **Prompt AI (Trích xuất)**:
    > "Thực hiện 'Chắt lọc Sư phạm': LỌC NHIỄU, TÁI CẤU TRÚC (chia nhóm ý, tạo title), BẢO TOÀN KỸ THUẬT (giữ 100% code block), ĐỊNH DẠNG HIỂN THỊ."

### 2.4. Hệ thống Câu hỏi ôn tập (Quiz Generation)
*   **Mô tả**: AI tạo một bộ test 10 câu hỏi trắc nghiệm đánh giá kiến thức bài học.
*   **Trải nghiệm giao diện (UI/UX)**: Giao diện thi trắc nghiệm gọn gàng, tự động chấm điểm và đánh dấu xanh/đỏ tại các đáp án trả lời đúng/sai ngay lập tức khi người dùng bấm Submit. Có State lưu trữ bảo vệ tránh mất phiên khi cuộn qua lại màn hình.
*   **Cơ chế thông minh & Gamification**:
    *   **Xáo trộn (Shuffle)**: Trình tự câu hỏi và thứ tự các đáp án được xáo trộn ngẫu nhiên mỗi lần fetch để đảm bảo người dùng không học vẹt vị trí (A/B/C/D).
    *   **Cool-down Block (Thời gian chờ)**: Tích hợp màn hình đếm ngược khóa thi. Nếu người dùng nộp bài bị rớt (điểm quá thấp), hệ thống bắt buộc chờ một khoảng thời gian (30s - 1 phút) trước khi cho làm lại, nhằm chặn thói quen nộp đi nộp lại spam đáp án.
    *   **Kiểm tra tính Code**: Prompt AI nhận diện chủ đề IT để sinh dạng câu hỏi điền code (`fill_code`) hoặc tìm lỗi sai (`find_bug`) thay vì chỉ hỏi lý thuyết.

### 2.5. Hệ thống Thẻ nhớ (Flashcard)
*   **Mô tả**: Trích xuất ngắn gọn các khái niệm, định nghĩa quan trọng thành các mặt thẻ (Front/Back) để ghi nhớ nhanh.
*   **Giao diện Tương tác (UI)**: Thẻ ghi nhớ hiển thị 3D với hiệu ứng Lật (Flip Animation). Có hệ thống tracking để theo dõi tiến độ hoàn thành bộ Deck.
*   **Giải thích sâu (On-demand Explanation)**: Khi người dùng cần hiểu cặn kẽ hơn mặt sau của Thẻ, họ có thể bấm vào nút **"Giải thích"** (Kèm icon bóng đèn UI). Nút này gọi API AI phân tích sâu khái niệm đó và trả về Text giải thích dưới dạng Markdown chi tiết ghim viền ngay bên dưới thẻ.

### 2.6. AI Tutor & Document Chat (Gia sư AI)
*   **NEXL Tutor (Workspace Chat)**: Khung Chat AI tích hợp dọc bên phải màn hình bài học. 
    *   *UI*: Hiển thị trạng thái "đang xử lý", tự động cuộn (auto-scroll) và hiển thị kết quả dần theo từng chữ chuẩn SSE (Streaming).
    *   *Context*: AI được ghim ngữ cảnh cực mạnh vào tài liệu đang mở, nhưng cho phép mở rộng với kiến thức ngoài nếu câu hỏi tương quan đến chuyên ngành.
*   **Document Chat (Chế độ NotebookLM Mini)**: Chế độ hội thoại nội bộ nghiêm ngặt cao độ. Nếu thông tin không tìm thấy trong tài liệu nguồn người dùng tải lên, Prompt ép AI phải trả lời "Tài liệu không đề cập" và tuyệt đối cấm AI tự sáng tác thông tin ngoài lề.

### 2.7. Hệ thống Gamification (Trò chơi hóa)
*   **Mô tả**: Nhằm biến ứng dụng thành "Trò chơi học tập", UI/UX ở Dashboard được thiết kế xoay quanh Gamification nhằm giữ chân người dùng (Retention).
*   **Bảng điều khiển (Dashboard UI Component)**:
    *   **Widget Thông tin**: Trực quan hóa Cấp độ (Level), chỉ số EXP hiện tại và thanh Progress bar trải dài đếm số điểm cần thiết đến cấp tiếp theo (Theo công thức lũy tiến: `Level * 1000`).
    *   **Biểu đồ Nhiệt Học Tập (Progress Heatmap)**: Vẽ ma trận ô vuông theo ngày mô phỏng GitHub Activity Graph. Các block đổi màu từ nhạt sang đậm dần dựa trên tổng lượng điểm EXP cày được trong ngày hôm đó (Lên tới 800+ EXP là chạm mức màu tối đa). Không hỗ trợ tooltip giải thích mức màu.
    *   **Daily Quests (Nhiệm vụ hàng ngày)**: Hiển thị các nhiệm vụ kiểu RPG cập nhật theo múi giờ Việt Nam. UI hiển thị danh sách dạng Checkbox kết hợp tag mức độ Dễ/Trung bình/Khó, nhấn mạnh nổi bật phần thưởng thêm khi hoàn thành toàn bộ (All-clear Bonus EXP).
    *   **Streak (Chuỗi ngày kỷ luật)**: Thiết kế hiển thị trạng thái chuỗi ngọn lửa. Tích hợp cơ chế Modal Popup "Streak Lost" sẽ tự động bật ra thông báo nhắc nhở để tạo tâm lý tiếc nuối khi người dùng quên học dẫn tới đứt chuỗi.

### 2.8. Tài khoản, Bảo mật & Trải nghiệm
*   **Auth & Profile UI**: Bảo mật danh tính bằng Firebase Auth. Tại Header của app tích hợp Modal Profile trực quan. Tích hợp tính năng Upload ảnh đại diện với thanh hiển thị spinner tiến trình ảo, qua lớp chặn validate phía Client (dung lượng <= 5MB, chuẩn file ảnh) trước khi tải lên kho lưu trữ Cloudinary.
*   **Dark Mode / Light Mode**: Giao diện hỗ trợ chuyển đổi giao diện sáng-tối theo môi trường hệ thống. Toggle được đặt ở Layout Component và lưu lại preferences trên LocalStorage.
*   **Anti-Spam (API Rate Limit & Idempotency)**: 
    *   Redis theo dõi lưu lượng: Max 3 lần sinh Quiz/10 phút, 5 giải thích Flashcard/1 phút. UI hứng lỗi HTTP 429 và bắn Toast Notification màu đỏ "Vui lòng thử lại sau".
    *   Mỗi hành động Gamification (Cộng điểm xem bài, học thẻ) đều có Key định danh (Idempotency), tránh tình trạng lag mạng dẫn tới Client gửi yêu cầu 2 lần khiến user nhận được x2 điểm kinh nghiệm lỗi.

---

## 3. Công nghệ phần mềm cốt lõi
*   **Frontend**: Dựng trên React 18 & Vite, ngôn ngữ TypeScript kiểm tra tĩnh. Định hình mảng giao diện với Tailwind CSS, Motion/React cho Animation hoạt ảnh tĩnh và Radix UI cho các Modal chức năng. Kiến trúc định tuyến mượt mà cùng React Router.
*   **Backend**: Python FastAPI hiệu năng cao, SQLAlchemy thao tác DB MySQL. Khóa dữ liệu và bộ đệm (Caching) nhờ sức mạnh của Redis. Alembic chịu trách nhiệm hệ thống hóa lịch sử Database Migration.
*   **Đảm bảo chất lượng (QA & Testing)**: Backend được back bởi một số lượng lớn unit/integration tests sử dụng Pytest kết hợp monkeypatch Mocking. Frontend sử dụng Vitest.
*   **Generative AI**: Lõi Gemini API (Phiên bản Flash tối ưu tốc độ cho Streaming Chat/Flashcard, phiển bản Pro chuyên định tuyến phức tạp cho Quiz và Parser). 
*   **Hạ tầng Dịch vụ (PaaS)**: Giao phó hoàn toàn lớp đăng nhập/bảo mật cho Firebase; Lưu trữ phân phối ảnh đại diện tốc độ cao cho Cloudinary. Dựng môi trường bằng Docker.