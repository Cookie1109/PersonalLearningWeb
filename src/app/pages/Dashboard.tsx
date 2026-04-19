import React, { useEffect } from 'react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router';
import { Clock, FilePlus2, Flame, Sparkles, Star, TrendingUp } from 'lucide-react';
import { useApp } from '../context/AppContext';
import ProgressHeatmap from '../components/ProgressHeatmap';
import { fetchMyActivity } from '../../api/auth';

export default function Dashboard() {
  const { user, activityData, syncActivityData } = useApp();
  const navigate = useNavigate();

  useEffect(() => {
    let isMounted = true;

    const loadActivity = async () => {
      try {
        const activity = await fetchMyActivity();
        if (!isMounted) return;
        syncActivityData(activity);
      } catch {
        // Keep current UI state if activity endpoint is temporarily unavailable.
      }
    };

    void loadActivity();
    return () => {
      isMounted = false;
    };
  }, [syncActivityData]);

  const expProgress = Math.round((user.exp / user.expToNextLevel) * 100);

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

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { icon: Flame, label: 'Streak', value: `${user.streak} ngày`, sub: 'Chuỗi học liên tục', color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20' },
          { icon: Clock, label: 'Ngày học', value: `${user.totalDays}`, sub: 'Tổng số ngày học', color: 'text-cyan-400', bg: 'bg-cyan-500/10 border-cyan-500/20' },
          { icon: Star, label: 'Cấp độ', value: `Lv.${user.level}`, sub: `${user.exp}/${user.expToNextLevel} EXP`, color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/20' },
          { icon: Sparkles, label: 'EXP', value: `${expProgress}%`, sub: 'Tiến độ', color: 'text-violet-400', bg: 'bg-violet-500/10 border-violet-500/20' },
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

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.18 }} className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <div className="flex items-center gap-2 mb-5">
          <TrendingUp size={18} className="text-cyan-400" />
          <h3 className="text-white" style={{ fontWeight: 600 }}>Hoạt động học tập</h3>
        </div>
        <ProgressHeatmap data={activityData} />
      </motion.div>
    </div>
  );
}



