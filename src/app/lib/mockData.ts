import { WeekModule, LessonContent, QuizQuestion, Flashcard, ActivityDay, UserStats } from './types';

export const defaultUserStats: UserStats = {
  name: 'Học Viên',
  email: '',
  avatarUrl: null,
  level: 7,
  exp: 3450,
  expToNextLevel: 5000,
  streak: 12,
  totalLessons: 24,
  totalDays: 18,
};

export const generateActivityData = (): ActivityDay[] => {
  const data: ActivityDay[] = [];
  const today = new Date();
  for (let i = 364; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    // Generate realistic activity pattern
    const rand = Math.random();
    let count = 0;
    if (rand > 0.55) count = Math.floor(Math.random() * 3) + 1;
    if (rand > 0.8) count = Math.floor(Math.random() * 4) + 3;
    if (rand > 0.95) count = Math.floor(Math.random() * 3) + 7;
    // More recent dates more active
    if (i < 30 && rand > 0.4) count = Math.max(count, Math.floor(Math.random() * 5) + 1);
    data.push({ date: dateStr, count });
  }
  return data;
};

export const mockRoadmap: WeekModule[] = [
  {
    id: 'week-1',
    weekNumber: 1,
    title: 'Python Cơ Bản',
    description: 'Nền tảng lập trình Python: cú pháp, biến, kiểu dữ liệu và cấu trúc điều khiển.',
    completed: true,
    expanded: true,
    lessons: [
      { id: 'l1-1', title: 'Biến & Kiểu Dữ Liệu', duration: '45 phút', completed: true, type: 'theory', description: 'int, float, str, bool' },
      { id: 'l1-2', title: 'Cấu Trúc Điều Kiện & Vòng Lặp', duration: '60 phút', completed: true, type: 'practice', description: 'if/elif/else, for, while' },
      { id: 'l1-3', title: 'Hàm & Modules', duration: '50 phút', completed: true, type: 'theory', description: 'def, lambda, import' },
      { id: 'l1-4', title: 'Cấu Trúc Dữ Liệu', duration: '70 phút', completed: true, type: 'practice', description: 'List, Dict, Set, Tuple' },
    ],
  },
  {
    id: 'week-2',
    weekNumber: 2,
    title: 'NumPy & Pandas',
    description: 'Thư viện xử lý dữ liệu số và bảng tính mạnh mẽ nhất trong Python.',
    completed: false,
    expanded: true,
    lessons: [
      { id: 'l2-1', title: 'Giới Thiệu NumPy', duration: '40 phút', completed: true, type: 'theory', description: 'Arrays, shapes, dtypes' },
      { id: 'l2-2', title: 'NumPy Operations', duration: '55 phút', completed: true, type: 'practice', description: 'Broadcasting, indexing, slicing' },
      { id: 'l2-3', title: 'Giới Thiệu Pandas', duration: '50 phút', completed: false, type: 'theory', description: 'Series, DataFrame' },
      { id: 'l2-4', title: 'DataFrame Nâng Cao', duration: '65 phút', completed: false, type: 'practice', description: 'groupby, merge, pivot' },
      { id: 'l2-5', title: 'Đọc & Ghi Dữ Liệu', duration: '35 phút', completed: false, type: 'project', description: 'CSV, Excel, JSON' },
    ],
  },
  {
    id: 'week-3',
    weekNumber: 3,
    title: 'Phân Tích & Trực Quan Hóa',
    description: 'Khám phá, làm sạch dữ liệu và tạo biểu đồ đẹp mắt.',
    completed: false,
    expanded: false,
    lessons: [
      { id: 'l3-1', title: 'Làm Sạch Dữ Liệu', duration: '60 phút', completed: false, type: 'practice', description: 'Missing values, duplicates' },
      { id: 'l3-2', title: 'Thống Kê Mô Tả', duration: '45 phút', completed: false, type: 'theory', description: 'mean, median, std, correlation' },
      { id: 'l3-3', title: 'Matplotlib Cơ Bản', duration: '50 phút', completed: false, type: 'practice', description: 'Line, bar, scatter, pie charts' },
      { id: 'l3-4', title: 'Seaborn Nâng Cao', duration: '55 phút', completed: false, type: 'practice', description: 'heatmap, pairplot, violin' },
    ],
  },
  {
    id: 'week-4',
    weekNumber: 4,
    title: 'Dự Án Thực Tế',
    description: 'Áp dụng toàn bộ kiến thức vào phân tích bộ dữ liệu thực tế.',
    completed: false,
    expanded: false,
    lessons: [
      { id: 'l4-1', title: 'EDA - Khám Phá Dữ Liệu', duration: '90 phút', completed: false, type: 'project', description: 'Exploratory Data Analysis' },
      { id: 'l4-2', title: 'Case Study: Sales Data', duration: '120 phút', completed: false, type: 'project', description: 'Phân tích dữ liệu bán hàng' },
      { id: 'l4-3', title: 'Báo Cáo & Trình Bày', duration: '60 phút', completed: false, type: 'project', description: 'Jupyter Notebook, storytelling' },
      { id: 'l4-4', title: 'Đánh Giá Cuối Khóa', duration: '45 phút', completed: false, type: 'project', description: 'Review & next steps' },
    ],
  },
];

