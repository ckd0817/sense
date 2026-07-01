import React, { useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl, LayoutAnimation, TouchableOpacity, AppState, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import { confirmPredictionsByDate, getGranularity, getPredictionSummaryByDate, getRecordsByDate, getTodosByDate, rejectPredictionsByDate, Record, Todo } from '../../lib/db';
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

interface PredictionSummary {
  pending: number;
  confirmed: number;
  rejected: number;
}

export default function TodayScreen() {
  const [mode, setMode] = useState<'today' | 'history'>('today');
  const [records, setRecords] = useState<Record[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const [granularity, setGran] = useState(30);
  const [selectedDate, setSelectedDate] = useState(dateStr(new Date()));
  const [prediction, setPrediction] = useState<PredictionSummary>({ pending: 0, confirmed: 0, rejected: 0 });

  const selectedDateRef = useRef(selectedDate);
  selectedDateRef.current = selectedDate;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const loadDate = useCallback(async (date: string) => {
    const [r, t, p] = await Promise.all([getRecordsByDate(date), getTodosByDate(date), getPredictionSummaryByDate(date)]);
    setRecords(r);
    setTodos(t);
    setPrediction({ pending: p.pending, confirmed: p.confirmed, rejected: p.rejected });
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

  const confirmTodayPrediction = async () => {
    await confirmPredictionsByDate(selectedDate);
    await loadDate(selectedDate);
  };

  const rejectTodayPrediction = () => {
    Alert.alert('拒绝今日预测', '确定拒绝今天全部待确认预测？', [
      { text: '取消', style: 'cancel' },
      { text: '拒绝全部', style: 'destructive', onPress: async () => {
        await rejectPredictionsByDate(selectedDate);
        await loadDate(selectedDate);
      }},
    ]);
  };

  const listHeader = (
    <>
      {prediction.pending > 0 && (
        <View style={s.predictionCard}>
          <View style={s.predictionTitleRow}>
            <Ionicons name="sparkles-outline" size={18} color={Colors.primary} />
            <Text style={s.predictionTitle}>今日预测</Text>
            <Text style={s.predictionCount}>{prediction.pending} 条</Text>
          </View>
          <View style={s.predictionActions}>
            <TouchableOpacity style={s.predictionOutlineBtn} onPress={rejectTodayPrediction} activeOpacity={0.7}>
              <Text style={s.predictionOutlineText}>拒绝全部</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.predictionPrimaryBtn} onPress={confirmTodayPrediction} activeOpacity={0.7}>
              <Text style={s.predictionPrimaryText}>确认今日预测</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
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
  predictionCard: { backgroundColor: Colors.surface, borderRadius: R.lg, padding: S.md, marginBottom: S.md, borderWidth: 1, borderColor: 'rgba(0,113,227,0.18)' },
  predictionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: S.xs },
  predictionTitle: { fontSize: F.md, fontWeight: '600', color: Colors.text },
  predictionCount: { fontSize: F.xs, color: Colors.hint, marginLeft: 'auto' },
  predictionActions: { flexDirection: 'row', gap: S.sm, marginTop: S.md },
  predictionOutlineBtn: { flex: 1, height: 40, borderRadius: R.xl, borderWidth: 1, borderColor: Colors.divider, alignItems: 'center', justifyContent: 'center' },
  predictionOutlineText: { fontSize: F.sm, fontWeight: '600', color: Colors.text },
  predictionPrimaryBtn: { flex: 1.2, height: 40, borderRadius: R.xl, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  predictionPrimaryText: { fontSize: F.sm, fontWeight: '600', color: '#fff' },
});
