import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { QuizResultDisplay, buildFlashcardsFromMarkdown } from './LearningWorkspace';

const quizQuestions = [
  {
    question_id: 'q1',
    text: '2 + 2 bang bao nhieu?',
    options: [
      { option_key: 'A', text: '4' },
      { option_key: 'B', text: '5' },
      { option_key: 'C', text: '6' },
      { option_key: 'D', text: '7' },
    ],
  },
];

describe('QuizResultDisplay explanation rendering', () => {
  it('render explanation khi ket qua câu tra loi dung neu backend tra ve explanation', () => {
    // Hien tai UI hien explanation cho moi câu neu backend co explanation.
    const submitResultFromApi = {
      score: 100,
      is_passed: true,
      exp_gained: 100,
      streak_bonus_exp: 0,
      total_exp: 200,
      level: 1,
      current_streak: 1,
      reward_granted: true,
      message: 'Quiz passed',
      results: [
        {
          question_id: 'q1',
          is_correct: true,
          selected_option: 'A',
          correct_answer: 'A',
          explanation: 'Nội dung này không được hiển thị vì câu đúng',
        },
      ],
    };

    render(
      <QuizResultDisplay
        quizResult={submitResultFromApi}
        quizQuestions={quizQuestions}
        onRetry={vi.fn()}
        onBackToTheory={vi.fn()}
        onRegenerate={vi.fn()}
        isRegenerating={false}
        isRegenerateDisabled={false}
        regenerateTooltip=""
        regenerationCount={0}
      />
    );

    expect(screen.getByText(/Giải thích/i)).toBeInTheDocument();
    expect(screen.getByText('Nội dung này không được hiển thị vì câu đúng')).toBeInTheDocument();
  });

  it('render explanation khi ket qua câu tra loi sai', () => {
    // Mock du lieu API submit quiz: câu tra loi sai co explanation.
    const submitResultFromApi = {
      score: 0,
      is_passed: false,
      exp_gained: 0,
      streak_bonus_exp: 0,
      total_exp: 100,
      level: 1,
      current_streak: 0,
      reward_granted: false,
      message: 'Quiz not passed',
      results: [
        {
          question_id: 'q1',
          is_correct: false,
          selected_option: 'B',
          correct_answer: 'A',
          explanation: 'Đây là giải thích chi tiết',
        },
      ],
    };

    render(
      <QuizResultDisplay
        quizResult={submitResultFromApi}
        quizQuestions={quizQuestions}
        onRetry={vi.fn()}
        onBackToTheory={vi.fn()}
        onRegenerate={vi.fn()}
        isRegenerating={false}
        isRegenerateDisabled={false}
        regenerateTooltip=""
        regenerationCount={0}
      />
    );

    expect(screen.getByText('Đây là giải thích chi tiết')).toBeInTheDocument();
    expect(screen.getAllByText(/Giải thích/i).length).toBeGreaterThan(0);
  });
});

describe('buildFlashcardsFromMarkdown', () => {
  it('tao flashcard co nghia, đang hoi-dap, va loai bo câu mo dau nhieu', () => {
    const markdown = `
## Moi truong phat trien
Trong bài học này, chung ta se cung nhau tim hieu tong quan.
Compiler la chuong trinh bien ma nguon thanh ma may.
Neu code sai cu phap thi compiler bao loi ngày.

## Quy trinh cai đạt
1. Cai đạt compiler phu hop he dieu hanh.
2. Câu hinh IDE de goi y va debug.

## Câu hinh
Compiler: GCC hoac Clang.
`;

    const cards = buildFlashcardsFromMarkdown(markdown, 8);

    expect(cards.length).toBeGreaterThan(0);
    expect(cards.some(card => /\?$/.test(card.front) || card.front.startsWith('Điền vào chỗ trống:'))).toBe(true);
    expect(cards.some(card => /Khai niem/i.test(card.front))).toBe(true);
    expect(cards.some(card => /buoc\s+1|mot buoc quan trong/i.test(card.front))).toBe(true);
    expect(cards.some(card => /Neu .*dieu gi xay ra\?/i.test(card.front))).toBe(true);
    expect(cards.some(card => card.front.startsWith('Điền vào chỗ trống:'))).toBe(true);
    expect(cards.some(card => /Tinh huong IT/i.test(card.front))).toBe(true);
    expect(cards.every(card => !/Trong bài học này, chung ta se/i.test(card.back))).toBe(true);
  });

  it('giu moi the gon va mot y chinh', () => {
    const markdown = `
## Khoi tao
API được dung de trao doi du lieu giua frontend va backend.
Khi timeout xay ra thi can retry co gioi han de tranh request storm.

## Quy trinh
1. Xac thuc request.
2. Valiđạte du lieu dau vao.
3. Xu ly nghiep vu va tra response.
`;

    const cards = buildFlashcardsFromMarkdown(markdown, 8);

    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every(card => card.front.length <= 120)).toBe(true);
    expect(cards.every(card => card.back.length <= 220)).toBe(true);
    expect(cards.every(card => card.back.split('. ').length <= 2)).toBe(true);
  });
});



