import React, { useEffect, useMemo, useRef } from 'react';
import { ActivityDay } from '../lib/types';

interface Props {
  data: ActivityDay[];
}

const DAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const MONTHS = ['Th1', 'Th2', 'Th3', 'Th4', 'Th5', 'Th6', 'Th7', 'Th8', 'Th9', 'Th10', 'Th11', 'Th12'];

function getColor(count: number): string {
  if (count === 0) return '#18181b';
  if (count <= 2) return '#4c1d95';
  if (count <= 4) return '#6d28d9';
  if (count <= 6) return '#7c3aed';
  return '#8b5cf6';
}

function getBorderColor(count: number): string {
  if (count === 0) return '#27272a';
  if (count <= 2) return '#5b21b6';
  if (count <= 4) return '#7c3aed';
  return '#a78bfa';
}

export default function ProgressHeatmap({ data }: Props) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);

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
        <p className="text-xs text-zinc-500">{totalActivity} phiên học · {activeDays} ngày hoạt động trong năm qua</p>
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span>Ít</span>
          {[0, 2, 4, 6, 8].map(v => (
            <div
              key={v}
              className="w-3 h-3 rounded-sm"
              style={{ backgroundColor: getColor(v), border: `1px solid ${getBorderColor(v)}` }}
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
              <div key={day} className={`h-3 text-xs text-zinc-600 flex items-center ${i % 2 === 0 ? '' : 'opacity-0'}`} style={{ minWidth: 16 }}>
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
                  className="absolute text-xs text-zinc-500"
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
                      className="w-3 h-3 rounded-sm transition-all duration-150 cursor-pointer hover:scale-125 hover:ring-1 hover:ring-violet-400"
                      style={{
                        backgroundColor: day.date ? getColor(day.count) : 'transparent',
                        border: day.date ? `1px solid ${getBorderColor(day.count)}` : 'none',
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
