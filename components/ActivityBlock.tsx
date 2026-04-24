import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, LayoutAnimation } from 'react-native';
import { Colors, S, R, F, Categories, CategoryColors } from '../constants/theme';
import { Record } from '../lib/db';

interface Props {
  record: Record;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

export default function ActivityBlock({ record }: Props) {
  const [open, setOpen] = useState(false);

  const emoji = Categories[record.category] || '·';
  const bgColor = CategoryColors[record.category] || CategoryColors['其他'];
  const timeRange = record.end_time
    ? `${fmtTime(record.start_time)} – ${fmtTime(record.end_time)}`
    : `${fmtTime(record.start_time)} – 现在`;

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen(!open);
  };

  return (
    <TouchableOpacity style={[s.block, { backgroundColor: bgColor }]} onPress={toggle} activeOpacity={0.7}>
      <View style={s.top}>
        <Text style={s.emoji}>{emoji}</Text>
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
        </View>
      )}
      <View style={s.catWrap}>
        <Text style={s.cat}>{record.category}</Text>
      </View>
    </TouchableOpacity>
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
  emoji: { fontSize: 20 },
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