export const lessonContentMap: Record<string, LessonContent> = {
  'l2-3': {
    title: 'Giới Thiệu Pandas',
    theory: `## Pandas là gì?

Pandas là thư viện Python mã nguồn mở được xây dựng trên nền tảng NumPy, cung cấp cấu trúc dữ liệu và công cụ phân tích hiệu suất cao.

### Hai cấu trúc dữ liệu cốt lõi:

**1. Series** — Mảng một chiều có nhãn (label), giống như một cột trong bảng tính:
- Có thể chứa bất kỳ kiểu dữ liệu nào
- Mỗi phần tử có một chỉ số (index)
- Hỗ trợ phép tính vector hóa

**2. DataFrame** — Cấu trúc dữ liệu hai chiều như một bảng tính:
- Gồm nhiều Series (cột) chia sẻ cùng một index
- Mỗi cột có thể có kiểu dữ liệu khác nhau
- Là cấu trúc chính để làm việc với dữ liệu dạng bảng

### Tại sao Pandas quan trọng?
Pandas được sử dụng trong hơn **90% các dự án Data Science Python** vì khả năng xử lý dữ liệu nhanh chóng, trực quan và tích hợp tốt với các thư viện khác như Matplotlib, Scikit-learn.`,
    examples: [
      {
        title: 'Tạo Series',
        code: `import pandas as pd
import numpy as np

# Tạo Series từ list
scores = pd.Series([85, 92, 78, 95, 88], 
                   index=['An', 'Bình', 'Chi', 'Dung', 'Em'])
print(scores)
# An      85
# Bình    92
# Chi     78
# Dung    95
# Em      88

# Truy cập phần tử
print(scores['An'])     # 85
print(scores.mean())    # 87.6`,
        description: 'Khởi tạo Series với custom index để dễ truy cập bằng nhãn.',
      },
      {
        title: 'Tạo DataFrame',
        code: `# Tạo DataFrame từ dictionary
data = {
    'Tên': ['An', 'Bình', 'Chi', 'Dung'],
    'Tuổi': [22, 25, 23, 28],
    'Điểm': [85, 92, 78, 95],
    'Thành_Phố': ['HN', 'HCM', 'DN', 'HN']
}

df = pd.DataFrame(data)
print(df)
#     Tên  Tuổi  Điểm Thành_Phố
# 0    An    22    85        HN
# 1  Bình    25    92       HCM
# 2   Chi    23    78        DN
# 3  Dung    28    95        HN

# Thông tin cơ bản
print(df.shape)   # (4, 4)
print(df.dtypes)  # xem kiểu dữ liệu từng cột
print(df.describe())  # thống kê mô tả`,
        description: 'Tạo DataFrame từ dictionary Python, cách phổ biến nhất trong thực tế.',
      },
      {
        title: 'Truy Cập Dữ Liệu',
        code: `# Chọn cột
print(df['Điểm'])            # chọn 1 cột → Series
print(df[['Tên', 'Điểm']])  # chọn nhiều cột → DataFrame

# Chọn hàng với .loc (theo label)
print(df.loc[0])             # hàng đầu tiên
print(df.loc[0:2])           # hàng 0 đến 2

# Chọn hàng với .iloc (theo vị trí số)
print(df.iloc[0])            # hàng index 0
print(df.iloc[-1])           # hàng cuối cùng

# Lọc dữ liệu (Filtering)
high_score = df[df['Điểm'] > 85]
hn_students = df[df['Thành_Phố'] == 'HN']
print(high_score)`,
        description: 'Kỹ thuật truy cập và lọc dữ liệu trong DataFrame.',
      },
    ],
    keyPoints: ['Series là mảng 1D có nhãn', 'DataFrame là bảng 2D gồm nhiều Series', '.loc truy cập theo nhãn, .iloc theo số', 'Boolean indexing để lọc dữ liệu'],
  },
  'l1-1': {
    title: 'Biến & Kiểu Dữ Liệu Python',
    theory: `## Biến trong Python

Python là ngôn ngữ **dynamically typed** — bạn không cần khai báo kiểu dữ liệu, Python tự suy luận.

### Các kiểu dữ liệu cơ bản:

**Số (Numeric):**
- \`int\` — Số nguyên: \`42\`, \`-7\`, \`0\`
- \`float\` — Số thực: \`3.14\`, \`-0.5\`, \`1e10\`
- \`complex\` — Số phức: \`3+4j\`

**Chuỗi (String):**
- \`str\` — Văn bản: \`"Hello"\`, \`'Python'\`
- Immutable (không thể thay đổi sau khi tạo)
- Hỗ trợ nhiều phương thức: \`.upper()\`, \`.split()\`, \`.replace()\`

**Logic (Boolean):**
- \`bool\` — \`True\` hoặc \`False\`
- Kết quả của phép so sánh: \`5 > 3\` → \`True\`

**Không có giá trị:**
- \`None\` — Tương đương \`null\` trong các ngôn ngữ khác`,
    examples: [
      {
        title: 'Khai báo biến cơ bản',
        code: `# Python tự nhận diện kiểu dữ liệu
name = "Nguyễn Văn A"    # str
age = 22                  # int
height = 1.75             # float
is_student = True         # bool
gpa = None                # NoneType

# Kiểm tra kiểu dữ liệu
print(type(name))    # <class 'str'>
print(type(age))     # <class 'int'>

# Chuyển đổi kiểu (Type Casting)
str_num = "42"
num = int(str_num)   # "42" → 42
pi = float("3.14")   # "3.14" → 3.14`,
        description: 'Cách khai báo biến và chuyển đổi giữa các kiểu dữ liệu.',
      },
    ],
    keyPoints: ['Python tự động nhận diện kiểu dữ liệu', 'int, float, str, bool là 4 kiểu cơ bản', 'type() để kiểm tra kiểu', 'int(), str(), float() để chuyển đổi'],
  },
};

