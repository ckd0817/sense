import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, LayoutAnimation, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, S, R, F, HOUR_HEIGHT, CategoryIcons, CategoryColors } from '../constants/theme';
import { Record, getRecordsByDateRange } from '../lib/db';
import { snapTime, toLocalISO } from '../lib/time';

const WDS = ['一', '二', '三', '四', '五', '六', '日'];
const START_HOUR = 6;
const END_HOUR = 24;
const HOURS = END_HOUR - START_HOUR;
const TIME_LABEL_W = 36;
const MIN_DAY_COL_W = 108;

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
  const { width } = useWindowDimensions();
  const dayColWidth = Math.max(MIN_DAY_COL_W, Math.floor((width - TIME_LABEL_W) / 3.25));

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
        hScrollRef.current?.scrollTo({ x: todayIndex * dayColWidth, animated: true });
      }, 100);
    }
  }, [monday.getTime(), dayColWidth]);

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
    const snappedStart = snapTime(rec.start_time, granularity);
    const snappedEnd = rec.end_time ? snapTime(rec.end_time, granularity) : snapTime(toLocalISO(new Date()), granularity);

    const start = new Date(snappedStart);
    const end = new Date(snappedEnd);
    const startOffset = (start.getHours() + start.getMinutes() / 60) - START_HOUR;
    const durationHours = Math.max((end.getTime() - start.getTime()) / 3600000, granularity / 60);
    const top = startOffset * HOUR_HEIGHT;
    const height = durationHours * HOUR_HEIGHT;
    const bg = CategoryColors[rec.category] || CategoryColors['其他'];
    const isOpen = expanded === rec.id;
    const blockHeight = Math.max(height, slotHeight);
    const compact = blockHeight < 24;
    const titleLines = blockHeight >= 72 ? 3 : blockHeight >= 42 ? 2 : 1;

    if (startOffset < 0 || startOffset >= HOURS) return null;

    return (
      <TouchableOpacity
        key={rec.id}
        style={[s.block, compact && s.blockCompact, { top, height: blockHeight, backgroundColor: bg }]}
        onPress={() => toggleExpand(rec.id)}
        activeOpacity={0.7}
      >
        <Text style={[s.blockLabel, compact && s.blockLabelCompact]} numberOfLines={titleLines}>{rec.activity}</Text>
        {isOpen && (
          <View style={s.blockDetail}>
            {rec.details ? <Text style={s.blockDetailText} numberOfLines={3}>{rec.details}</Text> : null}
            {rec.location ? <View style={s.blockMetaRow}><Ionicons name="location-outline" size={10} color={Colors.subtext} /><Text style={s.blockMeta}>{rec.location}</Text></View> : null}
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const contentWidth = TIME_LABEL_W + dayColWidth * 7;

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
                <View key={ds} style={[s.headerCell, { width: dayColWidth }]}>
                  <View style={[s.headerPill, isToday && s.headerPillToday]}>
                    <Text style={[s.headerWd, isToday && s.headerWdToday]}>{WDS[i]}</Text>
                    <Text style={[s.headerDay, isToday && s.headerDayToday]}>{d.getDate()}</Text>
                  </View>
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
                    <View key={ds} style={[s.dayCol, { width: dayColWidth }, isToday && s.dayColToday]}>
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
  headerCell: { alignItems: 'stretch', paddingVertical: S.xs, paddingHorizontal: 3 },
  headerPill: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: R.sm },
  headerPillToday: { backgroundColor: Colors.primary },
  headerWd: { fontSize: 11, color: Colors.hint, includeFontPadding: false },
  headerWdToday: { color: 'rgba(255,255,255,0.8)' },
  headerDay: { fontSize: F.md, fontWeight: '600', color: Colors.subtext, marginTop: 3, includeFontPadding: false },
  headerDayToday: { color: '#FFFFFF' },
  gridScroll: { flex: 1 },
  grid: { flexDirection: 'row' },
  timeLabel: { fontSize: 9, color: Colors.hint, marginTop: -6, textAlign: 'right', paddingRight: S.xs },
  daysRow: { flexDirection: 'row', flex: 1 },
  dayCol: { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: Colors.divider, position: 'relative' },
  dayColToday: { backgroundColor: 'rgba(0,113,227,0.03)' },
  slotCell: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(210,210,215,0.4)' },
  hourLine: { borderBottomColor: Colors.divider },
  block: {
    position: 'absolute',
    left: 4,
    right: 4,
    borderRadius: R.sm,
    paddingHorizontal: 6,
    paddingVertical: 5,
    overflow: 'hidden',
    justifyContent: 'flex-start',
  },
  blockCompact: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    justifyContent: 'center',
  },
  blockLabel: { fontSize: 12, fontWeight: '600', color: Colors.text, lineHeight: 16, includeFontPadding: false },
  blockLabelCompact: { fontSize: 10, lineHeight: 12 },
  blockDetail: { marginTop: 2, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.divider, paddingTop: 2 },
  blockDetailText: { fontSize: 10, color: Colors.text, lineHeight: 13, includeFontPadding: false },
  blockMeta: { fontSize: 10, color: Colors.subtext, marginLeft: 2, includeFontPadding: false },
  blockMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 1 },
});
