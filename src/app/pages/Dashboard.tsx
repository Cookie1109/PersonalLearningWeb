import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router';
import { Clock, FilePlus2, Flame, Info, Star, TrendingUp } from 'lucide-react';
import { useApp } from '../context/AppContext';
import DailyQuestsWidget from '../components/DailyQuestsWidget';
import ProgressHeatmap from '../components/ProgressHeatmap';
import { getHeatmapData } from '../../api/gamification';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';

export default function Dashboard() {
  const { user, activityData, syncActivityData } = useApp();
  const navigate = useNavigate();
  const FixedYearHeatmap = ProgressHeatmap as React.ComponentType<{ data: typeof activityData; year: number }>;
  const currentYear = useMemo(() => new Date().getFullYear(), []);

  const firstAvailableYear = useMemo(() => {
    if (!user.createdAt) return currentYear;

    const createdDate = new Date(user.createdAt);
    const createdYear = createdDate.getFullYear();
    if (!Number.isFinite(createdYear)) return currentYear;
    return Math.min(currentYear, Math.max(1970, createdYear));
  }, [currentYear, user.createdAt]);

  const yearOptions = useMemo(() => {
    const years: number[] = [];
    for (let year = currentYear; year >= firstAvailableYear; year -= 1) {
      years.push(year);
    }
    return years;
  }, [currentYear, firstAvailableYear]);

  const [selectedYear, setSelectedYear] = useState(currentYear);

  useEffect(() => {
    if (!yearOptions.length) {
      if (selectedYear !== currentYear) {
        setSelectedYear(currentYear);
      }
      return;
    }

    if (!yearOptions.includes(selectedYear)) {
      setSelectedYear(yearOptions[0]);
    }
  }, [currentYear, selectedYear, yearOptions]);

  useEffect(() => {
    let isMounted = true;

    const loadActivity = async () => {
      try {
        const heatmap = await getHeatmapData(selectedYear);
        if (!isMounted) return;
        const normalized = Object.entries(heatmap.data || {})
          .filter(([date]) => Boolean(date))
          .map(([date, exp]) => ({
            date,
            count: Math.max(0, Number(exp) || 0),
          }));
        syncActivityData(normalized);
      } catch {
        // Keep current UI state if activity endpoint is temporarily unavailable.
      }
    };

    void loadActivity();
    return () => {
      isMounted = false;
    };
  }, [selectedYear, syncActivityData]);

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
      <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-3xl text-white" style={{ fontWeight: 700 }}>Xin chào, {user.name}</h1>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl text-white mt-1" style={{ fontWeight: 700 }}>Nhập tài liệu và vào bài học ngay</h2>
            <p className="text-sm text-zinc-300 mt-2">Chỉ cần nhập tài liệu. NEXL sẽ tạo Lý thuyết, Câu hỏi, Thẻ ghi nhớ trong một Workspace duy nhất.</p>
          </div>
          <button
            onClick={() => navigate('/create')}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-sm transition-colors flex-shrink-0"
            style={{ fontWeight: 600 }}
          >
            <FilePlus2 size={16} />Tạo Workspace
          </button>
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[
          { icon: Flame, label: 'Streak', value: `${user.streak} ngày`, sub: 'Chuỗi học liên tục', color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20' },
          { icon: Clock, label: 'Ngày học', value: `${user.totalDays}`, sub: 'Tổng số ngày học', color: 'text-cyan-400', bg: 'bg-cyan-500/10 border-cyan-500/20' },
          { icon: Star, label: 'Cấp độ', value: `Lv.${user.level}`, sub: `${user.exp}/${user.expToNextLevel} EXP`, color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/20' },
        ].map(({ icon: Icon, label, value, sub, color, bg }) => (
          <div key={label} className={`rounded-2xl border p-4 ${bg}`}>
            <div className="flex items-center justify-between mb-2">
              <Icon size={18} className={color} />
              <span className="text-xs text-zinc-500 uppercase tracking-wide" style={{ fontWeight: 600 }}>{label}</span>
            </div>
            <p className="text-2xl text-white" style={{ fontWeight: 700 }}>{value}</p>
            <p className="text-xs text-zinc-500 mt-1">{sub}</p>
          </div>
        ))}
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }}>
        <DailyQuestsWidget />
      </motion.div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.18 }} className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <TrendingUp size={18} className="text-cyan-400" />
            <h3 className="text-white" style={{ fontWeight: 600 }}>Hoạt động học tập</h3>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Giải thích mức màu heatmap"
                  className="inline-flex items-center justify-center text-zinc-500 transition-colors hover:text-zinc-300"
                >
                  <Info size={14} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={8} className="max-w-xs border border-zinc-700 bg-zinc-900 text-zinc-100">
                <p className="mb-1" style={{ fontWeight: 700 }}>Mức độ hoạt động</p>
                <p>Nhạt nhất: Dưới 330 EXP (Chưa xong nhiệm vụ)</p>
                <p>Vừa: 330+ EXP (Hoàn thành Nhiệm vụ ngày)</p>
                <p>Đậm: 500+ EXP (Chăm chỉ học thêm)</p>
                <p>Đậm nhất: 800+ EXP (Học cường độ cao)</p>
              </TooltipContent>
            </Tooltip>
          </div>

          <label className="inline-flex items-center gap-2 text-xs text-zinc-400">
            <span>Năm</span>
            <select
              value={selectedYear}
              onChange={event => setSelectedYear(Number(event.target.value))}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-200 outline-none transition-colors hover:border-zinc-600 focus:border-cyan-500"
            >
              {yearOptions.map(year => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
        </div>
        <FixedYearHeatmap data={activityData} year={selectedYear} />
      </motion.div>
    </div>
  );
}



