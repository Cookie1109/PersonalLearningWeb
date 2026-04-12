import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityDay } from '../lib/types';

interface Props {
  data: ActivityDay[];
}

const DAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const MONTHS = ['Th1', 'Th2', 'Th3', 'Th4', 'Th5', 'Th6', 'Th7', 'Th8', 'Th9', 'Th10', 'Th11', 'Th12'];

function getColor(count: number, isDarkTheme: boolean): string {
  if (isDarkTheme) {
    if (count === 0) return 'transparent';
    if (count <= 2) return '#083344';
    if (count <= 4) return '#0e7490';
    if (count <= 6) return '#06b6d4';
    return '#22d3ee';
  }

  if (count === 0) return '#e2e8f0';
  if (count <= 2) return '#bae6fd';
  if (count <= 4) return '#67e8f9';
  if (count <= 6) return '#22d3ee';
  return '#0891b2';
}

function getBorderColor(count: number, isDarkTheme: boolean): string {
  if (isDarkTheme) {
    if (count === 0) return '#1f2b43';
    if (count <= 2) return '#0e7490';
    if (count <= 4) return '#22d3ee';
    return '#67e8f9';
  }

  if (count === 0) return '#cbd5e1';
  if (count <= 2) return '#7dd3fc';
  if (count <= 4) return '#22d3ee';
  return '#0891b2';
}

export default function ProgressHeatmap({ data }: Props) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isDarkTheme, setIsDarkTheme] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  );

  useEffect(() => {
    const root = document.documentElement;
    const updateTheme = () => setIsDarkTheme(root.classList.contains('dark'));

    updateTheme();
    const observer = new MutationObserver(updateTheme);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });

    return () => observer.disconnect();
  }, []);

  const weeks = useMemo(() => {
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - 364);

    // Align to Sunday
    const dayOfWeek = startDate.getDay();
    startDate.setDate(startDate.getDate() - dayOfWeek);

    const dataMap = new Map(data.map(d => [d.date, d.count]));

    const weeksArr: { date: string; count: number }[][] = [];
    let currentWeek: { date: string; count: number }[] = [];

    const cursor = new Date(startDate);
    while (cursor <= today) {
      const dateStr = cursor.toISOString().split('T')[0];
      currentWeek.push({ date: dateStr, count: dataMap.get(dateStr) || 0 });

      if (currentWeek.length === 7) {
        weeksArr.push(currentWeek);
        currentWeek = [];
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    if (currentWeek.length > 0) {
      while (currentWeek.length < 7) currentWeek.push({ date: '', count: 0 });
      weeksArr.push(currentWeek);
    }

    return weeksArr;
  }, [data]);

  // Month labels
  const monthLabels = useMemo(() => {
    const labels: { month: string; col: number }[] = [];
    let lastMonth = -1;
    weeks.forEach((week, colIdx) => {
      const firstDay = week.find(d => d.date)?.date;
      if (firstDay) {
        const month = new Date(firstDay).getMonth();
        if (month !== lastMonth) {
          labels.push({ month: MONTHS[month], col: colIdx });
          lastMonth = month;
        }
      }
    });
    return labels;
  }, [weeks]);

  const totalActivity = data.reduce((sum, d) => sum + d.count, 0);
  const activeDays = data.filter(d => d.count > 0).length;
  const mutedTextClass = isDarkTheme ? 'text-zinc-400' : 'text-slate-500';
  const dayLabelClass = isDarkTheme ? 'text-zinc-500' : 'text-slate-500';

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const frame = requestAnimationFrame(() => {
      container.scrollLeft = container.scrollWidth;
    });

    return () => cancelAnimationFrame(frame);
  }, [weeks.length, data.length]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className={`text-xs ${mutedTextClass}`}>{totalActivity} phiên học · {activeDays} ngày hoạt động trong năm qua</p>
        <div className={`flex items-center gap-2 text-xs ${mutedTextClass}`}>
          <span>Ít</span>
          {[0, 2, 4, 6, 8].map(v => (
            <div
              key={v}
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: getColor(v, isDarkTheme), border: `1px solid ${getBorderColor(v, isDarkTheme)}` }}
            />
          ))}
          <span>Nhiều</span>
        </div>
      </div>

      <div ref={scrollContainerRef} className="overflow-x-auto">
        <div className="inline-flex gap-1">
          {/* Day labels */}
          <div className="flex flex-col gap-1 pt-5 pr-1">
            {DAYS.map((day, i) => (
              <div key={day} className={`h-3 text-xs ${dayLabelClass} flex items-center ${i % 2 === 0 ? '' : 'opacity-0'}`} style={{ minWidth: 16 }}>
                {i % 2 === 0 ? day : ''}
              </div>
            ))}
          </div>

          {/* Grid */}
          <div className="flex flex-col">
            {/* Month labels */}
            <div className="relative h-5 mb-1">
              {monthLabels.map(({ month, col }) => (
                <span
                  key={`${month}-${col}`}
                  className={`absolute text-xs ${mutedTextClass}`}
                  style={{ left: col * 16, whiteSpace: 'nowrap' }}
                >
                  {month}
                </span>
              ))}
            </div>

            <div className="flex gap-1">
              {weeks.map((week, wi) => (
                <div key={wi} className="flex flex-col gap-1">
                  {week.map((day, di) => (
                    <div
                      key={di}
                      title={day.date ? `${day.date}: ${day.count} phiên học` : ''}
                      className="w-3 h-3 rounded-full transition-all duration-150 cursor-pointer hover:scale-125 hover:ring-1 hover:ring-cyan-300"
                      style={{
                        backgroundColor: day.date ? getColor(day.count, isDarkTheme) : 'transparent',
                        border: day.date ? `1px solid ${getBorderColor(day.count, isDarkTheme)}` : 'none',
                        boxShadow: day.date && day.count > 0 && isDarkTheme
                          ? '0 0 0 1px rgba(34, 211, 238, 0.15), 0 0 8px rgba(6, 182, 212, 0.2)'
                          : 'none',
                      }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
