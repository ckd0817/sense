import React, { useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl, LayoutAnimation, TouchableOpacity, AppState, DeviceEventEmitter } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import { getGranularity, getRecordsByDate, getTodosByDate, Record, Todo } from '../../lib/db';
import { DATA_CHANGED_EVENT } from '../../lib/agent';
import { Colors, S, R, F } from '../../constants/theme';
import { Ionicons } from '@expo/vector-icons';
import ActivityBlock from '../../components/ActivityBlock';
import TodoSection from '../../components/TodoSection';
import WeekSchedule from '../../components/WeekSchedule';

function dateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function getMonday(d: Date): Date {
  const r = new Date(d);
  const day = r.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  r.setDate(r.getDate() + diff);
  r.setHours(0, 0, 0, 0);
  return r;
}

const WEEKDAYS = ['日','一','二','三','四','五','六'];

export default function TodayScreen() {
  const [mode, setMode] = useState<'today' | 'history'>('today');
  const [records, setRecords] = useState<Record[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const [granularity, setGran] = useState(30);
  const [selectedDate, setSelectedDate] = useState(dateStr(new Date()));

  const selectedDateRef = useRef(selectedDate);
  selectedDateRef.current = selectedDate;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const loadDate = useCallback(async (date: string) => {
    const [r, t] = await Promise.all([getRecordsByDate(date), getTodosByDate(date)]);
    setRecords(r);
    setTodos(t);
  }, []);

  useFocusEffect(useCallback(() => {
    if (mode === 'today') {
      loadDate(selectedDateRef.current);
    }
    getGranularity().then(g => setGran(g));
  }, [mode, loadDate]));

  useEffect(() => {
    loadDate(selectedDate);
  }, [selectedDate, loadDate]);

  useEffect(() => {
    const syncToday = () => {
      const today = dateStr(new Date());
      if (modeRef.current === 'today' && selectedDateRef.current !== today) {
        setSelectedDate(today);
      }
    };

    const interval = setInterval(syncToday, 60 * 1000);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') syncToday();
    });

    syncToday();
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener(DATA_CHANGED_EVENT, () => {
      loadDate(selectedDateRef.current);
    });
    return () => subscription.remove();
  }, [loadDate]);

  const switchTo = (m: 'today' | 'history') => {
    if (m === mode) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setMode(m);
    if (m === 'today') loadDate(selectedDate);
  };

  // Pinch gesture
  const pinchScale = useRef(1);
  const pinchGesture = Gesture.Pinch()
    .onEnd((e) => {
      if (e.scale < 0.8 && mode === 'today') {
        pinchScale.current = e.scale;
        switchTo('history');
      } else if (e.scale > 1.2 && mode === 'history') {
        pinchScale.current = e.scale;
        switchTo('today');
      }
    });

  const now = new Date();
  const todayStr_ = dateStr(now);
  const isToday = selectedDate === todayStr_;
  const selDate = new Date(selectedDate + 'T00:00:00');

  const goPrev = () => setSelectedDate(dateStr(addDays(selDate, -1)));
  const goNext = () => setSelectedDate(dateStr(addDays(selDate, 1)));
  const goToday = () => setSelectedDate(todayStr_);

  // Week navigation
  const weekMonday = new Date(getMonday(now));
  weekMonday.setDate(weekMonday.getDate() + weekOffset * 7);
  const weekSunday = new Date(weekMonday);
  weekSunday.setDate(weekSunday.getDate() + 6);

  const weekLabel = `${weekMonday.getMonth() + 1}月${weekMonday.getDate()}日 – ${weekSunday.getMonth() + 1}月${weekSunday.getDate()}日`;

  const prevWeek = () => setWeekOffset(o => o - 1);
  const nextWeek = () => setWeekOffset(o => Math.min(o + 1, 0));
  const thisWeek = () => setWeekOffset(0);

  const dateLabel = `${selDate.getMonth() + 1}月${selDate.getDate()}日`;
  const weekdayLabel = `周${WEEKDAYS[selDate.getDay()]}`;

  const listHeader = (
    <>
      {todos.length > 0 ? <TodoSection todos={todos} currentDate={selectedDate} onChanged={() => loadDate(selectedDate)} /> : null}
    </>
  );

  return (
    <GestureDetector gesture={pinchGesture}>
      <SafeAreaView style={s.page} edges={['top']}>
        {mode === 'today' ? (
          <>
            <View style={s.header}>
              <View style={s.headerLeft}>
                <TouchableOpacity style={s.arrowBtn} onPress={goPrev} activeOpacity={0.6}>
                  <Ionicons name="chevron-back" size={22} color={Colors.primary} />
                </TouchableOpacity>
                <View style={s.dateCol}>
                  <Text style={s.date}>{dateLabel}</Text>
                  <Text style={s.weekday}>{weekdayLabel}{!isToday ? '' : records.length > 0 ? ` · ${records.length}个活动` : ''}</Text>
                </View>
                <TouchableOpacity style={s.arrowBtn} onPress={goNext} activeOpacity={0.6}>
                  <Ionicons name="chevron-forward" size={22} color={Colors.primary} />
                </TouchableOpacity>
              </View>
              {!isToday && (
                <TouchableOpacity style={s.todayChip} onPress={goToday} activeOpacity={0.7}>
                  <Text style={s.todayChipText}>今天</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={s.headerBtn} onPress={() => switchTo('history')}>
                <Ionicons name="calendar-outline" size={22} color={Colors.primary} />
              </TouchableOpacity>
            </View>

            <FlatList
              data={records}
              keyExtractor={item => item.id}
              renderItem={({ item }) => <ActivityBlock record={item} onChanged={() => loadDate(selectedDate)} />}
              ListHeaderComponent={listHeader}
              ListEmptyComponent={
                <View style={s.empty}>
                  <Text style={s.emptyTitle}>{isToday ? '新的一天' : '没有记录'}</Text>
                  <Text style={s.emptySub}>{isToday ? '点击「记录」开始' : '这天没有活动记录'}</Text>
                </View>
              }
              contentContainerStyle={s.list}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await loadDate(selectedDate); setRefreshing(false); }} tintColor={Colors.hint} />}
            />
          </>
        ) : (
          <>
            <View style={s.header}>
              <TouchableOpacity style={s.headerBtn} onPress={prevWeek}>
                <Ionicons name="chevron-back" size={22} color={Colors.primary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={thisWeek} activeOpacity={0.7}>
                <Text style={s.weekTitle}>{weekLabel}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.headerBtn} onPress={() => switchTo('today')}>
                <Ionicons name="close" size={22} color={Colors.primary} />
              </TouchableOpacity>
            </View>
            {weekOffset < 0 && (
              <TouchableOpacity style={s.backToday} onPress={nextWeek}>
                <Ionicons name="chevron-forward" size={14} color={Colors.primary} />
                <Text style={s.backTodayText}>下一周</Text>
              </TouchableOpacity>
            )}
            <WeekSchedule weekStart={weekMonday} granularity={granularity} />
          </>
        )}
      </SafeAreaView>
    </GestureDetector>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: Colors.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: S.lg, paddingTop: S.xl, paddingBottom: S.md },
  headerLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  dateCol: { alignItems: 'center', marginHorizontal: S.xs },
  date: { fontSize: F.xxl, fontWeight: '600', color: Colors.text, letterSpacing: -0.5 },
  weekday: { fontSize: F.sm, color: Colors.subtext, marginTop: S.xs },
  arrowBtn: { padding: S.sm },
  todayChip: { backgroundColor: Colors.primary, paddingHorizontal: S.md, paddingVertical: S.xs, borderRadius: R.xl, marginRight: S.sm },
  todayChipText: { color: '#fff', fontSize: F.xs, fontWeight: '600' },
  headerBtn: { padding: S.sm },
  list: { paddingHorizontal: S.lg, paddingBottom: S.xxl },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyTitle: { fontSize: F.xl, fontWeight: '600', color: Colors.text },
  emptySub: { fontSize: F.md, color: Colors.subtext, marginTop: S.sm },
  // History mode
  weekTitle: { fontSize: F.md, fontWeight: '600', color: Colors.text },
  backToday: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingBottom: S.sm, gap: S.xs },
  backTodayText: { fontSize: F.xs, color: Colors.primary },
});
