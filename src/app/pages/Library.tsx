import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useNavigate } from 'react-router';
import { BookOpen, CalendarDays, ChevronLeft, ChevronRight, LibraryBig, Loader2, MoreVertical, Pencil, Search, Sparkles, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { deleteDocument, getMyDocumentsPaged, isRequestCanceledError, MyDocument, renameDocument } from '../../api/learning';

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

const LIBRARY_TITLE_MAX_LENGTH = 48;

function getDocumentsPerPageByWidth(width: number): number {
  if (width < 640) {
    return 6;
  }
  if (width < 1280) {
    return 8;
  }
  return 9;
}

function getInitialDocumentsPerPage(): number {
  if (typeof window === 'undefined') {
    return 9;
  }
  return getDocumentsPerPageByWidth(window.innerWidth);
}

function formatLibraryTitle(value: string): string {
  const normalized = (value || '').trim();
  if (normalized.length <= LIBRARY_TITLE_MAX_LENGTH) {
    return normalized;
  }

  const [headRaw, ...tailParts] = normalized.split(' - ');
  const head = (headRaw || '').trim();
  const tail = tailParts.join(' - ').trim();

  // Keep the course/module prefix and show a concise hint of the topic.
  if (head && tail) {
    const tailPreview = tail
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .join(' ');

    if (tailPreview) {
      return `${head} - ${tailPreview}...`;
    }
  }

  return `${normalized.slice(0, LIBRARY_TITLE_MAX_LENGTH - 3).trimEnd()}...`;
}

function buildVisiblePages(currentPage: number, totalPages: number): Array<number | 'ellipsis'> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  if (currentPage <= 3) {
    return [1, 2, 3, 4, 'ellipsis', totalPages];
  }

  if (currentPage >= totalPages - 2) {
    return [1, 'ellipsis', totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }

  return [1, 'ellipsis', currentPage - 1, currentPage, currentPage + 1, 'ellipsis', totalPages];
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
  const editInputRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const activeSearchRequestRef = useRef<AbortController | null>(null);
  const [documents, setDocuments] = useState<MyDocument[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [appliedSearchQuery, setAppliedSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [documentsPerPage, setDocumentsPerPage] = useState(getInitialDocumentsPerPage);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeMenuDocId, setActiveMenuDocId] = useState<string | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<MyDocument | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [isActionLoading, setIsActionLoading] = useState(false);

  const hasSearchQuery = appliedSearchQuery.length > 0;
  const visiblePageLabels = useMemo(
    () => buildVisiblePages(currentPage, totalPages),
    [currentPage, totalPages],
  );

  const loadDocuments = useCallback(async () => {
    activeSearchRequestRef.current?.abort();
    const controller = new AbortController();
    activeSearchRequestRef.current = controller;

    setIsLoading(true);
    setLoadError(null);
    try {
      const pageData = await getMyDocumentsPaged({
        page: currentPage,
        pageSize: documentsPerPage,
        search: appliedSearchQuery || undefined,
        signal: controller.signal,
      });

      if (controller.signal.aborted) {
        return;
      }

      setDocuments(pageData.items);
      setTotalItems(pageData.totalItems);
      setTotalPages(pageData.totalPages);

      if (pageData.page !== currentPage) {
        setCurrentPage(pageData.page);
      }
    } catch (error) {
      if (isRequestCanceledError(error)) {
        return;
      }

      if (error instanceof Error) {
        setLoadError(error.message);
      } else {
        setLoadError('Không thể tải danh sách tài liệu lúc này.');
      }
    } finally {
      if (activeSearchRequestRef.current === controller) {
        activeSearchRequestRef.current = null;
        setIsLoading(false);
      }
    }
  }, [appliedSearchQuery, currentPage, documentsPerPage]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  useEffect(() => {
    return () => {
      activeSearchRequestRef.current?.abort();
      activeSearchRequestRef.current = null;
    };
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setAppliedSearchQuery(searchQuery.trim());
      setCurrentPage(1);
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [searchQuery]);

  useEffect(() => {
    let previousPageSize = documentsPerPage;

    const handleResize = () => {
      const nextPageSize = getDocumentsPerPageByWidth(window.innerWidth);
      if (nextPageSize === previousPageSize) {
        return;
      }

      const firstItemGlobalIndex = (currentPage - 1) * previousPageSize;
      const nextPage = Math.floor(firstItemGlobalIndex / nextPageSize) + 1;

      previousPageSize = nextPageSize;
      setDocumentsPerPage(nextPageSize);
      setCurrentPage(nextPage);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [currentPage, documentsPerPage]);

  useEffect(() => {
    if (!activeMenuDocId) return;

    const closeMenu = () => setActiveMenuDocId(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, [activeMenuDocId]);

  useEffect(() => {
    if (isEditModalOpen) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [isEditModalOpen]);

  useEffect(() => {
    const handleGlobalSearchShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTypingTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        Boolean(target?.isContentEditable);

      if (event.key === '/' && !isTypingTarget) {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };

    window.addEventListener('keydown', handleGlobalSearchShortcut);
    return () => window.removeEventListener('keydown', handleGlobalSearchShortcut);
  }, []);

  const clearSearch = () => {
    setSearchQuery('');
    setAppliedSearchQuery('');
    setCurrentPage(1);
    searchInputRef.current?.focus();
  };

  const openEditModal = (doc: MyDocument) => {
    setSelectedDoc(doc);
    setEditTitle(doc.title);
    setIsDeleteModalOpen(false);
    setIsEditModalOpen(true);
    setActiveMenuDocId(null);
  };

  const openDeleteModal = (doc: MyDocument) => {
    setSelectedDoc(doc);
    setIsEditModalOpen(false);
    setIsDeleteModalOpen(true);
    setActiveMenuDocId(null);
  };

  const closeModals = () => {
    if (isActionLoading) return;
    setIsEditModalOpen(false);
    setIsDeleteModalOpen(false);
    setSelectedDoc(null);
    setEditTitle('');
  };

  const handleConfirmEdit = async () => {
    if (!selectedDoc) return;

    const normalized = editTitle.trim();
    if (normalized.length < 3) {
      toast.error('Tên tài liệu cần tối thiểu 3 ký tự.');
      return;
    }

    if (normalized === selectedDoc.title) {
      closeModals();
      return;
    }

    setIsActionLoading(true);
    try {
      const updatedDocument = await renameDocument(selectedDoc.id, normalized);
      setDocuments(prev => prev.map(doc => (doc.id === updatedDocument.id ? updatedDocument : doc)));
      toast.success('Đổi tên tài liệu thành công.');
      closeModals();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không thể đổi tên tài liệu lúc này.';
      toast.error(`Lỗi: ${message}`);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!selectedDoc) return;

    setIsActionLoading(true);
    try {
      await deleteDocument(selectedDoc.id);
      toast.success('Xóa tài liệu thành công.');
      closeModals();

      if (documents.length === 1 && currentPage > 1) {
        setCurrentPage(prev => Math.max(1, prev - 1));
      } else {
        void loadDocuments();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không thể xóa tài liệu lúc này.';
      toast.error(`Lỗi: ${message}`);
    } finally {
      setIsActionLoading(false);
    }
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
      ) : !hasSearchQuery && totalItems === 0 ? (
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
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200/90 dark:border-zinc-800 bg-white/85 dark:bg-zinc-900/60 backdrop-blur-sm p-3 sm:p-4">
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-zinc-500" />
                <input
                  ref={searchInputRef}
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape' && searchQuery.trim().length > 0) {
                      event.preventDefault();
                      clearSearch();
                    }
                  }}
                  placeholder="Tìm tài liệu theo tên..."
                  className="w-full rounded-xl border border-slate-300/90 dark:border-zinc-700 bg-white dark:bg-zinc-950/90 pl-9 pr-20 py-2.5 text-sm text-slate-800 dark:text-zinc-100 placeholder:text-slate-400 dark:placeholder:text-zinc-500 outline-none focus:border-cyan-500/70 focus:ring-2 focus:ring-cyan-500/20"
                  aria-label="Tìm kiếm tài liệu"
                />
                {searchQuery.trim().length === 0 ? (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800 px-1.5 py-0.5 text-[10px] text-slate-500 dark:text-zinc-400">
                    /
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={clearSearch}
                    className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center h-7 w-7 rounded-md text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800"
                    aria-label="Xóa tìm kiếm"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>
          </div>

          {totalItems === 0 ? (
            <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-8 text-center">
              <h2 className="text-base text-slate-900 dark:text-white" style={{ fontWeight: 700 }}>Không tìm thấy tài liệu phù hợp</h2>
              <p className="mt-2 text-sm text-slate-600 dark:text-zinc-400">Thử từ khóa khác hoặc xóa bộ lọc để xem toàn bộ tài liệu.</p>
              <button
                type="button"
                onClick={clearSearch}
                className="mt-4 inline-flex items-center gap-2 rounded-xl border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 px-4 py-2 text-sm text-slate-700 dark:text-zinc-100"
                style={{ fontWeight: 600 }}
              >
                <X size={14} />Xóa tìm kiếm
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {documents.map(document => {
                const displayedTitle = formatLibraryTitle(document.title);

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
                    className="relative cursor-pointer rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 transition-all duration-200 hover:border-slate-300 dark:hover:border-zinc-600 hover:bg-slate-50 dark:hover:bg-zinc-900/90"
                  >
                    <div
                      onClick={event => event.stopPropagation()}
                      onKeyDown={event => event.stopPropagation()}
                      className="absolute right-3 top-3 flex items-center gap-2"
                    >
                      <div className="relative" data-library-menu>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setActiveMenuDocId(prev => (prev === document.id ? null : document.id));
                          }}
                          className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white/95 dark:bg-zinc-950/80 text-slate-600 dark:text-zinc-300 hover:text-slate-900 dark:hover:text-zinc-100 hover:bg-slate-100 dark:hover:bg-zinc-800"
                          aria-label={`Tùy chọn tài liệu ${document.title}`}
                        >
                          <MoreVertical size={15} />
                        </button>

                        {activeMenuDocId === document.id && (
                          <div
                            className="absolute right-0 mt-1 w-40 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg p-1 z-20"
                            onClick={event => event.stopPropagation()}
                            onKeyDown={event => event.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                openEditModal(document);
                              }}
                              className="w-full inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg text-slate-700 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800"
                            >
                              <Pencil size={14} />Đổi tên
                            </button>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                openDeleteModal(document);
                              }}
                              className="w-full inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg text-red-500 hover:bg-red-500/10"
                            >
                              <Trash2 size={14} />Xóa
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    <h3
                      className="text-base text-slate-900 dark:text-white pr-12 leading-snug line-clamp-2 break-all"
                      style={{ fontWeight: 600 }}
                      title={document.title}
                    >
                      {displayedTitle}
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

              {totalPages > 1 && (
                <div className="rounded-2xl border border-slate-200/90 dark:border-zinc-800 bg-white/85 dark:bg-zinc-900/60 backdrop-blur-sm p-3">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="text-xs text-slate-500 dark:text-zinc-400">
                      Trang {currentPage}/{totalPages}
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        type="button"
                        onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                        disabled={currentPage <= 1 || isLoading}
                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 text-xs text-slate-700 dark:text-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-zinc-800"
                      >
                        <ChevronLeft size={14} />Trước
                      </button>

                      {visiblePageLabels.map((item, index) => (
                        item === 'ellipsis' ? (
                          <span
                            key={`ellipsis-${index}`}
                            className="inline-flex h-8 w-8 items-center justify-center text-xs text-slate-400 dark:text-zinc-500"
                          >
                            ...
                          </span>
                        ) : (
                          <button
                            key={`page-${item}`}
                            type="button"
                            onClick={() => setCurrentPage(item)}
                            disabled={isLoading}
                            className={`inline-flex h-8 min-w-8 items-center justify-center rounded-lg border px-2 text-xs transition-colors ${
                              item === currentPage
                                ? 'border-cyan-400 bg-cyan-500/15 text-cyan-200'
                                : 'border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-700 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800'
                            }`}
                            style={{ fontWeight: item === currentPage ? 700 : 600 }}
                          >
                            {item}
                          </button>
                        )
                      ))}

                      <button
                        type="button"
                        onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                        disabled={currentPage >= totalPages || isLoading}
                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 text-xs text-slate-700 dark:text-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-zinc-800"
                      >
                        Sau<ChevronRight size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <AnimatePresence>
        {isEditModalOpen && selectedDoc && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={closeModals}
          >
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              className="w-full max-w-md rounded-2xl border border-gray-700 bg-gray-800 p-5"
              onClick={event => event.stopPropagation()}
            >
              <h3 className="text-lg text-white" style={{ fontWeight: 700 }}>Đổi tên tài liệu</h3>
              <p className="text-sm text-gray-400 mt-1">Cập nhật tên mới cho tài liệu đã chọn.</p>
              <input
                ref={editInputRef}
                value={editTitle}
                onChange={(event) => setEditTitle(event.target.value)}
                className="mt-4 w-full rounded-xl border border-gray-700 bg-zinc-900 px-3 py-2.5 text-sm text-gray-100 outline-none focus:border-cyan-500/70"
                disabled={isActionLoading}
              />
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeModals}
                  disabled={isActionLoading}
                  className="rounded-xl border border-gray-700 bg-zinc-900 hover:bg-zinc-800 px-4 py-2 text-sm text-gray-200"
                  style={{ fontWeight: 600 }}
                >
                  Hủy
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmEdit()}
                  disabled={isActionLoading}
                  className="rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 disabled:cursor-not-allowed px-4 py-2 text-sm text-white"
                  style={{ fontWeight: 700 }}
                >
                  {isActionLoading ? 'Đang lưu...' : 'Lưu thay đổi'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isDeleteModalOpen && selectedDoc && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={closeModals}
          >
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              className="w-full max-w-md rounded-2xl border border-gray-700 bg-gray-800 p-5"
              onClick={event => event.stopPropagation()}
            >
              <h3 className="text-lg text-white" style={{ fontWeight: 700 }}>Xóa tài liệu</h3>
              <p className="text-sm text-gray-300 mt-2">Bạn có chắc chắn muốn xóa <span style={{ fontWeight: 700 }}>{selectedDoc.title}</span>?</p>
              <p className="text-sm text-red-400 mt-2">Hành động này không thể hoàn tác.</p>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeModals}
                  disabled={isActionLoading}
                  className="rounded-xl border border-gray-700 bg-zinc-900 hover:bg-zinc-800 px-4 py-2 text-sm text-gray-200"
                  style={{ fontWeight: 600 }}
                >
                  Hủy
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmDelete()}
                  disabled={isActionLoading}
                  className="rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed px-4 py-2 text-sm text-white"
                  style={{ fontWeight: 700 }}
                >
                  {isActionLoading ? 'Đang xóa...' : 'Xác nhận xóa'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}




