import React, { FormEvent, useEffect, useState } from 'react';
import { FirebaseError } from 'firebase/app';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';

import { apiClient } from '../../api/client';
import { UserProfileDTO } from '../../api/dto';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M9 7.36364V10.8545H13.8518C13.6385 11.9773 13 12.9273 12.0418 13.5655L14.9682 15.8364C16.6727 14.2636 17.6591 11.95 17.6591 9.18182C17.6591 8.54364 17.6018 7.93091 17.4955 7.36364H9Z"
      />
      <path
        fill="#34A853"
        d="M3.68091 10.7136L3.02091 11.2182L0.684547 13.0382C2.16818 15.9818 5.20909 18 9 18C11.4318 18 13.4691 17.1973 14.9682 15.8364L12.0418 13.5655C11.2391 14.1018 10.2118 14.4273 9 14.4273C6.65364 14.4273 4.66091 12.84 3.94818 10.7136H3.68091Z"
      />
      <path
        fill="#4A90E2"
        d="M0.684547 4.96182C0.0718191 6.16182 -0.15 7.51818 -0.15 9C-0.15 10.4818 0.0718191 11.8382 0.684547 13.0382C0.684547 13.0536 3.94818 10.6973 3.94818 10.6973C3.76818 10.1618 3.66182 9.59091 3.66182 9C3.66182 8.40909 3.76818 7.83818 3.94818 7.30273L0.684547 4.96182Z"
      />
      <path
        fill="#FBBC05"
        d="M9 3.58818C10.33 3.58818 11.5236 4.04636 12.4682 4.93909L15.0336 2.37364C13.4655 0.891818 11.4318 0 9 0C5.20909 0 2.16818 2.01818 0.684547 4.96182L3.94818 7.30273C4.66091 5.17636 6.65364 3.58818 9 3.58818Z"
      />
    </svg>
  );
}

function mapLoginError(error: unknown): string {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case 'auth/wrong-password':
      case 'auth/user-not-found':
      case 'auth/invalid-credential':
        return 'Email hoặc mật khẩu không đúng.';
      case 'auth/invalid-email':
        return 'Email không hợp lệ. Vui lòng kiểm tra lại.';
      case 'auth/too-many-requests':
        return 'Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.';
      default:
        return 'Đăng nhập thất bại. Vui lòng thử lại.';
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Đăng nhập thất bại. Vui lòng thử lại.';
}

function mapGoogleAuthError(error: unknown): string {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case 'auth/popup-closed-by-user':
        return 'Bạn đã đóng cửa sổ đăng nhập Google trước khi hoàn tất.';
      case 'auth/popup-blocked':
        return 'Trình duyệt đang chặn popup. Vui lòng cho phép popup rồi thử lại.';
      case 'auth/cancelled-popup-request':
        return 'Yêu cầu đăng nhập Google đã bị hủy.';
      default:
        return 'Đăng nhập Google thất bại. Vui lòng thử lại.';
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Đăng nhập Google thất bại. Vui lòng thử lại.';
}

export default function LoginPage() {
  const navigate = useNavigate();
  const { setUserFromAuth } = useApp();
  const { currentUser, authLoading, signInWithEmail, signInWithGoogle } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pendingAction, setPendingAction] = useState<'email' | 'google' | null>(null);
  const isSubmitting = pendingAction !== null;

  useEffect(() => {
    if (!authLoading && currentUser) {
      navigate('/', { replace: true });
    }
  }, [authLoading, currentUser, navigate]);

  const syncProfileAndNavigate = async () => {
    const response = await apiClient.get<UserProfileDTO>('/auth/me');
    setUserFromAuth(response.data);
    navigate('/', { replace: true });
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPendingAction('email');

    try {
      await signInWithEmail(email, password);
      await syncProfileAndNavigate();
    } catch (err) {
      toast.error(mapLoginError(err));
    } finally {
      setPendingAction(null);
    }
  };

  const onGoogleLogin = async () => {
    setPendingAction('google');

    try {
      await signInWithGoogle();
      await syncProfileAndNavigate();
    } catch (err) {
      toast.error(mapGoogleAuthError(err));
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center px-6">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-7">
        <h1 className="text-2xl" style={{ fontWeight: 700 }}>Đăng nhập</h1>
        <p className="text-zinc-500 text-sm mt-1">Truy cập không gian học tập của bạn</p>

        <button
          type="button"
          disabled={isSubmitting}
          onClick={onGoogleLogin}
          className="mt-6 w-full rounded-xl border px-4 py-2.5 text-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 bg-white border-slate-300 text-slate-800 hover:bg-slate-50 hover:border-slate-400 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-700"
          style={{ fontWeight: 600 }}
        >
          <GoogleIcon />
          <span>{pendingAction === 'google' ? 'Đang mở Google...' : 'Đăng nhập bằng Google'}</span>
        </button>

        <div className="mt-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-zinc-700" />
          <span className="text-[11px] uppercase tracking-[0.14em] text-zinc-500">hoặc</span>
          <div className="h-px flex-1 bg-zinc-700" />
        </div>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm text-zinc-300 mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full rounded-xl bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-sm outline-none focus:border-cyan-500/70"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="block text-sm text-zinc-300 mb-1">Mật khẩu</label>
            <input
              type="password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full rounded-xl bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-sm outline-none focus:border-cyan-500/70"
              placeholder="********"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 disabled:cursor-not-allowed px-4 py-2.5 text-sm"
            style={{ fontWeight: 600 }}
          >
            {pendingAction === 'email' ? 'Đang đăng nhập...' : 'Đăng nhập'}
          </button>

          <p className="text-sm text-zinc-400 text-center">
            Chưa có tài khoản?{' '}
            <Link to="/register" className="text-cyan-500 hover:text-cyan-400">
              Đăng ký ngay
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}




