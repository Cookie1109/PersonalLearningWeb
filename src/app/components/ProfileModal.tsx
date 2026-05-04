import React, { ChangeEvent, useEffect, useRef, useState } from 'react';
import { Camera, Loader2, Save, Trash2, UserRound } from 'lucide-react';
import axios from 'axios';
import { updateMyProfile, uploadMyAvatar } from '../../api/auth';
import { useApp } from '../context/AppContext';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

function resolveErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const payload = error.response?.data as Record<string, unknown> | undefined;
    const message = typeof payload?.message === 'string' ? payload.message : undefined;
    const detail = typeof payload?.detail === 'string' ? payload.detail : undefined;
    return detail ?? message ?? fallback;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

function getProfileInitial(fullName: string, email: string): string {
  const source = (fullName || email || 'H').trim();
  return source.charAt(0).toUpperCase() || 'H';
}

export interface ProfileModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ProfileModalNotice = {
  tone: 'success' | 'error';
  message: string;
};

export default function ProfileModal({ open, onOpenChange }: ProfileModalProps) {
  const { user, setUserFromAuth } = useApp();
  const [fullName, setFullName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user.avatarUrl ?? null);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [notice, setNotice] = useState<ProfileModalNotice | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setFullName(user.name);
    setEmail(user.email);
    setAvatarUrl(user.avatarUrl ?? null);
    if (!open) {
      setNotice(null);
    }
  }, [user.avatarUrl, user.email, user.name, open]);

  const handleSaveProfile = async () => {
    const normalizedFullName = fullName.trim();
    if (normalizedFullName.length < 2) {
      setNotice({ tone: 'error', message: 'Họ tên cần ít nhất 2 ký tự.' });
      return;
    }

    setIsSaving(true);
    setNotice(null);
    try {
      const updatedProfile = await updateMyProfile({
        full_name: normalizedFullName,
        avatar_url: avatarUrl,
      });
      setUserFromAuth(updatedProfile);
      setFullName(updatedProfile.full_name || updatedProfile.display_name);
      setEmail(updatedProfile.email);
      setAvatarUrl(updatedProfile.avatar_url ?? null);
      setNotice({ tone: 'success', message: 'Đã lưu thông tin hồ sơ.' });
    } catch (error) {
      setNotice({
        tone: 'error',
        message: resolveErrorMessage(error, 'Không thể cập nhật hồ sơ lúc này.'),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleAvatarSelection = async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) {
      return;
    }

    if (!selectedFile.type.startsWith('image/')) {
      setNotice({ tone: 'error', message: 'Vui lòng chọn file ảnh hợp lệ (jpg, png, webp...).'});
      event.target.value = '';
      return;
    }

    if (selectedFile.size > MAX_AVATAR_BYTES) {
      setNotice({ tone: 'error', message: 'Ảnh đại diện vượt quá 5MB. Vui lòng chọn ảnh nhỏ hơn.' });
      event.target.value = '';
      return;
    }

    setIsUploading(true);
    setNotice(null);
    try {
      const updatedProfile = await uploadMyAvatar(selectedFile);

      setUserFromAuth(updatedProfile);
      setFullName(updatedProfile.full_name || updatedProfile.display_name);
      setEmail(updatedProfile.email);
      setAvatarUrl(updatedProfile.avatar_url ?? null);
      setNotice({ tone: 'success', message: 'Cập nhật ảnh đại diện thành công.' });
    } catch (error) {
      setNotice({
        tone: 'error',
        message: resolveErrorMessage(error, 'Không thể tải ảnh đại diện lên lúc này.'),
      });
    } finally {
      setIsUploading(false);
      event.target.value = '';
    }
  };

  const handleRemoveAvatar = async () => {
    if (!avatarUrl) {
      return;
    }

    setIsSaving(true);
    setNotice(null);
    try {
      const normalizedFullName = fullName.trim() || user.name;
      const updatedProfile = await updateMyProfile({
        full_name: normalizedFullName,
        avatar_url: null,
      });
      setUserFromAuth(updatedProfile);
      setFullName(updatedProfile.full_name || updatedProfile.display_name);
      setEmail(updatedProfile.email);
      setAvatarUrl(null);
      setNotice({ tone: 'success', message: 'Đã gỡ ảnh đại diện.' });
    } catch (error) {
      setNotice({
        tone: 'error',
        message: resolveErrorMessage(error, 'Không thể gỡ ảnh đại diện lúc này.'),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const profileInitial = getProfileInitial(fullName, email);
  const isBusy = isSaving || isUploading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!w-[min(100vw-2rem,780px)] !max-w-[780px] max-h-[88vh] overflow-y-auto border-slate-200 dark:border-zinc-800 bg-gradient-to-br from-cyan-50 via-white to-slate-50 dark:from-zinc-900 dark:via-zinc-900 dark:to-zinc-950 p-6 md:p-7">
        <DialogTitle className="sr-only">Cài đặt hồ sơ</DialogTitle>
        <DialogDescription className="sr-only">
          Chỉnh sửa thông tin hồ sơ và ảnh đại diện.
        </DialogDescription>
        <div className="flex items-center gap-3 mb-1 pr-9">
          <div className="h-11 w-11 rounded-2xl bg-cyan-600 text-white flex items-center justify-center">
            <UserRound size={20} />
          </div>
          <div>
            <h1 className="text-2xl text-slate-900 dark:text-white" style={{ fontWeight: 700 }}>Cài Đặt Hồ Sơ</h1>
          </div>
        </div>

        {notice && (
          <div
            aria-live="polite"
            className={`mt-4 rounded-xl border px-4 py-3 text-sm ${notice.tone === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-700/40 dark:bg-emerald-900/20 dark:text-emerald-300'
              : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-700/40 dark:bg-rose-900/20 dark:text-rose-300'}`}
          >
            {notice.message}
          </div>
        )}

        <div className="mt-7 grid grid-cols-1 md:grid-cols-[280px_minmax(0,420px)] md:justify-center gap-5">
          <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white/90 dark:bg-zinc-900 p-5">
            <p className="text-sm text-slate-700 dark:text-zinc-300 mb-4" style={{ fontWeight: 600 }}>Ảnh đại diện</p>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isBusy}
              className="group relative h-36 w-36 rounded-full mx-auto border-4 border-cyan-200 dark:border-cyan-700/50 bg-cyan-700 text-white flex items-center justify-center overflow-visible disabled:opacity-60 disabled:cursor-not-allowed"
              aria-label="Tải ảnh đại diện"
            >
              <span className="absolute inset-0 rounded-full overflow-hidden">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="Avatar" className="h-full w-full object-cover" />
                ) : (
                  <span className="h-full w-full flex items-center justify-center text-4xl" style={{ fontWeight: 700 }}>{profileInitial}</span>
                )}
              </span>
              <span className="absolute -bottom-1 -right-1 h-9 w-9 rounded-full flex items-center justify-center transition-colors border border-slate-200 bg-white text-slate-700 shadow-md group-hover:bg-slate-100 dark:border-zinc-600 dark:bg-zinc-800/90 dark:text-zinc-100 dark:group-hover:bg-zinc-700">
                {isUploading ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
              </span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept="image/*"
              onChange={handleAvatarSelection}
              disabled={isBusy}
            />
            <p className="text-xs text-slate-500 dark:text-zinc-500 text-center mt-3">PNG, JPG, WEBP. Tối đa 5MB.</p>
            <button
              type="button"
              onClick={handleRemoveAvatar}
              disabled={!avatarUrl || isBusy}
              className="mt-4 w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 text-sm text-slate-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 disabled:opacity-60 disabled:cursor-not-allowed"
              style={{ fontWeight: 600 }}
            >
              <Trash2 size={14} />Gỡ ảnh
            </button>
          </div>

          <div className="min-w-0 rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white/90 dark:bg-zinc-900 p-5 space-y-5 md:self-center">
            <div className="space-y-2">
              <label htmlFor="profile-full-name" className="text-sm text-slate-700 dark:text-zinc-300" style={{ fontWeight: 600 }}>
                Họ và tên
              </label>
              <input
                id="profile-full-name"
                type="text"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                disabled={isBusy}
                className="w-full h-11 px-3 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                placeholder="Nhập họ tên của bạn"
                minLength={2}
                maxLength={120}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="profile-email" className="text-sm text-slate-700 dark:text-zinc-300" style={{ fontWeight: 600 }}>
                Email
              </label>
              <input
                id="profile-email"
                type="email"
                value={email}
                disabled
                className="w-full h-11 px-3 rounded-xl border border-slate-200 dark:border-zinc-700 bg-gray-800/50 text-slate-500 dark:text-zinc-400 opacity-60 cursor-not-allowed"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end mt-6 pt-4 border-t border-gray-700/50">
          <button
            type="button"
            onClick={handleSaveProfile}
            disabled={isBusy}
            className="inline-flex items-center gap-2 px-5 h-11 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed"
            style={{ fontWeight: 600 }}
          >
            {(isSaving && !isUploading) ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {(isSaving && !isUploading) ? 'Đang lưu...' : 'Lưu thay đổi'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
