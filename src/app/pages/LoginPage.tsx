import React, { FormEvent, useEffect, useState } from 'react';
import axios from 'axios';
import { Link, useNavigate } from 'react-router';

import { login } from '../../api/auth';
import { getAccessToken } from '../../api/client';
import { useApp } from '../context/AppContext';

export default function LoginPage() {
  const navigate = useNavigate();
  const { setUserFromAuth } = useApp();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (getAccessToken()) {
      navigate('/', { replace: true });
    }
  }, [navigate]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await login({ email, password });
      setUserFromAuth(response.user);
      navigate('/', { replace: true });
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.message ?? 'Dang nhap that bai. Vui long thu lai.');
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Dang nhap that bai. Vui long thu lai.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center px-6">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-7">
        <h1 className="text-2xl" style={{ fontWeight: 700 }}>Dang nhap</h1>
        <p className="text-zinc-500 text-sm mt-1">Truy cap khong gian hoc tap cua ban</p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm text-zinc-300 mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full rounded-xl bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-sm outline-none focus:border-violet-500/70"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="block text-sm text-zinc-300 mb-1">Mat khau</label>
            <input
              type="password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full rounded-xl bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-sm outline-none focus:border-violet-500/70"
              placeholder="********"
            />
          </div>

          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-60 disabled:cursor-not-allowed px-4 py-2.5 text-sm"
            style={{ fontWeight: 600 }}
          >
            {isSubmitting ? 'Dang dang nhap...' : 'Dang nhap'}
          </button>

          <p className="text-sm text-zinc-400 text-center">
            Chua co tai khoan?{' '}
            <Link to="/register" className="text-violet-400 hover:text-violet-300">
              Dang ky ngay
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
