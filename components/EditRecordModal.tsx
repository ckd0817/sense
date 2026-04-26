import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Modal, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, S, R, F, CategoryIcons } from '../constants/theme';
import { Record, updateRecord, getCustomCategories } from '../lib/db';

interface Props {
  record: Record;
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export default function EditRecordModal({ record, visible, onClose, onSaved }: Props) {
  const [activity, setActivity] = useState(record.activity);
  const [category, setCategory] = useState(record.category);
  const [details, setDetails] = useState(record.details);
  const [mood, setMood] = useState(record.mood);
  const [social, setSocial] = useState(record.social);
  const [location, setLocation] = useState(record.location);
  const [saving, setSaving] = useState(false);
  const [allCategories, setAllCategories] = useState(Object.keys(CategoryIcons));

  useEffect(() => {
    if (visible) {
      getCustomCategories().then(custom => {
        const defaults = Object.keys(CategoryIcons);
        setAllCategories([...defaults, ...custom.filter(c => !defaults.includes(c))]);
      });
    }
  }, [visible]);

  const save = async () => {
    if (!activity.trim()) { Alert.alert('请填写活动名称'); return; }
    setSaving(true);
    try {
      await updateRecord(record.id, {
        activity: activity.trim(),
        category,
        details: details.trim(),
        mood: mood.trim(),
        social: social.trim(),
        location: location.trim(),
      });
      onSaved();
      onClose();
    } catch (e) {
      Alert.alert('保存失败', e instanceof Error ? e.message : '未知错误');
    } finally { setSaving(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={s.page} edges={['top']}>
        <View style={s.header}>
          <TouchableOpacity onPress={onClose}><Text style={s.cancelBtn}>取消</Text></TouchableOpacity>
          <Text style={s.title}>编辑活动</Text>
          <TouchableOpacity onPress={save} disabled={saving}><Text style={[s.saveBtn, saving && s.saveOff]}>{saving ? '...' : '保存'}</Text></TouchableOpacity>
        </View>
        <ScrollView style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          <Text style={s.label}>活动名称</Text>
          <TextInput style={s.input} value={activity} onChangeText={setActivity} maxLength={50} />

          <Text style={s.label}>分类</Text>
          <View style={s.chips}>
            {allCategories.map(cat => (
              <TouchableOpacity key={cat} style={[s.chip, category === cat && s.chipOn]} onPress={() => setCategory(cat)}>
                <Text style={[s.chipText, category === cat && s.chipTextOn]}>{cat}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={s.label}>详情</Text>
          <TextInput style={[s.input, s.tallInput]} value={details} onChangeText={setDetails} multiline maxLength={500} textAlignVertical="top" />

          <Text style={s.label}>感受</Text>
          <TextInput style={s.input} value={mood} onChangeText={setMood} maxLength={30} placeholder="可选" placeholderTextColor={Colors.hint} />

          <Text style={s.label}>和谁</Text>
          <TextInput style={s.input} value={social} onChangeText={setSocial} maxLength={30} placeholder="可选" placeholderTextColor={Colors.hint} />

          <Text style={s.label}>在哪</Text>
          <TextInput style={s.input} value={location} onChangeText={setLocation} maxLength={30} placeholder="可选" placeholderTextColor={Colors.hint} />
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
  tallInput: { minHeight: 80, paddingTop: S.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm, marginTop: S.xs },
  chip: { paddingHorizontal: S.md, paddingVertical: S.sm, borderRadius: R.xl, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.divider },
  chipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: F.xs, color: Colors.subtext },
  chipTextOn: { color: '#FFFFFF', fontWeight: '600' },
});
