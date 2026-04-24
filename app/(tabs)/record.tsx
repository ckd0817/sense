import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { insertActivity, getGranularity } from '../../lib/db';
import { processInput, StructuredActivity } from '../../lib/ai';
import { snapTime } from '../../lib/time';
import { Colors, S, R, F } from '../../constants/theme';

export default function RecordScreen() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const router = useRouter();

  const submit = async () => {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    try {
      const now = new Date().toISOString();

      // Reset reminder
      import('../../lib/notifications').then(m => m.resetReminderAfterRecord()).catch(() => {});

      // AI parse
      const granularity = await getGranularity();
      let activities: StructuredActivity[] = [];
      try {
        const result = await processInput(t, granularity);
        activities = result.activities;
      } catch {
        // AI failed — save as single raw activity
        activities = [{
          activity: t.slice(0, 20),
          category: '其他',
          details: t,
          mood: '',
          social: '',
          location: '',
          start_time: now,
          end_time: now,
        }];
      }

      // Insert each activity, snap times to granularity
      for (const a of activities) {
        const snappedStart = snapTime(a.start_time, granularity, 'floor');
        const snappedEnd = a.end_time ? snapTime(a.end_time, granularity, 'ceil') : null;
        await insertActivity({
          created_at: now,
          start_time: snappedStart,
          end_time: snappedEnd,
          raw_text: t,
          activity: a.activity,
          category: a.category,
          details: a.details,
          mood: a.mood,
          social: a.social,
          location: a.location,
        });
      }

      setDone(true);
      setTimeout(() => { setText(''); setDone(false); router.navigate('/'); }, 600);
    } catch (e) {
      Alert.alert('保存失败', e instanceof Error ? e.message : '未知错误');
    } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={s.page} edges={['top']}>
      <KeyboardAvoidingView style={s.inner} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Text style={s.time}>{new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</Text>
        <View style={s.inputWrap}>
          <TextInput
            style={s.input}
            value={text}
            onChangeText={setText}
            placeholder="说点什么… 比如「一小时前在食堂吃午饭，然后回宿舍休息了半小时」"
            placeholderTextColor={Colors.hint}
            multiline autoFocus maxLength={2000} editable={!busy} textAlignVertical="top"
          />
          <Text style={s.count}>{text.length}</Text>
        </View>
        <TouchableOpacity style={[s.btn, (!text.trim() || busy) && s.btnOff, done && s.btnDone]} onPress={submit} disabled={!text.trim() || busy} activeOpacity={0.7}>
          {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.btnText}>{done ? '✓' : '记录'}</Text>}
        </TouchableOpacity>
        <Text style={s.tip}>可以描述多个活动，AI 会自动解析时间和分类</Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: Colors.bg },
  inner: { flex: 1, paddingHorizontal: S.lg },
  time: { paddingTop: S.xxl, paddingBottom: S.xl, fontSize: F.hero, fontWeight: '300', color: Colors.text, textAlign: 'center', fontVariant: ['tabular-nums'] },
  inputWrap: { flex: 1, backgroundColor: Colors.surface, borderRadius: R.lg, borderWidth: 1, borderColor: Colors.divider, padding: S.md },
  input: { flex: 1, fontSize: F.md, color: Colors.text, lineHeight: 24 },
  count: { fontSize: F.xs, color: Colors.hint, textAlign: 'right', marginTop: S.xs },
  btn: { marginTop: S.lg, height: 50, borderRadius: R.xl, backgroundColor: Colors.primary, justifyContent: 'center', alignItems: 'center' },
  btnOff: { opacity: 0.35 },
  btnDone: { backgroundColor: Colors.success },
  btnText: { fontSize: F.md, fontWeight: '600', color: '#FFFFFF' },
  tip: { paddingTop: S.lg, fontSize: F.xs, color: Colors.subtext, textAlign: 'center' },
});
