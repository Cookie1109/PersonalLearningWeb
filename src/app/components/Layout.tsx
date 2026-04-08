import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import {
  LayoutDashboard, BookOpen, Trophy,
  Zap, Flame, ChevronRight, Menu, Sparkles, Target,
  Settings, Bell, Star, LogOut, MessageSquare, FilePlus2
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { UserStats } from '../lib/types';
import { getMyProfile, logout } from '../../api/auth';
import { getAccessToken } from '../../api/client';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Tổng Quan', end: true },
  { to: '/create', icon: FilePlus2, label: 'Tạo Workspace' },
  { to: '/learn', icon: BookOpen, label: 'Không Gian Học' },
  { to: '/chat', icon: MessageSquare, label: 'DocsShare Assistant' },
];

export interface LayoutProps {
  userData?: UserStats;
  activeRoadmapLabel?: string;
}

export default function Layout({ userData, activeRoadmapLabel }: LayoutProps) {
  const app = useApp();
  const user = userData ?? app.user;
  const { resetSessionState, setUserFromAuth } = app;
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      navigate('/login', { replace: true });
      return;
    }

    let mounted = true;
    const loadProfile = async () => {
      try {
        const profile = await getMyProfile();
        if (!mounted) return;
        setUserFromAuth(profile);
      } catch {
        // Profile hydration failures should not block navigation.
      }
    };

    void loadProfile();
    return () => {
      mounted = false;
    };
  }, [navigate, setUserFromAuth]);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await logout({ revoke_all_devices: false });
    } catch {
      // Logout API failures are ignored because client-side state must always be cleared.
    } finally {
      resetSessionState();
      navigate('/login', { replace: true });
      setIsLoggingOut(false);
    }
  };

  const progress = Math.min(100, Math.max(0, user.totalDays));
  const expProgress = Math.round((user.exp / user.expToNextLevel) * 100);
  const roadmapLabel = activeRoadmapLabel ?? 'NotebookLM Mini Workspace';

  return (
    <div className="flex h-screen bg-zinc-950 text-white overflow-hidden">
      {/* Sidebar */}
      <motion.aside
        initial={false}
        animate={{ width: sidebarOpen ? 260 : 72 }}
        transition={{ duration: 0.3, ease: 'easeInOut' }}
        className="relative flex flex-col bg-zinc-900 border-r border-zinc-800 z-20 flex-shrink-0"
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 h-16 border-b border-zinc-800">
          <div className="w-9 h-9 rounded-xl bg-violet-600 flex items-center justify-center flex-shrink-0">
            <Sparkles size={18} className="text-white" />
          </div>
          <AnimatePresence>
            {sidebarOpen && (
              <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.2 }}>
                <p className="text-white text-sm" style={{ fontWeight: 700 }}>LearnAI</p>
                <p className="text-zinc-500 text-xs">Personal Tutor</p>
              </motion.div>
            )}
          </AnimatePresence>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="ml-auto p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            {sidebarOpen ? <ChevronRight size={16} /> : <Menu size={16} />}
          </button>
        </div>

        {/* User stats mini */}
        <AnimatePresence>
          {sidebarOpen && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="px-4 py-3 border-b border-zinc-800">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 rounded-full bg-violet-700 flex items-center justify-center text-sm flex-shrink-0" style={{ fontWeight: 700 }}>
                  {user.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate" style={{ fontWeight: 600 }}>{user.name}</p>
                  <p className="text-xs text-violet-400">Cấp {user.level} · {user.exp} EXP</p>
                </div>
              </div>
              {/* EXP Bar */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-zinc-500">
                  <span>EXP</span><span>{user.exp}/{user.expToNextLevel}</span>
                </div>
                <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }} animate={{ width: `${expProgress}%` }}
                    className="h-full bg-violet-500 rounded-full"
                  />
                </div>
              </div>
              <div className="flex items-center gap-3 mt-2">
                <div className="flex items-center gap-1 text-xs text-orange-400">
                  <Flame size={12} /><span style={{ fontWeight: 600 }}>{user.streak} ngày</span>
                </div>
                <div className="flex items-center gap-1 text-xs text-yellow-400">
                  <Star size={12} /><span style={{ fontWeight: 600 }}>Cấp {user.level}</span>
                </div>
                <div className="flex items-center gap-1 text-xs text-emerald-400">
                  <Trophy size={12} /><span style={{ fontWeight: 600 }}>{progress}%</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Navigation */}
        <nav className="flex-1 px-2 py-3 space-y-1">
          {navItems.map(({ to, icon: Icon, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 group relative overflow-hidden ${
                  isActive
                    ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30'
                    : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.div
                      layoutId="activeNav"
                      className="absolute inset-0 bg-violet-500/10 rounded-xl"
                    />
                  )}
                  <Icon size={18} className={`flex-shrink-0 relative z-10 ${isActive ? 'text-violet-400' : ''}`} />
                  <AnimatePresence>
                    {sidebarOpen && (
                      <motion.span
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="relative z-10 truncate" style={{ fontWeight: isActive ? 600 : 400 }}
                      >
                        {label}
                      </motion.span>
                    )}
                  </AnimatePresence>
                  {isActive && sidebarOpen && (
                    <motion.div className="ml-auto w-1.5 h-1.5 rounded-full bg-violet-400 flex-shrink-0 relative z-10" />
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Bottom nav */}
        <div className="px-2 py-3 border-t border-zinc-800 space-y-1">
          {[
            { icon: Bell, label: 'Thông Báo' },
            { icon: Settings, label: 'Cài Đặt' },
          ].map(({ icon: Icon, label }) => (
            <button key={label} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors">
              <Icon size={18} className="flex-shrink-0" />
              <AnimatePresence>
                {sidebarOpen && (
                  <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    {label}
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
          ))}
        </div>
      </motion.aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <div className="h-16 flex items-center justify-between px-6 border-b border-zinc-800 bg-zinc-950 flex-shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/create')} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition-colors text-sm text-zinc-300">
              <Target size={14} className="text-violet-400" />
              <span className="max-w-xs truncate">{roadmapLabel}</span>
            </button>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-400 text-sm">
              <Flame size={14} />
              <span style={{ fontWeight: 700 }}>{user.streak}</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-500/10 border border-violet-500/20 text-violet-400 text-sm">
              <Zap size={14} />
              <span style={{ fontWeight: 700 }}>{user.exp} EXP</span>
            </div>
            <button
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-white hover:bg-zinc-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors text-sm"
            >
              <LogOut size={14} />
              {isLoggingOut ? 'Dang xuat...' : 'Dang xuat'}
            </button>
          </div>
        </div>

        {/* Page content */}
        <div className="flex-1 overflow-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}