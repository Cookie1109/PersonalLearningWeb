import React, { useEffect, useMemo, useState } from 'react';
import { ActivityDay } from '../lib/types';

interface Props {
  data: ActivityDay[];
  year: number;
}

const DAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const MONTHS = ['Th1', 'Th2', 'Th3', 'Th4', 'Th5', 'Th6', 'Th7', 'Th8', 'Th9', 'Th10', 'Th11', 'Th12'];

type HeatmapLevel = 0 | 1 | 2 | 3 | 4;

const DARK_LEVEL_CLASS_MAP: Record<HeatmapLevel, string> = {
  0: 'bg-transparent border-[#1f2b43]',
  1: 'bg-cyan-950/70 border-cyan-800/80',
  2: 'bg-cyan-700/75 border-cyan-500/80',
  3: 'bg-cyan-500/80 border-cyan-300/90',
  4: 'bg-cyan-300 border-cyan-100',
};

const LIGHT_LEVEL_CLASS_MAP: Record<HeatmapLevel, string> = {
  0: 'bg-slate-100 border-slate-300',
  1: 'bg-cyan-100 border-cyan-300',
  2: 'bg-cyan-300 border-cyan-400',
  3: 'bg-cyan-500 border-cyan-600',
  4: 'bg-cyan-700 border-cyan-800',
};

function getHeatmapLevel(exp: number): HeatmapLevel {
  const safeExp = Math.max(0, Math.floor(exp || 0));

  if (safeExp === 0) return 0;
  if (safeExp <= 329) return 1;
  if (safeExp <= 499) return 2;
  if (safeExp <= 799) return 3;
  return 4;
}

function getHeatmapLevelClass(exp: number, isDarkTheme: boolean): string {
  const level = getHeatmapLevel(exp);
  return isDarkTheme ? DARK_LEVEL_CLASS_MAP[level] : LIGHT_LEVEL_CLASS_MAP[level];
}

function getLevelLegendSample(level: HeatmapLevel): number {
  if (level === 0) return 0;
  if (level === 1) return 120;
  if (level === 2) return 330;
  if (level === 3) return 500;
  return 800;
}

function formatDateKeyLocal(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

interface HeatmapCell {
  date: string;
  exp: number;
  inSelectedYear: boolean;
}

export default function ProgressHeatmap({ data, year }: Props) {
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

  const yearData = useMemo(
    () => data.filter(day => day.date.startsWith(`${year}-`)),
    [data, year],
  );

  const yearDataMap = useMemo(
    () => new Map(yearData.map(day => [day.date, Math.max(0, Math.floor(day.count || 0))])),
    [yearData],
  );

  const weeks = useMemo(() => {
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31);
    const gridStart = new Date(yearStart);
    const gridEnd = new Date(yearEnd);

    // Align to full weeks (Sunday -> Saturday) like GitHub calendar columns.
    gridStart.setDate(gridStart.getDate() - gridStart.getDay());
    gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()));

    const weeksArr: HeatmapCell[][] = [];
    let currentWeek: HeatmapCell[] = [];

    const cursor = new Date(gridStart);
    while (cursor <= gridEnd) {
      const day = new Date(cursor);
      const dateStr = formatDateKeyLocal(day);
      const inSelectedYear = day.getFullYear() === year;
      currentWeek.push({
        date: dateStr,
        exp: inSelectedYear ? yearDataMap.get(dateStr) || 0 : 0,
        inSelectedYear,
      });

      if (currentWeek.length === 7) {
        weeksArr.push(currentWeek);
        currentWeek = [];
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    return weeksArr;
  }, [year, yearDataMap]);

  const monthLabels = useMemo(() => {
    const labels: Array<{ month: string; col: number }> = [];

    for (let month = 0; month < 12; month += 1) {
      const firstDayKey = `${year}-${String(month + 1).padStart(2, '0')}-01`;
      let column = -1;

      for (let colIdx = 0; colIdx < weeks.length; colIdx += 1) {
        if (weeks[colIdx].some(day => day.inSelectedYear && day.date === firstDayKey)) {
          column = colIdx;
          break;
        }
      }

      if (column >= 0) {
        labels.push({ month: MONTHS[month], col: column });
      }
    }

    return labels;
  }, [weeks, year]);

  const totalExp = yearData.reduce((sum, d) => sum + Math.max(0, Math.floor(d.count || 0)), 0);
  const activeDays = yearData.filter(d => d.count > 0).length;
  const mutedTextClass = isDarkTheme ? 'text-zinc-400' : 'text-slate-500';
  const dayLabelClass = isDarkTheme ? 'text-zinc-500' : 'text-slate-500';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className={`text-xs ${mutedTextClass}`}>{totalExp} EXP · {activeDays} ngày hoạt động trong năm {year}</p>
        <div className={`flex items-center gap-2 text-xs ${mutedTextClass}`}>
          <span>Ít</span>
          {[0, 1, 2, 3, 4].map(level => (
            <div
              key={level}
              className={`w-3 h-3 rounded-full border ${getHeatmapLevelClass(
                getLevelLegendSample(level as HeatmapLevel),
                isDarkTheme,
              )}`}
            />
          ))}
          <span>Nhiều</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="inline-flex gap-1">
          <div className="flex flex-col gap-1 pt-5 pr-1">
            {DAYS.map((day, i) => (
              <div key={day} className={`h-3 text-xs ${dayLabelClass} flex items-center ${i % 2 === 0 ? '' : 'opacity-0'}`} style={{ minWidth: 16 }}>
                {i % 2 === 0 ? day : ''}
              </div>
            ))}
          </div>

          <div className="flex flex-col">
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
                  {week.map((day, di) => {
                    const safeExp = Math.max(0, Math.floor(day.exp || 0));
                    const cellTitle = day.inSelectedYear
                      ? safeExp > 0
                        ? `${safeExp} EXP kiếm được vào ngày ${day.date}`
                        : `Không có hoạt động vào ngày ${day.date}`
                      : '';

                    return (
                      <div
                        key={di}
                        title={cellTitle}
                        className={`w-3 h-3 rounded-full border transition-all duration-150 ${day.inSelectedYear
                          ? `cursor-pointer hover:scale-125 hover:ring-1 hover:ring-cyan-300 ${getHeatmapLevelClass(safeExp, isDarkTheme)}`
                          : 'border-transparent bg-transparent opacity-0 pointer-events-none'}`}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
