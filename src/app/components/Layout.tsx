import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import {
  LayoutDashboard, BookOpen, Trophy,
  Zap, Flame, ChevronRight, Menu, Target,
  Settings, Bell, Star, LogOut, FilePlus2, LibraryBig, Sun, Moon
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { UserStats } from '../lib/types';
import { getMyProfile, logout } from '../../api/auth';
import { getAccessToken } from '../../api/client';
import nexlWordmarkDark from '../../assets/branding/nexl-wordmark-dark.svg';
import nexlWordmarkLight from '../../assets/branding/nexl-wordmark-light.svg';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Tổng Quan', end: true },
  { to: '/create', icon: FilePlus2, label: 'Tạo Workspace' },
  { to: '/library', icon: LibraryBig, label: 'Thư viện' },
  { to: '/learn', icon: BookOpen, label: 'Không Gian Học' },
];

export interface LayoutProps {
  userData?: UserStats;
  activeRoadmapLabel?: string;
}

type ThemeMode = 'light' | 'dark';
const THEME_STORAGE_KEY = 'nexl-theme-mode';

function resolveInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'dark';
  }

  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') {
    return stored;
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export default function Layout({ userData, activeRoadmapLabel }: LayoutProps) {
  const app = useApp();
  const user = userData ?? app.user;
  const { resetSessionState, setUserFromAuth } = app;
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(resolveInitialTheme);
  const navigate = useNavigate();

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', themeMode === 'dark');
    root.setAttribute('data-theme', themeMode);
    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

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
  const roadmapLabel = activeRoadmapLabel ?? 'NEXL Workspace';
  const isDarkTheme = themeMode === 'dark';
  const logoWordmark = isDarkTheme ? nexlWordmarkDark : nexlWordmarkLight;

  const topbarButtonClass = isDarkTheme
    ? 'flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-white hover:bg-zinc-700 transition-colors text-sm'
    : 'flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 border border-slate-200 text-slate-700 hover:text-slate-900 hover:bg-slate-200 transition-colors text-sm';

  const toggleThemeMode = () => {
    setThemeMode(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  return (
    <div className="flex h-screen bg-zinc-950 text-white overflow-hidden">
      {/* Sidebar */}
      <motion.aside
        initial={false}
        animate={{ width: sidebarOpen ? 260 : 72 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        className="relative flex flex-col bg-zinc-900 border-r border-zinc-800 z-20 flex-shrink-0"
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 h-16 border-b border-zinc-800">
          <AnimatePresence>
            {sidebarOpen && (
              <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.2 }}
                className="flex items-center flex-1 min-w-0"
              >
                <img
                  src={logoWordmark}
                  alt="NEXL"
                  className={`h-8 w-auto max-w-[156px] object-contain ${isDarkTheme ? 'drop-shadow-[0_0_10px_rgba(125,211,252,0.25)]' : ''}`}
                />
              </motion.div>
            )}
          </AnimatePresence>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className={`${sidebarOpen ? 'ml-auto' : 'mx-auto'} p-1.5 rounded-lg transition-colors ${isDarkTheme ? 'text-zinc-400 hover:text-white hover:bg-zinc-800' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'}`}
          >
            {sidebarOpen ? <ChevronRight size={16} /> : <Menu size={16} />}
          </button>
        </div>

        {/* User stats mini */}
        <AnimatePresence mode="wait">
          {sidebarOpen ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="px-4 py-3 border-b border-zinc-800">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 rounded-full bg-cyan-700 flex items-center justify-center text-sm flex-shrink-0" style={{ fontWeight: 700 }}>
                  {user.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate" style={{ fontWeight: 600 }}>{user.name}</p>
                  <p className="text-xs text-cyan-400">Cấp {user.level}</p>
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
                    className="h-full bg-cyan-500 rounded-full"
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
          ) : (
            <motion.div
              key="sidebar-user-collapsed"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
              className="px-2 py-3 border-b border-zinc-800"
            >
              <div className="mx-auto h-9 w-9 rounded-full bg-cyan-700 flex items-center justify-center text-sm" style={{ fontWeight: 700 }}>
                {user.name.charAt(0)}
              </div>
              <p className="mt-2 text-center text-[10px] text-cyan-400 tracking-wide" style={{ fontWeight: 700 }}>
                Lv.{user.level}
              </p>
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
                `${sidebarOpen ? 'flex items-center gap-3 px-3 py-2.5 text-sm' : 'mx-auto flex h-10 w-10 items-center justify-center p-0'} rounded-xl transition-all duration-200 group relative overflow-hidden border border-transparent ${isActive
                  ? (isDarkTheme
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30'
                    : 'bg-cyan-100 text-cyan-700 border-cyan-200')
                  : (isDarkTheme
                    ? 'text-zinc-400 hover:text-white hover:bg-zinc-800 hover:border-zinc-700/60'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 hover:border-slate-200')}`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && sidebarOpen && (
                    <motion.div
                      layoutId="activeNav"
                      className="absolute inset-0 bg-cyan-500/10 rounded-xl"
                    />
                  )}
                  {isActive && !sidebarOpen && (
                    <span className="absolute inset-0 rounded-xl bg-cyan-500/10" />
                  )}
                  <Icon size={18} className={`flex-shrink-0 relative z-10 ${isActive ? 'text-cyan-400' : ''}`} />
                  <span
                    className={`relative z-10 truncate transition-all duration-200 ${sidebarOpen ? 'max-w-[140px] opacity-100' : 'max-w-0 opacity-0 pointer-events-none'}`}
                    style={{ fontWeight: isActive ? 600 : 400 }}
                  >
                    {label}
                  </span>
                  {isActive && sidebarOpen && (
                    <motion.div className={`ml-auto w-1.5 h-1.5 rounded-full flex-shrink-0 relative z-10 ${isDarkTheme ? 'bg-cyan-400' : 'bg-cyan-600'}`} />
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
            <button
              key={label}
              className={`${sidebarOpen ? 'w-full flex items-center gap-3 px-3 py-2.5 text-sm' : 'mx-auto flex h-10 w-10 items-center justify-center p-0'} rounded-xl transition-colors ${isDarkTheme ? 'text-zinc-500 hover:text-white hover:bg-zinc-800' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'}`}
            >
              <Icon size={18} className="flex-shrink-0" />
              <span className={`truncate transition-all duration-200 ${sidebarOpen ? 'max-w-[120px] opacity-100' : 'max-w-0 opacity-0 pointer-events-none'}`}>
                {label}
              </span>
            </button>
          ))}
        </div>
      </motion.aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <div className="h-16 flex items-center justify-between px-6 border-b border-zinc-800 bg-zinc-950 flex-shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/create')} className={topbarButtonClass}>
              <Target size={14} className="text-cyan-400" />
              <span className="max-w-xs truncate">{roadmapLabel}</span>
            </button>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={toggleThemeMode}
              className={topbarButtonClass}
              aria-label={isDarkTheme ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'}
              title={isDarkTheme ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'}
            >
              {isDarkTheme ? <Sun size={14} /> : <Moon size={14} />}
              <span>{isDarkTheme ? 'Light mode' : 'Dark mode'}</span>
            </button>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-400 text-sm">
              <Flame size={14} />
              <span style={{ fontWeight: 700 }}>{user.streak}</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-sm">
              <Zap size={14} />
              <span style={{ fontWeight: 700 }}>{user.exp} EXP</span>
            </div>
            <button
              onClick={handleLogout}
              disabled={isLoggingOut}
              className={`${topbarButtonClass} disabled:opacity-60 disabled:cursor-not-allowed`}
            >
              <LogOut size={14} />
              {isLoggingOut ? 'Đăng xuất...' : 'Đăng xuất'}
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


