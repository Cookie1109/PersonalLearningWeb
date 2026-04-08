import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Camera, FileImage, FilePlus2, FileText, Link2, Loader2, Sparkles, Type } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router';
import { createDocument, extractTextFromParser } from '../../api/learning';

type InputMode = 'text' | 'url' | 'file' | 'image';

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export default function DocumentCreate() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const docFileInputRef = useRef<HTMLInputElement | null>(null);
  const imageFileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  const [title, setTitle] = useState('');
  const [sourceContent, setSourceContent] = useState('');
  const [inputMode, setInputMode] = useState<InputMode>('text');
  const [sourceUrl, setSourceUrl] = useState('');
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractSuccess, setExtractSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const normalizedTitle = title.trim();
  const normalizedContent = sourceContent.trim();
  const isTitleInvalid = normalizedTitle.length > 0 && normalizedTitle.length < 3;
  const isContentInvalid = normalizedContent.length > 0 && normalizedContent.length < 30;

  useEffect(() => {
    const suggestedTitle = searchParams.get('title')?.trim();
    if (suggestedTitle && !title.trim()) {
      setTitle(suggestedTitle);
    }
  }, [searchParams, title]);

  const resetExtractFeedback = () => {
    setExtractError(null);
    setExtractSuccess(null);
  };

  const handleModeSwitch = (mode: InputMode) => {
    setInputMode(mode);
    resetExtractFeedback();
  };

  const applyExtractedText = (text: string, sourceType: string) => {
    const normalized = text.trim();
    if (!normalized) {
      throw new Error('Khong trich xuat duoc van ban ro rang. Vui long thu nguon khac.');
    }

    setSourceContent(normalized);
    setExtractSuccess(`Da trich xuat noi dung tu ${sourceType}. Ban co the xem va chinh sua ben duoi.`);
  };

  const handleExtractFromUrl = async () => {
    const normalizedUrl = sourceUrl.trim();
    if (!normalizedUrl) {
      setExtractError('Vui long nhap URL truoc khi trich xuat.');
      return;
    }

    resetExtractFeedback();
    setIsExtracting(true);

    try {
      const result = await extractTextFromParser({ mode: 'url', url: normalizedUrl });
      applyExtractedText(result.extracted_text, 'link');
    } catch (error) {
      if (error instanceof Error) {
        setExtractError(error.message);
      } else {
        setExtractError('Khong the trich xuat noi dung tu link luc nay.');
      }
    } finally {
      setIsExtracting(false);
    }
  };

  const extractFromFile = async (file: File) => {
    if (!file) {
      return;
    }

    if (file.size <= 0) {
      setExtractError('File rong hoac khong hop le. Vui long chon file khac.');
      return;
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      setExtractError('File qua lon. Vui long chon file nho hon 15MB.');
      return;
    }

    resetExtractFeedback();
    setIsExtracting(true);
    setSelectedFileName(file.name);

    try {
      const result = await extractTextFromParser({ mode: 'file', file });
      const sourceLabel = result.source_type === 'image' ? 'anh' : 'tai lieu';
      applyExtractedText(result.extracted_text, sourceLabel);
    } catch (error) {
      if (error instanceof Error) {
        setExtractError(error.message);
      } else {
        setExtractError('Khong the trich xuat noi dung tu file luc nay.');
      }
    } finally {
      setIsExtracting(false);
    }
  };

  const handleDocFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    void extractFromFile(file);
  };

  const handleImageFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    void extractFromFile(file);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting || isExtracting || isTitleInvalid || isContentInvalid || !normalizedTitle || !normalizedContent) {
      return;
    }

    setSubmitError(null);
    setIsSubmitting(true);

    try {
      const result = await createDocument({
        title: normalizedTitle,
        source_content: normalizedContent,
      });
      navigate(`/learn/${result.document_id}`, { replace: true });
    } catch (error) {
      if (error instanceof Error) {
        setSubmitError(error.message);
      } else {
        setSubmitError('Khong the tao Workspace luc nay.');
      }
    } finally {
      setIsSubmitting(false);
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
            <h1 className="text-2xl text-white" style={{ fontWeight: 700 }}>Tao NotebookLM Mini Workspace</h1>
            <p className="text-zinc-500 text-sm">Nhap tieu de va dan tai lieu goc de he thong tao Theory, Quiz, Flashcard ngay.</p>
          </div>
        </div>
      </motion.div>

      <motion.form
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
        onSubmit={handleSubmit}
        className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-5"
      >
        <div>
          <label htmlFor="document-title" className="block text-sm text-zinc-300 mb-2" style={{ fontWeight: 600 }}>
            Tieu de tai lieu
          </label>
          <input
            id="document-title"
            value={title}
            onChange={event => setTitle(event.target.value)}
            disabled={isSubmitting}
            placeholder="Vi du: Data Structures Midterm Notes"
            className="w-full rounded-xl bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-zinc-100 text-sm placeholder:text-zinc-600 outline-none focus:border-cyan-500/60"
          />
          {isTitleInvalid && (
            <p className="mt-2 text-xs text-amber-300">Tieu de can toi thieu 3 ky tu.</p>
          )}
        </div>

        <div>
          <label htmlFor="source-content" className="block text-sm text-zinc-300 mb-2" style={{ fontWeight: 600 }}>
            Noi dung tai lieu goc
          </label>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            {[
              { mode: 'text' as const, icon: Type, label: 'Nhap Text' },
              { mode: 'url' as const, icon: Link2, label: 'Gan Link' },
              { mode: 'file' as const, icon: FileText, label: 'Tai PDF/DOCX' },
              { mode: 'image' as const, icon: FileImage, label: 'Tai Anh/Chup Anh' },
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
                      ? 'border-cyan-500/60 bg-cyan-500/20 text-cyan-200'
                      : 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                  }`}
                  style={{ fontWeight: 600 }}
                >
                  <Icon size={14} />{item.label}
                </button>
              );
            })}
          </div>

          {inputMode === 'url' && (
            <div className="mb-3 rounded-xl border border-zinc-700 bg-zinc-800/70 p-3">
              <label htmlFor="source-url" className="block text-xs text-zinc-400 mb-2">
                Dan URL bai viet de he thong trich xuat noi dung
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  id="source-url"
                  type="url"
                  value={sourceUrl}
                  onChange={event => setSourceUrl(event.target.value)}
                  disabled={isSubmitting || isExtracting}
                  placeholder="https://example.com/article"
                  className="flex-1 rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-cyan-500/60"
                />
                <button
                  type="button"
                  onClick={() => void handleExtractFromUrl()}
                  disabled={isSubmitting || isExtracting || !sourceUrl.trim()}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed px-3 py-2 text-sm text-white"
                  style={{ fontWeight: 600 }}
                >
                  {isExtracting ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}Trich xuat
                </button>
              </div>
            </div>
          )}

          {inputMode === 'file' && (
            <div className="mb-3 rounded-xl border border-zinc-700 bg-zinc-800/70 p-3">
              <p className="text-xs text-zinc-400 mb-2">Chon file PDF hoac DOCX. He thong se tu dong trich xuat ngay sau khi chon.</p>
              <input
                ref={docFileInputRef}
                type="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={handleDocFileChange}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => docFileInputRef.current?.click()}
                disabled={isSubmitting || isExtracting}
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-600 bg-zinc-900 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed px-3 py-2 text-sm text-zinc-100"
                style={{ fontWeight: 600 }}
              >
                <FileText size={14} />Chon file PDF/DOCX
              </button>
            </div>
          )}

          {inputMode === 'image' && (
            <div className="mb-3 rounded-xl border border-zinc-700 bg-zinc-800/70 p-3">
              <p className="text-xs text-zinc-400 mb-2">Tai anh JPG/PNG/WEBP hoac chup anh tren dien thoai de OCR.</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  ref={imageFileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/webp"
                  onChange={handleImageFileChange}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => imageFileInputRef.current?.click()}
                  disabled={isSubmitting || isExtracting}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-600 bg-zinc-900 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed px-3 py-2 text-sm text-zinc-100"
                  style={{ fontWeight: 600 }}
                >
                  <FileImage size={14} />Tai anh len
                </button>

                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleImageFileChange}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  disabled={isSubmitting || isExtracting}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-600 bg-zinc-900 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed px-3 py-2 text-sm text-zinc-100"
                  style={{ fontWeight: 600 }}
                >
                  <Camera size={14} />Chup anh
                </button>
              </div>
            </div>
          )}

          {isExtracting && (
            <div className="mb-3 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-200 inline-flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" />Dang trich xuat noi dung...
            </div>
          )}

          {selectedFileName && (
            <p className="mb-2 text-xs text-zinc-500">Nguon gan nhat: {selectedFileName}</p>
          )}

          {extractError && (
            <div className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {extractError}
            </div>
          )}

          {extractSuccess && (
            <div className="mb-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
              {extractSuccess}
            </div>
          )}

          <textarea
            id="source-content"
            value={sourceContent}
            onChange={event => setSourceContent(event.target.value)}
            disabled={isSubmitting || isExtracting}
            rows={16}
            placeholder="Dan noi dung de cuong/slide/tai lieu vao day..."
            className="w-full rounded-xl bg-zinc-800 border border-zinc-700 px-4 py-3 text-zinc-100 text-sm leading-relaxed placeholder:text-zinc-600 outline-none focus:border-cyan-500/60 resize-y min-h-[320px]"
          />
          {isContentInvalid && (
            <p className="mt-2 text-xs text-amber-300">Noi dung tai lieu can toi thieu 30 ky tu.</p>
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
            disabled={isSubmitting || isExtracting || isTitleInvalid || isContentInvalid || !normalizedTitle || !normalizedContent}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm transition-colors"
            style={{ fontWeight: 600 }}
          >
            {isSubmitting ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            {isSubmitting ? 'Dang tao Workspace...' : 'Tao Workspace'}
          </button>
        </div>
      </motion.form>
    </div>
  );
}
