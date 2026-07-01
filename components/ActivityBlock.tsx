import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { Colors, S, R, F, CategoryIcons, CategoryColors } from '../constants/theme';
import { Record, deleteRecord, rejectPredictionRecord } from '../lib/db';
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
  const [editing, setEditing] = useState(false);
  const swipeRef = React.useRef<Swipeable>(null);

  const iconName = CategoryIcons[record.category] || 'ellipse-outline';
  const bgColor = CategoryColors[record.category] || CategoryColors['其他'];
  const timeRange = record.end_time
    ? `${fmtTime(record.start_time)} – ${fmtTime(record.end_time)}`
    : `${fmtTime(record.start_time)} – 现在`;
  const isPendingPrediction = record.source === 'prediction' && record.prediction_status === 'pending';

  const handleDelete = () => {
    swipeRef.current?.close();
    if (isPendingPrediction) {
      Alert.alert('拒绝预测', `确定拒绝「${record.activity}」这条预测？`, [
        { text: '取消', style: 'cancel' },
        { text: '拒绝', style: 'destructive', onPress: async () => {
          await rejectPredictionRecord(record.id);
          onChanged();
        }},
      ]);
      return;
    }
    Alert.alert('删除活动', `确定删除「${record.activity}」？`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: async () => {
        await deleteRecord(record.id);
        onChanged();
      }},
    ]);
  };

  const handleEdit = () => {
    swipeRef.current?.close();
    setEditing(true);
  };

  const renderRightActions = () => (
    <View style={s.swipeActions}>
      <TouchableOpacity style={s.swipeEditBtn} onPress={handleEdit}>
        <Ionicons name="create-outline" size={20} color="#fff" />
        <Text style={s.swipeBtnText}>编辑</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.swipeDelBtn} onPress={handleDelete}>
        <Ionicons name={isPendingPrediction ? 'close-outline' : 'trash-outline'} size={20} color="#fff" />
        <Text style={s.swipeBtnText}>{isPendingPrediction ? '拒绝' : '删除'}</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <>
      <Swipeable ref={swipeRef} renderRightActions={renderRightActions} overshootRight={false} friction={2}>
        <View style={[s.block, { backgroundColor: bgColor }]}>
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
          <View style={s.detail}>
            {record.details ? <Text style={s.detailText}>{record.details}</Text> : null}
          </View>
          <View style={s.catWrap}>
            <Text style={s.cat}>{record.category}</Text>
          </View>
          {isPendingPrediction && (
            <View style={s.predictionWrap}>
              <Ionicons name="sparkles-outline" size={11} color={Colors.primary} />
              <Text style={s.predictionText}>预测</Text>
            </View>
          )}
        </View>
      </Swipeable>
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
  swipeActions: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: S.sm,
  },
  swipeEditBtn: {
    width: 64,
    height: 64,
    borderRadius: R.md,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: S.sm,
  },
  swipeDelBtn: {
    width: 64,
    height: 64,
    borderRadius: R.md,
    backgroundColor: '#FF3B30',
    justifyContent: 'center',
    alignItems: 'center',
  },
  swipeBtnText: {
    fontSize: 10,
    color: '#fff',
    fontWeight: '600',
    marginTop: 2,
  },
  catWrap: {
    alignSelf: 'flex-start',
    marginTop: S.sm,
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderRadius: R.sm,
    paddingHorizontal: S.sm,
    paddingVertical: 2,
  },
  cat: { fontSize: F.xs, color: Colors.subtext },
  predictionWrap: {
    position: 'absolute',
    right: S.md,
    bottom: S.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(0,113,227,0.08)',
    borderRadius: R.sm,
    paddingHorizontal: S.xs + 2,
    paddingVertical: 2,
  },
  predictionText: { fontSize: F.xs - 1, color: Colors.primary, fontWeight: '600' },
});