export const mockQuizQuestions: QuizQuestion[] = [
  {
    id: 'q1',
    question: 'Trong Pandas, sự khác biệt giữa `.loc[]` và `.iloc[]` là gì?',
    options: [
      { option_key: 'A', text: 'Không có sự khác biệt, cả hai đều làm cùng một việc' },
      { option_key: 'B', text: '`.loc[]` truy cập theo nhãn (label), `.iloc[]` truy cập theo vị trí số nguyên' },
      { option_key: 'C', text: '`.iloc[]` truy cập theo nhãn (label), `.loc[]` truy cập theo vị trí số nguyên' },
      { option_key: 'D', text: '`.loc[]` chỉ dùng cho Series, `.iloc[]` chỉ dùng cho DataFrame' },
    ],
    correctIndex: 1,
    explanation: 'Đúng! `.loc[]` sử dụng nhãn (label-based indexing) trong khi `.iloc[]` sử dụng vị trí số nguyên (integer position-based indexing). Ví dụ: nếu index của DataFrame là [\'a\', \'b\', \'c\'], thì `df.loc[\'a\']` lấy hàng có nhãn \'a\', còn `df.iloc[0]` lấy hàng đầu tiên bất kể nhãn là gì.',
  },
  {
    id: 'q2',
    question: 'Kết quả của `pd.Series([1, 2, 3]).mean()` là bao nhiêu?',
    options: [
      { option_key: 'A', text: '1' },
      { option_key: 'B', text: '2' },
      { option_key: 'C', text: '3' },
      { option_key: 'D', text: '6' },
    ],
    correctIndex: 1,
    explanation: 'Mean (trung bình cộng) = (1 + 2 + 3) / 3 = 6 / 3 = 2. Phương thức `.mean()` trong Pandas tính giá trị trung bình của tất cả phần tử trong Series.',
  },
  {
    id: 'q3',
    question: 'Cú pháp nào dùng để lọc các hàng trong DataFrame `df` có giá trị cột "Điểm" lớn hơn 80?',
    options: [
      { option_key: 'A', text: 'df.filter(df["Điểm"] > 80)' },
      { option_key: 'B', text: 'df[df["Điểm"] > 80]' },
      { option_key: 'C', text: 'df.where("Điểm > 80")' },
      { option_key: 'D', text: 'df.select(Điểm > 80)' },
    ],
    correctIndex: 1,
    explanation: 'Boolean indexing `df[df["Điểm"] > 80]` là cách chuẩn để lọc DataFrame. Biểu thức `df["Điểm"] > 80` tạo ra một Series boolean (True/False) và khi dùng làm mask cho DataFrame, chỉ các hàng có giá trị True mới được giữ lại.',
  },
  {
    id: 'q4',
    question: 'Kiểu dữ liệu nào phù hợp nhất để lưu trữ giá trị True/False trong Python?',
    options: [
      { option_key: 'A', text: 'int' },
      { option_key: 'B', text: 'str' },
      { option_key: 'C', text: 'bool' },
      { option_key: 'D', text: 'float' },
    ],
    correctIndex: 2,
    explanation: '`bool` là kiểu dữ liệu chuyên dùng cho giá trị True/False. Tuy nhiên, Python cũng cho phép dùng int (0 = False, 1 = True) nhưng `bool` rõ ràng và semantic hơn.',
  },
  {
    id: 'q5',
    question: 'Phương thức nào của Pandas dùng để hiển thị thông tin tổng quan về DataFrame (shape, dtypes, non-null)?',
    options: [
      { option_key: 'A', text: '.describe()' },
      { option_key: 'B', text: '.summary()' },
      { option_key: 'C', text: '.info()' },
      { option_key: 'D', text: '.stats()' },
    ],
    correctIndex: 2,
    explanation: '`.info()` hiển thị thông tin tổng quan về DataFrame bao gồm số hàng, số cột, kiểu dữ liệu và số lượng non-null values. Trong khi đó `.describe()` chỉ hiển thị thống kê mô tả cho các cột số.',
  },
];

