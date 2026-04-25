import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, LayoutAnimation, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, S, R, F, CategoryIcons, CategoryColors } from '../constants/theme';
import { Record, deleteRecord } from '../lib/db';
import EditRecordModal from './EditRecordModal';

interface Props {
  record: Record;
  onChanged: () => void;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

export default function ActivityBlock({ record, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  const iconName = CategoryIcons[record.category] || 'ellipse-outline';
  const bgColor = CategoryColors[record.category] || CategoryColors['其他'];
  const timeRange = record.end_time
    ? `${fmtTime(record.start_time)} – ${fmtTime(record.end_time)}`
    : `${fmtTime(record.start_time)} – 现在`;

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen(!open);
  };

  const handleDelete = () => {
    Alert.alert('删除活动', `确定删除「${record.activity}」？`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: async () => {
        await deleteRecord(record.id);
        onChanged();
      }},
    ]);
  };

  return (
    <>
      <TouchableOpacity style={[s.block, { backgroundColor: bgColor }]} onPress={toggle} activeOpacity={0.7}>
        <View style={s.top}>
          <View style={s.iconWrap}>
            <Ionicons name={iconName as any} size={18} color={Colors.text} />
          </View>
          <View style={s.info}>
            <Text style={s.name}>{record.activity}</Text>
            <Text style={s.timeRange}>{timeRange}</Text>
          </View>
          {record.location ? <Text style={s.loc}>{record.location}</Text> : null}
        </View>
        {open && (
          <View style={s.detail}>
            {record.details ? <Text style={s.detailText}>{record.details}</Text> : null}
            {record.mood ? <Text style={s.detailMeta}>感受：{record.mood}</Text> : null}
            {record.social ? <Text style={s.detailMeta}>和谁：{record.social}</Text> : null}
            {record.location ? <Text style={s.detailMeta}>在哪：{record.location}</Text> : null}
            <Text style={s.rawText}>{record.raw_text}</Text>
            <View style={s.actions}>
              <TouchableOpacity style={s.editBtn} onPress={() => setEditing(true)}>
                <Text style={s.editText}>编辑</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.delBtn} onPress={handleDelete}>
                <Text style={s.delText}>删除</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        <View style={s.catWrap}>
          <Text style={s.cat}>{record.category}</Text>
        </View>
      </TouchableOpacity>
      <EditRecordModal
        record={record}
        visible={editing}
        onClose={() => setEditing(false)}
        onSaved={onChanged}
      />
    </>
  );
}

const s = StyleSheet.create({
  block: {
    borderRadius: R.lg,
    padding: S.md,
    marginBottom: S.sm,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.06)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  info: { flex: 1 },
  name: { fontSize: F.md, fontWeight: '600', color: Colors.text },
  timeRange: { fontSize: F.xs, color: Colors.subtext, marginTop: 2 },
  loc: { fontSize: F.xs, color: Colors.hint },
  detail: {
    marginTop: S.md,
    paddingTop: S.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.divider,
  },
  detailText: { fontSize: F.sm, color: Colors.text, lineHeight: 20 },
  detailMeta: { fontSize: F.sm, color: Colors.subtext, marginTop: S.xs },
  rawText: { fontSize: F.xs, color: Colors.hint, fontStyle: 'italic', marginTop: S.sm },
  actions: {
    flexDirection: 'row',
    gap: S.sm,
    marginTop: S.md,
  },
  editBtn: {
    paddingHorizontal: S.md,
    paddingVertical: S.sm,
    borderRadius: R.sm,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  editText: { fontSize: F.sm, color: Colors.primary, fontWeight: '600' },
  delBtn: {
    paddingHorizontal: S.md,
    paddingVertical: S.sm,
    borderRadius: R.sm,
    borderWidth: 1,
    borderColor: '#FF3B30',
  },
  delText: { fontSize: F.sm, color: '#FF3B30', fontWeight: '600' },
  catWrap: {
    alignSelf: 'flex-start',
    marginTop: S.sm,
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderRadius: R.sm,
    paddingHorizontal: S.sm,
    paddingVertical: 2,
  },
  cat: { fontSize: F.xs, color: Colors.subtext },
});
