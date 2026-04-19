import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import {
  LayoutDashboard, BookOpen, Trophy,
  Zap, Flame, ChevronRight, Menu, Target,
  Settings, Bell, Star, LogOut, FilePlus2, LibraryBig, Sun, Moon
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { UserStats } from '../lib/types';
import { getMyProfile } from '../../api/auth';
import ProfileModal from './ProfileModal';
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
const SIDEBAR_AUTO_COLLAPSE_BREAKPOINT = 1024;

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
  const { currentUser, authLoading, signOutUser } = useAuth();
  const user = userData ?? app.user;
  const { resetSessionState, setUserFromAuth } = app;
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(resolveInitialTheme);
  const navigate = useNavigate();

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', themeMode === 'dark');
    root.setAttribute('data-theme', themeMode);
    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  useEffect(() => {
    if (authLoading) {
      return;
    }

    if (!currentUser) {
      navigate('/login', { replace: true });
      return;
    }

    let mounted = true;

    const hydrateProfile = async (): Promise<boolean> => {
      try {
        const profile = await getMyProfile();
        if (!mounted) {
          return true;
        }

        setUserFromAuth(profile);
        return true;
      } catch {
        return false;
      }
    };

    const loadProfile = async () => {
      const hydrated = await hydrateProfile();
      if (hydrated || !currentUser) {
        return;
      }

      try {
        await currentUser.getIdToken(true);
      } catch {
        return;
      }

      await hydrateProfile();
    };

    void loadProfile();
    return () => {
      mounted = false;
    };
  }, [authLoading, currentUser, navigate, setUserFromAuth]);

  useEffect(() => {
    const mediaQuery = window.matchMedia(`(max-width: ${SIDEBAR_AUTO_COLLAPSE_BREAKPOINT - 1}px)`);

    const handleViewportChange = (event: MediaQueryListEvent | MediaQueryList) => {
      if (event.matches) {
        setSidebarOpen(false);
      }
    };

    handleViewportChange(mediaQuery);
    mediaQuery.addEventListener('change', handleViewportChange);
    return () => mediaQuery.removeEventListener('change', handleViewportChange);
  }, []);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await signOutUser();
    } catch {
      // Firebase sign-out failures are ignored because client-side state must always be cleared.
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
  const userInitial = (user.name || user.email || 'L').trim().charAt(0).toUpperCase() || 'L';

  const topbarButtonClass = isDarkTheme
    ? 'flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-white hover:bg-zinc-700 transition-colors text-sm'
    : 'flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 border border-slate-200 text-slate-700 hover:text-slate-900 hover:bg-slate-200 transition-colors text-sm';

  const toggleThemeMode = () => {
    setThemeMode(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-200 flex items-center justify-center">
        <p className="text-sm text-zinc-400">Đang xác thực phiên đăng nhập...</p>
      </div>
    );
  }

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
              <div className="flex flex-col gap-y-3">
                <button
                  type="button"
                  onClick={() => setIsProfileModalOpen(true)}
                  title="Chỉnh sửa hồ sơ"
                  className={`flex items-center gap-3 p-2 -ml-2 rounded-lg transition-colors w-full ${isDarkTheme ? 'hover:bg-gray-800' : 'hover:bg-slate-200/80'}`}
                >
                  <div className="w-9 h-9 rounded-full bg-cyan-700 flex items-center justify-center text-sm flex-shrink-0 overflow-hidden" style={{ fontWeight: 700 }}>
                    {user.avatarUrl ? (
                      <img src={user.avatarUrl} alt={user.name || 'Avatar'} className="h-full w-full object-cover" />
                    ) : (
                      userInitial
                    )}
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col justify-center">
                    <p className="text-sm font-semibold text-white truncate">{user.name}</p>
                    <p className="text-xs text-cyan-400">Cấp {user.level}</p>
                  </div>
                </button>
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
                <div className="flex items-center gap-3">
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
              <button
                type="button"
                onClick={() => setIsProfileModalOpen(true)}
                title="Chỉnh sửa hồ sơ"
                className={`block w-full text-left rounded-lg py-1.5 transition-colors ${isDarkTheme ? 'hover:bg-gray-800' : 'hover:bg-slate-100'}`}
              >
                <div className="mx-auto h-9 w-9 rounded-full bg-cyan-700 flex items-center justify-center text-sm overflow-hidden" style={{ fontWeight: 700 }}>
                  {user.avatarUrl ? (
                    <img src={user.avatarUrl} alt={user.name || 'Avatar'} className="h-full w-full object-cover" />
                  ) : (
                    userInitial
                  )}
                </div>
                <p className="mt-2 text-center text-[10px] text-cyan-400 tracking-wide" style={{ fontWeight: 700 }}>
                  Lv.{user.level}
                </p>
              </button>
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
          <button
            className={`${sidebarOpen ? 'w-full flex items-center gap-3 px-3 py-2.5 text-sm' : 'mx-auto flex h-10 w-10 items-center justify-center p-0'} rounded-xl transition-colors ${isDarkTheme ? 'text-zinc-500 hover:text-white hover:bg-zinc-800' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'}`}
          >
            <Bell size={18} className="flex-shrink-0" />
            <span className={`truncate transition-all duration-200 ${sidebarOpen ? 'max-w-[120px] opacity-100' : 'max-w-0 opacity-0 pointer-events-none'}`}>
              Thông Báo
            </span>
          </button>
          <button
            type="button"
            onClick={() => setIsProfileModalOpen(true)}
            className={`${sidebarOpen ? 'w-full flex items-center gap-3 px-3 py-2.5 text-sm' : 'mx-auto flex h-10 w-10 items-center justify-center p-0'} rounded-xl transition-colors ${isDarkTheme ? 'text-zinc-500 hover:text-white hover:bg-zinc-800' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'}`}
          >
            <Settings size={18} className="flex-shrink-0" />
            <span className={`truncate transition-all duration-200 ${sidebarOpen ? 'max-w-[120px] opacity-100' : 'max-w-0 opacity-0 pointer-events-none'}`}>
              Cài đặt
            </span>
          </button>
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
              <span>{isDarkTheme ? 'Chế độ sáng' : 'Chế độ tối'}</span>
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

      <ProfileModal open={isProfileModalOpen} onOpenChange={setIsProfileModalOpen} />
    </div>
  );
}


