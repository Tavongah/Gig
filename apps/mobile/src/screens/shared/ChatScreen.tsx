import { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { RouteProp } from "@react-navigation/native";
import { useRoute } from "@react-navigation/native";
import { api, type ChatMessage } from "../../lib/api";
import { useSocket } from "../../hooks/useSocket";
import { useSessionStore } from "../../stores/session.store";

export function ChatScreen() {
  const session = useSessionStore((state) => state.session)!;
  const route = useRoute<RouteProp<{ Chat: { gigId: string; title: string } }, "Chat">>();
  const socket = useSocket();
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const [draft, setDraft] = useState("");
  const [liveMessages, setLiveMessages] = useState<ChatMessage[]>([]);

  const historyQuery = useQuery({
    queryKey: ["chat", route.params.gigId],
    queryFn: () => api.getChatMessages(route.params.gigId, session.token)
  });

  const messages = useMemo(() => {
    const merged = [...(historyQuery.data?.messages ?? []), ...liveMessages];
    const seen = new Set<string>();
    return merged.filter((message) => {
      if (seen.has(message.id)) {
        return false;
      }
      seen.add(message.id);
      return true;
    });
  }, [historyQuery.data?.messages, liveMessages]);

  useEffect(() => {
    if (!socket) {
      return;
    }

    socket.emit("gig:join", { gigId: route.params.gigId });

    const onMessage = (message: ChatMessage) => {
      setLiveMessages((current) => [...current, message]);
    };

    socket.on("chat:message", onMessage);
    return () => {
      socket.off("chat:message", onMessage);
    };
  }, [socket, route.params.gigId]);

  useEffect(() => {
    if (messages.length > 0) {
      listRef.current?.scrollToEnd({ animated: true });
    }
  }, [messages.length]);

  function sendMessage(): void {
    const body = draft.trim();
    if (!body || !socket) {
      return;
    }

    socket.emit("chat:message", { gigId: route.params.gigId, body });
    setDraft("");
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-slate-950"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 88 : 0}
    >
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, gap: 10, flexGrow: 1 }}
        ListEmptyComponent={
          <View className="flex-1 items-center justify-center py-20">
            <Text className="text-slate-400">Say hi and coordinate the gig details.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const mine = item.senderId === session.user.id;
          return (
            <View className={`max-w-[85%] rounded-3xl px-4 py-3 ${mine ? "self-end bg-brand" : "self-start bg-slate-800"}`}>
              {!mine && item.sender?.fullName ? (
                <Text className="mb-1 text-xs font-bold text-slate-400">{item.sender.fullName}</Text>
              ) : null}
              <Text className={`text-base ${mine ? "text-ink" : "text-white"}`}>{item.body}</Text>
            </View>
          );
        }}
      />

      <View className="flex-row items-end gap-3 border-t border-slate-800 bg-slate-950 px-4 py-3">
        <TextInput
          className="max-h-28 flex-1 rounded-2xl bg-slate-900 px-4 py-3 text-white"
          value={draft}
          onChangeText={setDraft}
          placeholder="Type a message..."
          placeholderTextColor="#64748b"
          multiline
        />
        <Pressable onPress={sendMessage} className="rounded-2xl bg-brand px-5 py-3">
          <Text className="font-black text-ink">Send</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
