import React, { FormEvent, useEffect, useState } from 'react';
import axios from 'axios';
import { Link, useNavigate } from 'react-router';

import { register } from '../../api/auth';
import { getAccessToken } from '../../api/client';

export default function RegisterPage() {
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (getAccessToken()) {
      navigate('/', { replace: true });
    }
  }, [navigate]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const normalizedUsername = username.trim();
    if (!normalizedUsername) {
      setError('Vui lòng nhập tên đăng nhập.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Mật khẩu xác nhận không khớp.');
      return;
    }

    setIsSubmitting(true);

    try {
      await register({
        email: normalizedUsername,
        password,
      });

      setSuccess('Đăng ký thành công. Đang chuyển đến trang đăng nhập...');
      setTimeout(() => {
        navigate('/login', { replace: true });
      }, 900);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const code = err.response?.data?.detail?.code;
        if (code === 'USER_ALREADY_EXISTS') {
          setError('Tên đăng nhập đã tồn tại.');
        } else {
          setError(err.response?.data?.message ?? 'Đăng ký thất bại. Vui lòng thử lại.');
        }
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Đăng ký thất bại. Vui lòng thử lại.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center px-6">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-7">
        <h1 className="text-2xl" style={{ fontWeight: 700 }}>Đăng ký</h1>
        <p className="text-zinc-500 text-sm mt-1">Tạo tài khoản để bắt đầu học</p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm text-zinc-300 mb-1">Tên đăng nhập (email)</label>
            <input
              type="email"
              required
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full rounded-xl bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-sm outline-none focus:border-cyan-500/70"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="block text-sm text-zinc-300 mb-1">Mật khẩu</label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full rounded-xl bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-sm outline-none focus:border-cyan-500/70"
              placeholder="********"
            />
          </div>

          <div>
            <label className="block text-sm text-zinc-300 mb-1">Xác nhận mật khẩu</label>
            <input
              type="password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              className="w-full rounded-xl bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-sm outline-none focus:border-cyan-500/70"
              placeholder="********"
            />
          </div>

          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}

          {success && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
              {success}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 disabled:cursor-not-allowed px-4 py-2.5 text-sm"
            style={{ fontWeight: 600 }}
          >
            {isSubmitting ? 'Đang đăng ký...' : 'Đăng ký'}
          </button>
        </form>

        <p className="mt-4 text-sm text-zinc-400">
          Đã có tài khoản?{' '}
          <Link to="/login" className="text-cyan-500 hover:text-cyan-400">
            Đăng nhập ngay
          </Link>
        </p>
      </div>
    </div>
  );
}




