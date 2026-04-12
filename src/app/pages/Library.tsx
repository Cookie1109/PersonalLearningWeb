import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useNavigate } from 'react-router';
import { BookOpen, CalendarDays, CheckSquare, LibraryBig, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { getMyDocuments, MyDocument } from '../../api/learning';

const shortDateFormatter = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

function formatDocumentDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Không rõ ngày tạo';
  }
  return shortDateFormatter.format(date);
}

function LoadingState() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
      {[...Array(6)].map((_, index) => (
        <div
          key={`library-skeleton-${index}`}
          className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5 space-y-3"
        >
          <div className="h-4 rounded bg-zinc-800/90 w-3/4 animate-pulse" />
          <div className="h-3 rounded bg-zinc-800/80 w-1/2 animate-pulse" />
          <div className="h-8 rounded-xl bg-zinc-800/80 w-full animate-pulse mt-4" />
        </div>
      ))}
    </div>
  );
}

export default function Library() {
  const navigate = useNavigate();
  const [documents, setDocuments] = useState<MyDocument[]>([]);
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const selectedSet = useMemo(() => new Set(selectedDocuments), [selectedDocuments]);

  const loadDocuments = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const data = await getMyDocuments();
      setDocuments(data);
      setSelectedDocuments(prev => prev.filter(id => data.some(doc => doc.id === id)));
    } catch (error) {
      if (error instanceof Error) {
        setLoadError(error.message);
      } else {
        setLoadError('Không thể tải danh sách tài liệu lúc này.');
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  const toggleSelection = (documentId: string) => {
    setSelectedDocuments(prev => (
      prev.includes(documentId)
        ? prev.filter(id => id !== documentId)
        : [...prev, documentId]
    ));
  };

  const handleMegaQuizClick = () => {
    toast.info('Tính năng đang được phát triển');
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 pb-28 space-y-6">
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-cyan-600 flex items-center justify-center">
            <LibraryBig size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl text-slate-900 dark:text-white" style={{ fontWeight: 700 }}>Thư viện tài liệu</h1>
          </div>
        </div>
      </motion.div>

      {isLoading ? (
        <LoadingState />
      ) : loadError ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-5">
          <p className="text-sm text-red-300">{loadError}</p>
          <button
            type="button"
            onClick={() => void loadDocuments()}
            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 border border-slate-300 dark:border-zinc-700 px-4 py-2 text-sm text-slate-700 dark:text-zinc-100"
          >
            <Loader2 size={14} />Thử tải lại
          </button>
        </div>
      ) : documents.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-zinc-800 mx-auto flex items-center justify-center">
            <BookOpen size={24} className="text-slate-500 dark:text-zinc-400" />
          </div>
          <h2 className="text-lg text-slate-900 dark:text-white mt-4" style={{ fontWeight: 600 }}>Chưa có tài liệu nào</h2>
          <p className="text-sm text-slate-600 dark:text-zinc-500 mt-1">Hãy tạo Workspace đầu tiên để bắt đầu xây dựng thư viện tài liệu.</p>
          <button
            type="button"
            onClick={() => navigate('/create')}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 px-4 py-2 text-sm text-white"
            style={{ fontWeight: 600 }}
          >
            <Sparkles size={14} />Tạo Workspace
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {documents.map(document => {
            const isSelected = selectedSet.has(document.id);

            return (
              <motion.div
                key={document.id}
                whileHover={{ y: -3 }}
                transition={{ duration: 0.2 }}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/learn/${document.id}`)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    navigate(`/learn/${document.id}`);
                  }
                }}
                className={`relative cursor-pointer rounded-2xl border p-5 transition-all duration-200 ${
                  isSelected
                    ? 'border-cyan-300 dark:border-cyan-500/60 bg-cyan-50 dark:bg-cyan-500/10 shadow-[0_0_0_1px_rgba(8,145,178,0.2)] dark:shadow-[0_0_0_1px_rgba(34,211,238,0.15)]'
                    : 'border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-slate-300 dark:hover:border-zinc-600 hover:bg-slate-50 dark:hover:bg-zinc-900/90'
                }`}
              >
                <div
                  onClick={event => event.stopPropagation()}
                  onKeyDown={event => event.stopPropagation()}
                  className="absolute right-3 top-3"
                >
                  <label className="inline-flex items-center gap-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white/95 dark:bg-zinc-950/80 px-2 py-1 text-xs text-slate-700 dark:text-zinc-200">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelection(document.id)}
                      className="h-3.5 w-3.5 accent-cyan-500"
                      aria-label={`Chọn tài liệu ${document.title}`}
                    />
                    Chọn
                  </label>
                </div>

                <h3 className="text-base text-slate-900 dark:text-white pr-16 leading-snug" style={{ fontWeight: 600 }}>
                  {document.title}
                </h3>

                <div className="mt-3 flex items-center gap-2 text-xs text-slate-500 dark:text-zinc-500">
                  <CalendarDays size={13} />
                  <span>Tạo ngày {formatDocumentDate(document.createdAt)}</span>
                </div>

                <div className="mt-5 inline-flex items-center gap-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800/80 px-2.5 py-1 text-xs text-slate-600 dark:text-zinc-300">
                  <BookOpen size={13} />
                  Mở Learning Workspace
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      <AnimatePresence>
        {selectedDocuments.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            className="fixed bottom-5 left-1/2 -translate-x-1/2 z-30 w-[min(95vw,720px)]"
          >
            <div className="rounded-2xl border border-cyan-300 dark:border-cyan-500/40 bg-white/95 dark:bg-zinc-900/95 backdrop-blur px-4 py-3 shadow-2xl">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="inline-flex items-center gap-2 text-cyan-700 dark:text-cyan-200 text-sm" style={{ fontWeight: 600 }}>
                  <CheckSquare size={16} />Đã chọn {selectedDocuments.length} tài liệu
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedDocuments([])}
                    className="rounded-xl border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 px-3 py-2 text-xs text-slate-700 dark:text-zinc-200"
                    style={{ fontWeight: 600 }}
                  >
                    Bỏ chọn
                  </button>
                  <button
                    type="button"
                    onClick={handleMegaQuizClick}
                    className="rounded-xl bg-cyan-600 hover:bg-cyan-500 px-4 py-2 text-sm text-white"
                    style={{ fontWeight: 700 }}
                  >
                    Tạo Mega Quiz (Sắp ra mắt)
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}




