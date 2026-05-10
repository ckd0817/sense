import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { getChatDates, getChatMessages, ChatMessage } from '../../lib/db';
import { Colors, S, R, F } from '../../constants/theme';
import { Ionicons } from '@expo/vector-icons';

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

  const base = `${d.getMonth() + 1}月${d.getDate()}日 周${'日一二三四五六'[d.getDay()]}`;
  if (dateStr === today) return `今天 · ${base}`;
  if (dateStr === yStr) return `昨天 · ${base}`;
  return base;
}

interface ChatDateInfo {
  chat_date: string;
  count: number;
}

export default function HistoryScreen() {
  const router = useRouter();
  const [dates, setDates] = useState<ChatDateInfo[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const loadDates = useCallback(async () => {
    const result = await getChatDates();
    setDates(result as ChatDateInfo[]);
  }, []);

  useFocusEffect(useCallback(() => {
    if (!selectedDate) loadDates();
  }, [selectedDate, loadDates]));

  const openDate = async (date: string) => {
    const msgs = await getChatMessages(date);
    setMessages(msgs.filter(m => m.role !== 'tool'));
    setSelectedDate(date);
  };

  const goBack = () => {
    setSelectedDate(null);
    setMessages([]);
  };

  const toolLabel: Record<string, string> = {
    create_activity: '记录活动',
    update_activity: '修改活动',
    delete_activity: '删除活动',
    create_todo: '创建待办',
    update_todo: '修改待办',
    delete_todo: '删除待办',
  };

  // Detail view for a specific date
  if (selectedDate) {
    return (
      <SafeAreaView style={s.page} edges={['top']}>
        <View style={s.header}>
          <TouchableOpacity style={s.headerBtn} onPress={goBack}>
            <Ionicons name="chevron-back" size={22} color={Colors.primary} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>{formatDateLabel(selectedDate)}</Text>
          <View style={s.headerBtn} />
        </View>
        <FlatList
          data={messages}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <View style={[s.bubble, item.role === 'user' ? s.bubbleUser : s.bubbleAsst]}>
              <Text style={[s.bubbleText, item.role === 'user' && s.bubbleTextUser]}>
                {item.content || '...'}
              </Text>
              {item.role === 'assistant' && item.tool_calls && (
                <View style={s.toolRow}>
                  {(() => {
                    try {
                      const tcs = JSON.parse(item.tool_calls);
                      return tcs.map((tc: any, i: number) => (
                        <View key={i} style={s.toolTag}>
                          <Text style={s.toolTagText}>{toolLabel[tc.function?.name || tc.name] || tc.function?.name || '?'}</Text>
                        </View>
                      ));
                    } catch { return null; }
                  })()}
                </View>
              )}
            </View>
          )}
          contentContainerStyle={s.list}
          ListEmptyComponent={
            <View style={s.empty}>
              <Text style={s.emptyText}>没有对话记录</Text>
            </View>
          }
        />
        <View style={s.footer}>
          <TouchableOpacity style={s.continueBtn} onPress={() => router.navigate({ pathname: '/record', params: { date: selectedDate } })}>
            <Ionicons name="chatbubble-ellipses-outline" size={18} color={Colors.primary} />
            <Text style={s.continueText}>继续对话</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Date list view
  return (
    <SafeAreaView style={s.page} edges={['top']}>
      <View style={s.header}>
        <View style={s.headerBtn} />
        <Text style={s.headerTitle}>对话历史</Text>
        <View style={s.headerBtn} />
      </View>
      <FlatList
        data={dates}
        keyExtractor={item => item.chat_date}
        renderItem={({ item }) => (
          <TouchableOpacity style={s.dateCard} onPress={() => openDate(item.chat_date)} activeOpacity={0.6}>
            <View style={s.dateCardLeft}>
              <Text style={s.dateCardLabel}>{formatDateLabel(item.chat_date)}</Text>
            </View>
            <View style={s.dateCardRight}>
              <Text style={s.msgCount}>{item.count} 条消息</Text>
              <Ionicons name="chevron-forward" size={18} color={Colors.hint} />
            </View>
          </TouchableOpacity>
        )}
        contentContainerStyle={s.list}
        ListEmptyComponent={
          <View style={s.empty}>
            <Ionicons name="chatbubble-ellipses-outline" size={48} color={Colors.divider} />
            <Text style={s.emptyText}>还没有对话记录</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: S.lg,
    paddingTop: S.xl,
    paddingBottom: S.md,
  },
  headerTitle: { fontSize: F.lg, fontWeight: '600', color: Colors.text },
  headerBtn: { padding: S.sm, width: 40 },
  list: { paddingHorizontal: S.lg, paddingBottom: S.xxl },
  // Date list
  dateCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: R.lg,
    padding: S.md,
    marginBottom: S.sm,
    borderWidth: 1,
    borderColor: Colors.divider,
  },
  dateCardLeft: { flex: 1 },
  dateCardLabel: { fontSize: F.md, fontWeight: '500', color: Colors.text },
  dateCardRight: { flexDirection: 'row', alignItems: 'center', gap: S.xs },
  msgCount: { fontSize: F.xs, color: Colors.hint },
  // Chat detail
  bubble: {
    maxWidth: '85%',
    padding: S.md,
    borderRadius: R.lg,
    marginBottom: S.sm,
  },
  bubbleUser: {
    backgroundColor: Colors.primary,
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  bubbleAsst: {
    backgroundColor: Colors.surface,
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: Colors.divider,
  },
  bubbleText: {
    fontSize: F.sm,
    color: Colors.text,
    lineHeight: 20,
  },
  bubbleTextUser: { color: '#fff' },
  toolRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: S.xs,
    marginTop: S.sm,
  },
  toolTag: {
    backgroundColor: '#E8F5E9',
    paddingHorizontal: S.sm,
    paddingVertical: 2,
    borderRadius: R.sm,
  },
  toolTagText: { fontSize: F.xs - 1, color: Colors.subtext },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: S.md },
  emptyText: { fontSize: F.md, color: Colors.hint },
  footer: { paddingHorizontal: S.lg, paddingVertical: S.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.divider, backgroundColor: Colors.surface },
  continueBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: S.xs, paddingVertical: S.md, borderRadius: R.xl, borderWidth: 1, borderColor: Colors.primary },
  continueText: { fontSize: F.md, fontWeight: '600', color: Colors.primary },
});
