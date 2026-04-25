import React, { useState, useCallback, useRef } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl, LayoutAnimation, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import { getTodayRecords, getGranularity, getTodayTodos, Record, Todo } from '../../lib/db';
import { Colors, S, R, F } from '../../constants/theme';
import { Ionicons } from '@expo/vector-icons';
import ActivityBlock from '../../components/ActivityBlock';
import TodoSection from '../../components/TodoSection';
import WeekSchedule from '../../components/WeekSchedule';

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

export default function TodayScreen() {
  const [mode, setMode] = useState<'today' | 'history'>('today');
  const [records, setRecords] = useState<Record[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const [granularity, setGran] = useState(30);
  const pinchScale = useRef(1);

  const loadToday = useCallback(async () => {
    const [r, t] = await Promise.all([getTodayRecords(), getTodayTodos()]);
    setRecords(r);
    setTodos(t);
  }, []);

  useFocusEffect(useCallback(() => {
    if (mode === 'today') loadToday();
    getGranularity().then(g => setGran(g));
  }, [mode, loadToday]));

  const switchTo = (m: 'today' | 'history') => {
    if (m === mode) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setMode(m);
    if (m === 'today') loadToday();
  };

  // Pinch gesture
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
  const wd = ['日','一','二','三','四','五','六'];

  // Week navigation
  const weekMonday = new Date(getMonday(now));
  weekMonday.setDate(weekMonday.getDate() + weekOffset * 7);
  const weekSunday = new Date(weekMonday);
  weekSunday.setDate(weekSunday.getDate() + 6);

  const weekLabel = `${weekMonday.getMonth() + 1}月${weekMonday.getDate()}日 – ${weekSunday.getMonth() + 1}月${weekSunday.getDate()}日`;

  const prevWeek = () => setWeekOffset(o => o - 1);
  const nextWeek = () => setWeekOffset(o => Math.min(o + 1, 0));
  const thisWeek = () => setWeekOffset(0);

  return (
    <GestureDetector gesture={pinchGesture}>
      <SafeAreaView style={s.page} edges={['top']}>
        {mode === 'today' ? (
          <>
            <View style={s.header}>
              <View>
                <Text style={s.date}>{now.getMonth() + 1}月{now.getDate()}日</Text>
                <Text style={s.weekday}>周{wd[now.getDay()]}{records.length > 0 ? ` · ${records.length}个活动` : ''}</Text>
              </View>
              <TouchableOpacity style={s.headerBtn} onPress={() => switchTo('history')}>
                <Ionicons name="calendar-outline" size={22} color={Colors.primary} />
              </TouchableOpacity>
            </View>

            <FlatList
              data={records}
              keyExtractor={item => item.id}
              renderItem={({ item }) => <ActivityBlock record={item} onChanged={loadToday} />}
              ListHeaderComponent={todos.length > 0 ? <TodoSection todos={todos} onChanged={loadToday} /> : null}
              ListEmptyComponent={<View style={s.empty}><Text style={s.emptyTitle}>新的一天</Text><Text style={s.emptySub}>点击「记录」开始</Text></View>}
              contentContainerStyle={s.list}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await loadToday(); setRefreshing(false); }} tintColor={Colors.hint} />}
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
  date: { fontSize: F.xxl, fontWeight: '600', color: Colors.text, letterSpacing: -0.5 },
  weekday: { fontSize: F.sm, color: Colors.subtext, marginTop: S.xs },
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
