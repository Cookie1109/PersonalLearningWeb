import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { UserProfileDTO } from '../../api/dto';
import { WeekModule, Lesson, UserStats, ActivityDay } from '../lib/types';

const DEFAULT_USER_STATS: UserStats = {
  name: 'Learner',
  level: 1,
  exp: 0,
  expToNextLevel: 1000,
  streak: 0,
  totalLessons: 0,
  totalDays: 0,
};

interface AppContextType {
  user: UserStats;
  roadmap: WeekModule[];
  currentGoal: string;
  activityData: ActivityDay[];
  completedLessons: Set<string>;
  currentLessonId: string | null;
  setRoadmap: (roadmap: WeekModule[]) => void;
  setCurrentGoal: (goal: string) => void;
  setCurrentLessonId: (id: string | null) => void;
  completeLesson: (lessonId: string) => void;
  applyServerExp: (expEarned: number) => void;
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
  const [activityData] = useState<ActivityDay[]>(initialActivityData);
  const [completedLessons, setCompletedLessons] = useState<Set<string>>(
    new Set(initialRoadmap.flatMap(w => w.lessons.filter(l => l.completed).map(l => l.id)))
  );
  const [currentLessonId, setCurrentLessonId] = useState<string | null>(null);

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
  }, []);

  const setUserFromAuth = useCallback((userProfile: UserProfileDTO) => {
    setUser(prev => ({
      ...prev,
      name: userProfile.display_name,
      level: userProfile.level,
      exp: userProfile.total_exp,
    }));
  }, []);

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
      user, roadmap, currentGoal, activityData, completedLessons,
      currentLessonId, setRoadmap, setCurrentGoal, setCurrentLessonId,
      completeLesson, toggleWeekExpand, deleteWeek, deleteLesson,
      applyServerExp, setUserFromAuth, resetSessionState, resetRoadmap, addCustomLesson,
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