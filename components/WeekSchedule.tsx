import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, LayoutAnimation } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, S, R, F, HOUR_HEIGHT, CategoryIcons, CategoryColors } from '../constants/theme';
import { Record, getRecordsByDateRange } from '../lib/db';
import { snapTime } from '../lib/time';

const WDS = ['一', '二', '三', '四', '五', '六', '日'];
const START_HOUR = 6;
const END_HOUR = 24;
const HOURS = END_HOUR - START_HOUR;
const TIME_LABEL_W = 36;
const DAY_COL_W = 90;

interface Props {
  weekStart: Date;
  granularity: number;
}

function dateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getMonday(d: Date): Date {
  const r = new Date(d);
  const day = r.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  r.setDate(r.getDate() + diff);
  r.setHours(0, 0, 0, 0);
  return r;
}

export default function WeekSchedule({ weekStart: initialMonday, granularity }: Props) {
  const [records, setRecords] = useState<Record[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const hScrollRef = useRef<ScrollView>(null);

  const monday = getMonday(initialMonday);
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    days.push(d);
  }

  const sunday = days[6];
  const load = useCallback(async () => {
    const data = await getRecordsByDateRange(dateStr(monday), dateStr(sunday));
    setRecords(data);
  }, [dateStr(monday), dateStr(sunday)]);

  useEffect(() => { load(); }, [load]);

  // Auto-scroll to today
  useEffect(() => {
    const today = new Date();
    const todayKey = dateStr(today);
    const todayIndex = days.findIndex(d => dateStr(d) === todayKey);
    if (todayIndex >= 0 && hScrollRef.current) {
      setTimeout(() => {
        hScrollRef.current?.scrollTo({ x: todayIndex * DAY_COL_W, animated: true });
      }, 100);
    }
  }, [monday.getTime()]);

  // Group records by date
  const byDate: { [key: string]: Record[] } = {};
  for (const r of records) {
    const d = new Date(r.start_time);
    const key = dateStr(d);
    if (!byDate[key]) byDate[key] = [];
    byDate[key].push(r);
  }

  const today = new Date();
  const todayStr = dateStr(today);

  // Grid calculations
  const slotsPerHour = 60 / granularity;
  const slotHeight = HOUR_HEIGHT / slotsPerHour;
  const totalHeight = HOURS * HOUR_HEIGHT;

  const toggleExpand = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(expanded === id ? null : id);
  };

  const renderBlock = (rec: Record) => {
    const snappedStart = snapTime(rec.start_time, granularity, 'floor');
    const snappedEnd = rec.end_time ? snapTime(rec.end_time, granularity, 'ceil') : snapTime(new Date().toISOString(), granularity, 'ceil');

    const start = new Date(snappedStart);
    const end = new Date(snappedEnd);
    const startOffset = (start.getHours() + start.getMinutes() / 60) - START_HOUR;
    const durationHours = Math.max((end.getTime() - start.getTime()) / 3600000, granularity / 60);
    const top = startOffset * HOUR_HEIGHT;
    const height = durationHours * HOUR_HEIGHT;
    const bg = CategoryColors[rec.category] || CategoryColors['其他'];
    const isOpen = expanded === rec.id;

    if (startOffset < 0 || startOffset >= HOURS) return null;

    return (
      <TouchableOpacity
        key={rec.id}
        style={[s.block, { top, height: Math.max(height, slotHeight), backgroundColor: bg }]}
        onPress={() => toggleExpand(rec.id)}
        activeOpacity={0.7}
      >
        <Text style={s.blockLabel} numberOfLines={1}>{rec.activity}</Text>
        {isOpen && (
          <View style={s.blockDetail}>
            {rec.details ? <Text style={s.blockDetailText} numberOfLines={3}>{rec.details}</Text> : null}
            {rec.location ? <View style={s.blockMetaRow}><Ionicons name="location-outline" size={10} color={Colors.subtext} /><Text style={s.blockMeta}>{rec.location}</Text></View> : null}
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const contentWidth = TIME_LABEL_W + DAY_COL_W * 7;

  return (
    <View style={s.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} ref={hScrollRef}>
        <View style={{ width: contentWidth }}>
          {/* Week header */}
          <View style={s.headerRow}>
            <View style={s.timeLabelCol} />
            {days.map((d, i) => {
              const ds = dateStr(d);
              const isToday = ds === todayStr;
              return (
                <View key={ds} style={[s.headerCell, isToday && s.headerCellToday]}>
                  <Text style={[s.headerWd, isToday && s.headerWdToday]}>{WDS[i]}</Text>
                  <Text style={[s.headerDay, isToday && s.headerDayToday]}>{d.getDate()}</Text>
                </View>
              );
            })}
          </View>

          {/* Grid */}
          <ScrollView style={s.gridScroll} showsVerticalScrollIndicator={false}>
            <View style={[s.grid, { height: totalHeight }]}>
              {/* Time labels */}
              <View style={s.timeLabelCol}>
                {Array.from({ length: HOURS }, (_, i) => (
                  <View key={i} style={{ height: HOUR_HEIGHT }}>
                    <Text style={s.timeLabel}>{(START_HOUR + i).toString().padStart(2, '0')}:00</Text>
                  </View>
                ))}
              </View>

              {/* Day columns */}
              <View style={s.daysRow}>
                {days.map((d) => {
                  const ds = dateStr(d);
                  const dayRecords = byDate[ds] || [];
                  const isToday = ds === todayStr;

                  const slots: number[] = [];
                  for (let h = 0; h < HOURS; h++) {
                    for (let s = 0; s < slotsPerHour; s++) {
                      slots.push(h * slotsPerHour + s);
                    }
                  }

                  return (
                    <View key={ds} style={[s.dayCol, isToday && s.dayColToday]}>
                      {slots.map((si) => {
                        const isHourLine = si % slotsPerHour === slotsPerHour - 1;
                        return <View key={si} style={[s.slotCell, { height: slotHeight }, isHourLine && s.hourLine]} />;
                      })}
                      {dayRecords.map(renderBlock)}
                    </View>
                  );
                })}
              </View>
            </View>
          </ScrollView>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1 },
  headerRow: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.divider, paddingBottom: S.sm },
  timeLabelCol: { width: TIME_LABEL_W },
  headerCell: { width: DAY_COL_W, alignItems: 'center', paddingVertical: S.xs },
  headerCellToday: { backgroundColor: Colors.primary, borderRadius: R.sm, marginHorizontal: 2 },
  headerWd: { fontSize: 10, color: Colors.hint },
  headerWdToday: { color: 'rgba(255,255,255,0.8)' },
  headerDay: { fontSize: F.sm, fontWeight: '600', color: Colors.subtext, marginTop: 1 },
  headerDayToday: { color: '#FFFFFF' },
  gridScroll: { flex: 1 },
  grid: { flexDirection: 'row' },
  timeLabel: { fontSize: 9, color: Colors.hint, marginTop: -6, textAlign: 'right', paddingRight: S.xs },
  daysRow: { flexDirection: 'row', flex: 1 },
  dayCol: { width: DAY_COL_W, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: Colors.divider, position: 'relative' },
  dayColToday: { backgroundColor: 'rgba(0,113,227,0.03)' },
  slotCell: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(210,210,215,0.4)' },
  hourLine: { borderBottomColor: Colors.divider },
  block: {
    position: 'absolute',
    left: 3,
    right: 3,
    borderRadius: R.sm,
    padding: 4,
    overflow: 'hidden',
  },
  blockLabel: { fontSize: 11, fontWeight: '600', color: Colors.text, lineHeight: 14 },
  blockDetail: { marginTop: 2, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.divider, paddingTop: 2 },
  blockDetailText: { fontSize: 9, color: Colors.text, lineHeight: 12 },
  blockMeta: { fontSize: 9, color: Colors.subtext, marginLeft: 2 },
  blockMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 1 },
});
