import React, { FormEvent, useCallback, useState } from 'react';
import { motion } from 'motion/react';
import { FilePlus2, FileText, Link2, Loader2, Sparkles, Type, UploadCloud, X } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { createDocument, createDocumentFromUpload, extractTextFromParser } from '../../api/learning';

type InputMode = 'text' | 'url' | 'file';

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const MAX_RAW_TEXT_CHARS = 45000;
const TEXT_LIMIT_WARNING_THRESHOLD = 40000;
const DROPZONE_ACCEPT = {
  'application/pdf': ['.pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
};

function buildDefaultDocumentTitle(): string {
  return `Tài liệu mới - ${new Date().toLocaleDateString('vi-VN')}`;
}

function formatFileSize(sizeInBytes: number): string {
  if (!Number.isFinite(sizeInBytes) || sizeInBytes <= 0) {
    return '0 B';
  }
  if (sizeInBytes < 1024) {
    return `${sizeInBytes} B`;
  }
  if (sizeInBytes < 1024 * 1024) {
    return `${(sizeInBytes / 1024).toFixed(1)} KB`;
  }
  return `${(sizeInBytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function DocumentCreate() {
  const navigate = useNavigate();

  const [sourceContent, setSourceContent] = useState('');
  const [inputMode, setInputMode] = useState<InputMode>('text');
  const [sourceUrl, setSourceUrl] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitPhase, setSubmitPhase] = useState<'idle' | 'extracting' | 'creating'>('idle');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const normalizedContent = sourceContent.trim();
  const normalizedUrl = sourceUrl.trim();
  const isTextMode = inputMode === 'text';
  const sourceCharCount = sourceContent.length;
  const isNearTextLimit = sourceCharCount > TEXT_LIMIT_WARNING_THRESHOLD;
  const isAtTextLimit = sourceCharCount >= MAX_RAW_TEXT_CHARS;
  const isContentInvalid = normalizedContent.length > 0 && normalizedContent.length < 30;
  const hasInputForMode = isTextMode
    ? normalizedContent.length > 0
    : inputMode === 'url'
      ? normalizedUrl.length > 0
      : Boolean(selectedFile);

  const handleModeSwitch = (mode: InputMode) => {
    setInputMode(mode);
    setSubmitError(null);
    if (mode === 'url') {
      setSelectedFile(null);
    }
    if (mode === 'file') {
      setSourceUrl('');
    }
  };

  const ensureExtractedContent = (text: string) => {
    const normalized = text.trim();
    if (!normalized) {
      throw new Error('Không trích xuất được văn bản rõ ràng. Vui lòng thử nguồn khác.');
    }
    return normalized;
  };

  const selectInputFile = useCallback((file: File | undefined) => {
    if (!file) {
      return;
    }

    if (file.size <= 0) {
      const message = 'File rỗng hoặc không hợp lệ. Vui lòng chọn file khác.';
      setSubmitError(message);
      toast.error(message);
      return;
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      const message = 'File quá lớn. Vui lòng chọn file nhỏ hơn 15MB.';
      setSubmitError(message);
      toast.error(message);
      return;
    }

    setSubmitError(null);
    setSelectedFile(file);
  }, []);

  const handleDropAccepted = useCallback((acceptedFiles: File[]) => {
    selectInputFile(acceptedFiles[0]);
  }, [selectInputFile]);

  const handleDropRejected = useCallback(() => {
    const message = 'Chỉ hỗ trợ file PDF hoặc DOCX. Vui lòng chọn lại file hợp lệ.';
    setSubmitError(message);
    toast.error(message);
  }, []);

  const handleClearSelectedFile = useCallback(() => {
    setSelectedFile(null);
    setSubmitError(null);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDropAccepted: handleDropAccepted,
    onDropRejected: handleDropRejected,
    accept: DROPZONE_ACCEPT,
    multiple: false,
    disabled: isSubmitting,
  });

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    if (isTextMode && (isContentInvalid || !normalizedContent)) {
      return;
    }

    if (inputMode === 'url' && !normalizedUrl) {
      const message = 'Vui lòng nhập URL trước khi tạo Workspace.';
      setSubmitError(message);
      toast.error(message);
      return;
    }

    if (inputMode === 'file' && !selectedFile) {
      const message = 'Vui lòng chọn file trước khi tạo Workspace.';
      setSubmitError(message);
      toast.error(message);
      return;
    }

    setSubmitError(null);
    setIsSubmitting(true);
    setSubmitPhase('extracting');

    try {
      if (inputMode === 'file') {
        setSubmitPhase('creating');
        const result = await createDocumentFromUpload(selectedFile as File);
        navigate(`/learn/${result.document_id}`, { replace: true });
        return;
      }

      let contentForCreate = normalizedContent;
      let extractedTitleFromSource = '';
      if (inputMode === 'url') {
        const extractionResult = await extractTextFromParser({ mode: 'url', url: normalizedUrl });

        contentForCreate = ensureExtractedContent(extractionResult.extracted_text);
        extractedTitleFromSource = extractionResult.extracted_title?.trim() ?? '';
      }

      const preferredTitle = extractedTitleFromSource.trim();
      const titleForCreate = preferredTitle.length >= 3
        ? preferredTitle.slice(0, 255)
        : buildDefaultDocumentTitle();

      setSubmitPhase('creating');
      const result = await createDocument({
        title: titleForCreate,
        source_content: contentForCreate,
      });
      navigate(`/learn/${result.document_id}`, { replace: true });
    } catch (error) {
      if (error instanceof Error) {
        setSubmitError(error.message);
        const isTooLongError = error.message.includes('45.000') || error.message.toLowerCase().includes('quá dài');
        if (!isTooLongError) {
          toast.error(error.message);
        }
      } else {
        const message = 'Không thể tạo Workspace lúc này.';
        setSubmitError(message);
        toast.error(message);
      }
    } finally {
      setIsSubmitting(false);
      setSubmitPhase('idle');
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-cyan-600 flex items-center justify-center">
            <FilePlus2 size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl text-slate-900 dark:text-white" style={{ fontWeight: 700 }}>Tạo NEXL Workspace</h1>
  
          </div>
        </div>
      </motion.div>

      <motion.form
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
        onSubmit={handleSubmit}
        className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl p-6 space-y-5"
      >
        <div>
          <label className="block text-sm text-slate-700 dark:text-zinc-300 mb-2" style={{ fontWeight: 600 }}>
            Nguồn tài liệu
          </label>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
            {[
              { mode: 'text' as const, icon: Type, label: 'Nhập Text' },
              { mode: 'url' as const, icon: Link2, label: 'Gắn Link' },
              { mode: 'file' as const, icon: FileText, label: 'Tải PDF/DOCX' },
            ].map(item => {
              const Icon = item.icon;
              const isActive = inputMode === item.mode;
              return (
                <button
                  key={item.mode}
                  type="button"
                  onClick={() => handleModeSwitch(item.mode)}
                  className={`inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs sm:text-sm transition-colors ${
                    isActive
                      ? 'border-cyan-300 bg-cyan-100 text-cyan-800 dark:border-cyan-500/60 dark:bg-cyan-500/20 dark:text-cyan-200'
                      : 'border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-700'
                  }`}
                  style={{ fontWeight: 600 }}
                >
                  <Icon size={14} />{item.label}
                </button>
              );
            })}
          </div>

          {inputMode === 'url' && (
            <div className="mb-3 rounded-xl border border-slate-300 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-800/70 p-3">
              <label htmlFor="source-url" className="block text-xs text-slate-600 dark:text-zinc-400 mb-2">
                Dán URL bài viết để hệ thống trích xuất nội dung
              </label>
              <input
                id="source-url"
                type="url"
                value={sourceUrl}
                onChange={event => setSourceUrl(event.target.value)}
                disabled={isSubmitting}
                placeholder="https://example.com/article"
                className="w-full rounded-lg bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 px-3 py-2 text-sm text-slate-900 dark:text-zinc-100 placeholder:text-slate-400 dark:placeholder:text-zinc-600 outline-none focus:border-cyan-500/60"
              />
            </div>
          )}

          {inputMode === 'file' && (
            <div className="mb-3">
              {selectedFile ? (
                <div className="relative rounded-xl border border-slate-300 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-800/70 px-4 py-3">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 rounded-lg bg-cyan-100 p-2 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300">
                      <FileText size={16} />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm text-slate-900 dark:text-zinc-100" style={{ fontWeight: 600 }}>
                        {selectedFile.name}
                      </p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
                        {formatFileSize(selectedFile.size)}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleClearSelectedFile}
                    disabled={isSubmitting}
                    className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                    aria-label="Xóa file đã chọn"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <div
                  {...getRootProps()}
                  className={`rounded-2xl border-2 border-dashed py-12 px-6 text-center transition-colors ${
                    isDragActive
                      ? 'border-cyan-500 bg-cyan-50/20 dark:bg-cyan-900/20'
                      : 'border-slate-300 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-800/70'
                  } ${isSubmitting ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <input {...getInputProps()} />
                  <div className="mx-auto mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300">
                    <UploadCloud size={28} />
                  </div>
                  <p className="text-sm text-slate-900 dark:text-zinc-100" style={{ fontWeight: 700 }}>
                    Kéo thả file PDF/DOCX vào đây, hoặc click để chọn
                  </p>
                  <p className="mt-2 text-sm text-slate-500/90 dark:text-zinc-400/90">
                    Khuyên dùng: Tài liệu dưới 20 trang để có trải nghiệm AI tốt nhất.
                  </p>
                </div>
              )}
            </div>
          )}

            {isSubmitting && submitPhase === 'extracting' && !isTextMode && (
            <div className="mb-3 rounded-xl border border-cyan-400/40 bg-cyan-100 dark:bg-cyan-500/10 px-3 py-2 text-sm text-cyan-700 dark:text-cyan-200 inline-flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" />AI đang phân tích tài liệu...
            </div>
          )}

            {isTextMode && (
              <>
                <textarea
                  id="source-content"
                  value={sourceContent}
                  onChange={event => setSourceContent(event.target.value)}
                  disabled={isSubmitting}
                  maxLength={MAX_RAW_TEXT_CHARS}
                  rows={16}
                  placeholder="Dán nội dung đề cương/slide/tài liệu vào đây..."
                  className="w-full rounded-xl bg-white dark:bg-zinc-800 border border-slate-300 dark:border-zinc-700 px-4 py-3 text-slate-900 dark:text-zinc-100 text-sm leading-relaxed placeholder:text-slate-400 dark:placeholder:text-zinc-600 outline-none focus:border-cyan-500/60 resize-y min-h-[320px]"
                />
                <div className="mt-2 flex items-center justify-between gap-3">
                  {isContentInvalid ? (
                    <p className="text-xs text-amber-300">Nội dung tài liệu cần tối thiểu 30 ký tự.</p>
                  ) : (
                    <span className="text-xs text-transparent select-none">.</span>
                  )}
                  <p
                    className={`text-xs ${
                      isAtTextLimit
                        ? 'text-red-500 dark:text-red-400'
                        : isNearTextLimit
                          ? 'text-amber-500 dark:text-amber-300'
                          : 'text-slate-500 dark:text-zinc-500'
                    }`}
                  >
                    {sourceCharCount.toLocaleString('en-US')} / 45,000 ký tự
                  </p>
                </div>
              </>
            )}
        </div>

        {submitError && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {submitError}
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isSubmitting || (isTextMode && isContentInvalid) || !hasInputForMode}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm transition-colors"
            style={{ fontWeight: 600 }}
          >
            {isSubmitting ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            {isSubmitting && submitPhase === 'extracting'
              ? 'AI đang phân tích tài liệu...'
              : isSubmitting
                ? 'Đang tạo Workspace...'
                : 'Tạo Workspace'}
          </button>
        </div>
      </motion.form>
    </div>
  );
}



