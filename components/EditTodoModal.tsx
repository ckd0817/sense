import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Modal, ScrollView, Alert, Platform, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, S, R, F } from '../constants/theme';
import { Todo, updateTodo } from '../lib/db';
import { scheduleTodoReminder, cancelTodoReminder } from '../lib/notifications';
import DateTimePicker from '@react-native-community/datetimepicker';

interface Props {
  todo: Todo;
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export default function EditTodoModal({ todo, visible, onClose, onSaved }: Props) {
  const [title, setTitle] = useState(todo.title);
  const [recurring, setRecurring] = useState(!!todo.recurring);
  const [hasTime, setHasTime] = useState(!!todo.scheduled_time);
  const [date, setDate] = useState(todo.scheduled_time ? new Date(todo.scheduled_time) : new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [advance, setAdvance] = useState(String(todo.reminder_advance ?? 10));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setTitle(todo.title);
      setRecurring(!!todo.recurring);
      setHasTime(!!todo.scheduled_time);
      setDate(todo.scheduled_time ? new Date(todo.scheduled_time) : new Date());
      setAdvance(String(todo.reminder_advance ?? 10));
    }
  }, [visible, todo]);

  const save = async () => {
    if (!title.trim()) { Alert.alert('请填写标题'); return; }
    setSaving(true);
    try {
      const updates: Parameters<typeof updateTodo>[1] = {
        title: title.trim(),
        recurring: recurring ? 1 : 0,
      };

      if (hasTime) {
        updates.scheduled_time = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:00`;
        const adv = parseInt(advance, 10);
        updates.reminder_advance = isNaN(adv) || adv < 0 ? 10 : adv;
      } else {
        updates.scheduled_time = null;
        updates.reminder_advance = null;
      }

      await updateTodo(todo.id, updates);

      // Reschedule notification
      await cancelTodoReminder(todo.id);
      if (hasTime && updates.scheduled_time) {
        await scheduleTodoReminder(todo.id, title.trim(), updates.scheduled_time, updates.reminder_advance as number);
      }

      onSaved();
      onClose();
    } catch (e) {
      Alert.alert('保存失败', e instanceof Error ? e.message : '未知错误');
    } finally { setSaving(false); }
  };

  const onChangeDate = (_event: any, selected?: Date) => {
    setShowPicker(Platform.OS === 'ios');
    if (selected) setDate(selected);
  };

  const fmtDate = (d: Date) => `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={s.page} edges={['top']}>
        <View style={s.header}>
          <TouchableOpacity onPress={onClose}><Text style={s.cancelBtn}>取消</Text></TouchableOpacity>
          <Text style={s.title}>编辑待办</Text>
          <TouchableOpacity onPress={save} disabled={saving}><Text style={[s.saveBtn, saving && s.saveOff]}>{saving ? '...' : '保存'}</Text></TouchableOpacity>
        </View>
        <ScrollView style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          <Text style={s.label}>标题</Text>
          <TextInput style={s.input} value={title} onChangeText={setTitle} maxLength={50} />

          <Text style={s.label}>类型</Text>
          <View style={s.chips}>
            <TouchableOpacity style={[s.chip, !recurring && s.chipOn]} onPress={() => setRecurring(false)}>
              <Text style={[s.chipText, !recurring && s.chipTextOn]}>临时</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.chip, recurring && s.chipOn]} onPress={() => setRecurring(true)}>
              <Text style={[s.chipText, recurring && s.chipTextOn]}>每日习惯</Text>
            </TouchableOpacity>
          </View>

          {!recurring && (
            <>
              <View style={s.row}>
                <Text style={s.label}>计划时间</Text>
                <View style={s.spacer} />
                <Switch value={hasTime} onValueChange={setHasTime} />
              </View>
              {hasTime && (
                <>
                  <TouchableOpacity style={s.dateBtn} onPress={() => setShowPicker(true)}>
                    <Ionicons name="calendar-outline" size={16} color={Colors.primary} />
                    <Text style={s.dateText}>{fmtDate(date)}</Text>
                  </TouchableOpacity>
                  {showPicker && (
                    <DateTimePicker value={date} mode="datetime" display="default" onChange={onChangeDate} />
                  )}
                  <Text style={s.label}>提前提醒（分钟）</Text>
                  <TextInput style={s.input} value={advance} onChangeText={setAdvance} keyboardType="number-pad" maxLength={4} />
                </>
              )}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: Colors.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: S.lg, paddingTop: S.lg, paddingBottom: S.md },
  title: { fontSize: F.lg, fontWeight: '600', color: Colors.text },
  cancelBtn: { fontSize: F.md, color: Colors.hint },
  saveBtn: { fontSize: F.md, fontWeight: '600', color: Colors.primary },
  saveOff: { opacity: 0.4 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: S.lg, paddingBottom: S.xxl },
  label: { fontSize: F.xs, color: Colors.hint, marginBottom: S.xs, marginTop: S.md, fontWeight: '500' as const },
  input: { backgroundColor: Colors.surface, borderRadius: R.md, paddingHorizontal: S.md, paddingVertical: S.md, fontSize: F.md, color: Colors.text, borderWidth: 1, borderColor: Colors.divider },
  chips: { flexDirection: 'row', gap: S.sm, marginTop: S.xs },
  chip: { paddingHorizontal: S.md, paddingVertical: S.sm, borderRadius: R.xl, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.divider },
  chipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: F.xs, color: Colors.subtext },
  chipTextOn: { color: '#FFFFFF', fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: S.md },
  spacer: { flex: 1 },
  dateBtn: { flexDirection: 'row', alignItems: 'center', gap: S.xs, backgroundColor: Colors.surface, borderRadius: R.md, paddingHorizontal: S.md, paddingVertical: S.md, borderWidth: 1, borderColor: Colors.divider, marginTop: S.xs },
  dateText: { fontSize: F.md, color: Colors.text },
});
