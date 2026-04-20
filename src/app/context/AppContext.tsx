import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { GamificationProfileDTO, UserProfileDTO } from '../../api/dto';
import { getMyProfile } from '../../api/auth';
import { WeekModule, Lesson, UserStats, ActivityDay } from '../lib/types';

const DEFAULT_USER_STATS: UserStats = {
  name: 'Learner',
  email: '',
  avatarUrl: null,
  createdAt: null,
  level: 1,
  exp: 0,
  expToNextLevel: 1000,
  streak: 0,
  streakRaw: 0,
  streakStatus: 'ACTIVE',
  totalLessons: 0,
  totalDays: 0,
};

interface AppContextType {
  user: UserStats;
  roadmap: WeekModule[];
  currentGoal: string;
  activityData: ActivityDay[];
  gamificationRefreshTick: number;
  completedLessons: Set<string>;
  currentLessonId: string | null;
  setRoadmap: (roadmap: WeekModule[]) => void;
  setCurrentGoal: (goal: string) => void;
  setCurrentLessonId: (id: string | null) => void;
  completeLesson: (lessonId: string) => void;
  applyServerExp: (expEarned: number) => void;
  syncServerGamification: (payload: { totalExp: number; level: number; currentStreak: number }) => void;
  syncGamificationProfile: (payload: GamificationProfileDTO) => void;
  requestGamificationRefresh: () => void;
  syncActivityData: (activity: ActivityDay[]) => void;
  setUserFromAuth: (userProfile: UserProfileDTO) => void;
  resetSessionState: () => void;
  toggleWeekExpand: (weekId: string) => void;
  deleteWeek: (weekId: string) => void;
  deleteLesson: (weekId: string, lessonId: string) => void;
  resetRoadmap: () => void;
  addCustomLesson: (title: string, type: Lesson['type']) => void;
}

const AppContext = createContext<AppContextType | null>(null);

interface AppProviderProps {
  children: ReactNode;
  initialUserStats?: UserStats;
  initialRoadmap?: WeekModule[];
  initialGoal?: string;
  initialActivityData?: ActivityDay[];
}

