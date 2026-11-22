import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { CloudKitAccountInfo, CloudKitRecord } from 'react-native-nitro-cloudkit';
import { cloud } from './cloud';

function Button({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.button}>
      <Text style={styles.buttonText}>{title}</Text>
    </Pressable>
  );
}

export function App() {
  const [account, setAccount] = useState<CloudKitAccountInfo | null>(null);
  const [notes, setNotes] = useState<Record<string, CloudKitRecord>>({});
  const [message, setMessage] = useState('');

  const attempt = useCallback(async (label: string, work: () => Promise<string>) => {
    try {
      setMessage(`${label}: ${await work()}`);
    } catch (error) {
      setMessage(`${label} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, []);

  const pull = useCallback(
    () =>
      attempt('Pull', async () => {
        const changes = await cloud.pull();
        setNotes((current) => {
          const next = changes.zoneWasDeleted ? {} : { ...current };
          for (const record of changes.modified) next[record.recordName] = record;
          for (const ref of changes.deleted) delete next[ref.recordName];
          return next;
        });
        await changes.commit();
        return `${changes.modified.length} changed, ${changes.deleted.length} deleted`;
      }),
    [attempt],
  );

  useEffect(() => {
    void attempt('Account', async () => {
      const info = await cloud.getAccount();
      setAccount(info);
      return info.status;
    });
    const stopRemote = cloud.onRemoteChange(() => void pull());
    const stopAccount = cloud.onAccountChange((change) => setMessage(`Account: ${change.type}`));
    return () => {
      stopRemote();
      stopAccount();
    };
  }, [attempt, pull]);

  const addNote = () =>
    attempt('Save', async () => {
      const name = `note.${Date.now().toString(36)}`;
      const result = await cloud.sendChanges({
        recordsToSave: [
          {
            recordType: 'note',
            recordName: name,
            encryptedFields: { text: `Note ${new Date().toLocaleTimeString()}` },
          },
        ],
      });
      for (const record of result.saved)
        setNotes((current) => ({ ...current, [record.recordName]: record }));
      return `${result.saved.length} saved, ${result.conflicts.length} conflicts, ${result.failed.length} failed`;
    });

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <StatusBar style="auto" />
      <Text style={styles.title}>CloudKit Example</Text>
      <Text style={styles.meta}>
        Adapter: {cloud.adapter} · Account: {account ? account.status : '…'}
      </Text>
      <View style={styles.row}>
        <Button title="Add note" onPress={() => void addNote()} />
        <Button title="Pull" onPress={() => void pull()} />
      </View>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {Object.values(notes).map((record) => (
        <Text key={record.recordName} style={styles.note}>
          {record.encryptedFields.text ?? record.recordName}
        </Text>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 24, paddingTop: 80, gap: 12 },
  title: { fontSize: 28, fontWeight: '700' },
  meta: { color: '#666' },
  row: { flexDirection: 'row', gap: 12 },
  button: {
    backgroundColor: '#0a84ff',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  buttonText: { color: 'white', fontWeight: '600' },
  message: { color: '#333' },
  note: {
    fontSize: 16,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#ccc',
  },
});