export const mockFlashcards: Flashcard[] = [
  { id: 'fc1', front: 'DataFrame trong Pandas là gì?', back: 'Cấu trúc dữ liệu 2 chiều như bảng tính, gồm hàng và cột. Mỗi cột là một Series chia sẻ cùng index.' },
  { id: 'fc2', front: 'Series trong Pandas là gì?', back: 'Mảng 1 chiều có nhãn (label-indexed). Giống như một cột trong DataFrame hoặc một mảng NumPy có index.' },
  { id: 'fc3', front: 'Sự khác biệt giữa .loc và .iloc?', back: '.loc[] truy cập theo nhãn/label. .iloc[] truy cập theo vị trí số nguyên (integer position).' },
  { id: 'fc4', front: 'Boolean Indexing là gì?', back: 'Kỹ thuật lọc dữ liệu bằng điều kiện True/False. VD: df[df["age"] > 18] trả về các hàng có age > 18.' },
  { id: 'fc5', front: 'Phương thức .describe() làm gì?', back: 'Tính các chỉ số thống kê: count, mean, std, min, 25%, 50%, 75%, max cho các cột số trong DataFrame.' },
  { id: 'fc6', front: 'Cách tạo DataFrame từ dictionary?', back: 'pd.DataFrame({"col1": [1,2,3], "col2": ["a","b","c"]}). Keys là tên cột, values là list dữ liệu.' },
];

export const suggestedGoals = [
  'Học Python cơ bản để phân tích dữ liệu trong 4 tuần',
  'Master JavaScript và React để làm Web Developer trong 8 tuần',
  'Học Machine Learning từ đầu với Python trong 6 tuần',
  'Nắm vững SQL và Database Design trong 3 tuần',
  'Học UI/UX Design và Figma từ cơ bản đến nâng cao trong 5 tuần',
];