export function AppProvider({
  children,
  initialUserStats = DEFAULT_USER_STATS,
  initialRoadmap = [],
  initialGoal = '',
  initialActivityData = [],
}: AppProviderProps) {
  const [user, setUser] = useState<UserStats>(initialUserStats);
  const [roadmap, setRoadmapState] = useState<WeekModule[]>(initialRoadmap);
  const [currentGoal, setCurrentGoal] = useState(initialGoal);
  const [activityData, setActivityData] = useState<ActivityDay[]>(initialActivityData);
  const [gamificationRefreshTick, setGamificationRefreshTick] = useState(0);
  const [completedLessons, setCompletedLessons] = useState<Set<string>>(
    new Set(initialRoadmap.flatMap(w => w.lessons.filter(l => l.completed).map(l => l.id)))
  );
  const [currentLessonId, setCurrentLessonId] = useState<string | null>(null);

  const getProgressiveExpSnapshot = useCallback((totalExpInput: number) => {
    const safeTotalExp = Math.max(0, Math.floor(totalExpInput || 0));
    let level = 1;
    let remainingExp = safeTotalExp;

    while (remainingExp >= level * 1000) {
      remainingExp -= level * 1000;
      level += 1;
    }

    return {
      level,
      currentExp: remainingExp,
      targetExp: level * 1000,
      totalExp: safeTotalExp,
    };
  }, []);

  const syncTotalStudyDaysFromBackend = useCallback(async () => {
    try {
      const profile = await getMyProfile();
      setUser(prev => ({
        ...prev,
        totalDays: Math.max(0, profile.total_study_days ?? prev.totalDays),
      }));
    } catch {
      // Keep current totalDays when profile refresh is temporarily unavailable.
    }
  }, []);

  const recordActivityToday = useCallback((increment: number = 1) => {
    if (increment <= 0) return;

    const today = new Date().toISOString().split('T')[0];
    setActivityData(prev => {
      let found = false;
      const next = prev.map(day => {
        if (day.date !== today) return day;
        found = true;
        return { ...day, count: day.count + increment };
      });

      if (!found) {
        next.push({ date: today, count: increment });
      }

      return next;
    });
  }, []);

  const setRoadmap = useCallback((newRoadmap: WeekModule[]) => {
    setRoadmapState(newRoadmap);
  }, []);

  const completeLesson = useCallback((lessonId: string) => {
    setCompletedLessons(prev => {
      if (prev.has(lessonId)) return prev;
      const next = new Set(prev);
      next.add(lessonId);
      return next;
    });

    setRoadmapState(prev =>
      prev.map(week => {
        const lessons = week.lessons.map(lesson =>
          lesson.id === lessonId ? { ...lesson, completed: true } : lesson
        );
        return {
          ...week,
          lessons,
          completed: lessons.every(l => l.completed),
        };
      })
    );
  }, []);

  const applyServerExp = useCallback((expEarned: number) => {
    if (expEarned <= 0) return;

    recordActivityToday(expEarned);

    setUser(prev => {
      const newExp = prev.exp + expEarned;
      const levelUp = newExp >= prev.expToNextLevel;
      return {
        ...prev,
        exp: levelUp ? newExp - prev.expToNextLevel : newExp,
        level: levelUp ? prev.level + 1 : prev.level,
        expToNextLevel: levelUp ? prev.expToNextLevel + 1000 : prev.expToNextLevel,
      };
    });
  }, [recordActivityToday]);

  const syncServerGamification = useCallback((payload: { totalExp: number; level: number; currentStreak: number }) => {
    const snapshot = getProgressiveExpSnapshot(payload.totalExp);
    const safeStreak = Math.max(0, payload.currentStreak || 0);

    setUser(prev => {
      return {
        ...prev,
        level: snapshot.level,
        exp: snapshot.currentExp,
        expToNextLevel: snapshot.targetExp,
        streak: safeStreak,
        streakRaw: safeStreak,
        streakStatus: 'ACTIVE',
      };
    });

    void syncTotalStudyDaysFromBackend();
  }, [getProgressiveExpSnapshot, syncTotalStudyDaysFromBackend]);

  const syncGamificationProfile = useCallback((payload: GamificationProfileDTO) => {
    const safeLevel = Math.max(1, Math.floor(payload.level || 1));
    const safeTargetExp = Math.max(1, Math.floor(payload.target_exp || safeLevel * 1000));
    const safeCurrentExp = Math.max(0, Math.min(Math.floor(payload.current_exp || 0), safeTargetExp));
    const safeStreakRaw = Math.max(0, Math.floor(payload.current_streak || 0));
    const safeDisplayStreak = Math.max(0, Math.floor(payload.display_streak ?? safeStreakRaw));
    const safeStreakStatus = payload.streak_status ?? (safeDisplayStreak > 0 ? 'ACTIVE' : 'PENDING');

    setUser(prev => ({
      ...prev,
      level: safeLevel,
      exp: safeCurrentExp,
      expToNextLevel: safeTargetExp,
      streak: safeDisplayStreak,
      streakRaw: safeStreakRaw,
      streakStatus: safeStreakStatus,
    }));
  }, []);

  const requestGamificationRefresh = useCallback(() => {
    setGamificationRefreshTick(prev => prev + 1);
    void syncTotalStudyDaysFromBackend();
  }, [syncTotalStudyDaysFromBackend]);

  const syncActivityData = useCallback((activity: ActivityDay[]) => {
    const normalized = activity
      .filter(day => Boolean(day.date))
      .map(day => ({
        date: day.date,
        count: Math.max(0, day.count || 0),
      }));

    setActivityData(normalized);
  }, []);

  const setUserFromAuth = useCallback((userProfile: UserProfileDTO) => {
    const snapshot = getProgressiveExpSnapshot(userProfile.total_exp || 0);
    const resolvedFullName = (userProfile.full_name || userProfile.display_name || '').trim();

    setUser(prev => ({
      ...prev,
      name: resolvedFullName || prev.name,
      email: userProfile.email,
      avatarUrl: userProfile.avatar_url ?? null,
      createdAt: userProfile.created_at ?? prev.createdAt ?? null,
      level: snapshot.level,
      exp: snapshot.currentExp,
      expToNextLevel: snapshot.targetExp,
      streak: Math.max(0, userProfile.current_streak ?? prev.streak),
      streakRaw: Math.max(0, userProfile.current_streak ?? prev.streakRaw),
      totalDays: Math.max(0, userProfile.total_study_days ?? prev.totalDays),
    }));
  }, [getProgressiveExpSnapshot]);

  const toggleWeekExpand = useCallback((weekId: string) => {
    setRoadmapState(prev =>
      prev.map(week => week.id === weekId ? { ...week, expanded: !week.expanded } : week)
    );
  }, []);

  const deleteWeek = useCallback((weekId: string) => {
    setRoadmapState(prev => prev.filter(week => week.id !== weekId));
  }, []);

  const deleteLesson = useCallback((weekId: string, lessonId: string) => {
    setRoadmapState(prev =>
      prev.map(week =>
        week.id === weekId
          ? { ...week, lessons: week.lessons.filter(l => l.id !== lessonId) }
          : week
      )
    );
  }, []);

  const resetRoadmap = useCallback(() => {
    setRoadmapState([]);
    setCurrentGoal('');
    setCompletedLessons(new Set());
  }, []);

  const resetSessionState = useCallback(() => {
    setUser(DEFAULT_USER_STATS);
    setRoadmapState([]);
    setCurrentGoal('');
    setActivityData([]);
    setGamificationRefreshTick(0);
    setCompletedLessons(new Set());
    setCurrentLessonId(null);
  }, []);

  const addCustomLesson = useCallback((title: string, type: Lesson['type']) => {
    const newLesson: Lesson = {
      id: `custom-${Date.now()}`,
      title,
      duration: '45 phút',
      completed: false,
      type,
      description: 'Bài học tự thêm',
    };

    setRoadmapState(prev => {
      const customWeekId = 'week-custom';
      const existingCustom = prev.find(w => w.id === customWeekId);
      if (existingCustom) {
        return prev.map(w =>
          w.id === customWeekId
            ? { ...w, lessons: [...w.lessons, newLesson], completed: false }
            : w
        );
      }
      const newWeek: WeekModule = {
        id: customWeekId,
        weekNumber: prev.length + 1,
        title: 'Bài Học Tự Thêm',
        description: 'Các bài học do bạn tự thêm vào',
        lessons: [newLesson],
        completed: false,
        expanded: true,
      };
      return [...prev, newWeek];
    });
  }, []);

  return (
    <AppContext.Provider value={{
      user, roadmap, currentGoal, activityData, gamificationRefreshTick, completedLessons,
      currentLessonId, setRoadmap, setCurrentGoal, setCurrentLessonId,
      completeLesson, toggleWeekExpand, deleteWeek, deleteLesson,
      applyServerExp, syncServerGamification, syncGamificationProfile, requestGamificationRefresh, syncActivityData, setUserFromAuth, resetSessionState, resetRoadmap, addCustomLesson,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}