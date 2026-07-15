import { useMemo, useState, type ReactNode } from "react";
import {
  Modal,
  Platform,
  Pressable,
  Text,
  useWindowDimensions,
  View
} from "react-native";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import { BOOKING_TIME_BUFFER_MINUTES, getBookingWindow } from "@gigflow/shared";
import { DUTS } from "../lib/theme";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatDateValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatTimeValue(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function parseDateTimeValues(dateStr: string, timeStr: string): Date {
  const dateParts = (dateStr || "").split("-").map(Number);
  const timeParts = (timeStr || "12:00").split(":").map(Number);
  const year = dateParts[0];
  const month = dateParts[1];
  const day = dateParts[2];
  const hours = timeParts[0];
  const minutes = timeParts[1];
  const date = new Date();
  if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
    date.setFullYear(year as number, (month as number) - 1, day as number);
  }
  date.setHours(
    Number.isFinite(hours) ? (hours as number) : 0,
    Number.isFinite(minutes) ? (minutes as number) : 0,
    0,
    0
  );
  return date;
}

function clampToBookingWindow(date: Date): Date {
  const { minDate, maxDate, earliestStartsAt } = getBookingWindow();
  let next = new Date(date);
  if (next < minDate) next = new Date(minDate);
  if (next > maxDate) next = new Date(maxDate);

  const combined = new Date(next);
  if (combined < earliestStartsAt) {
    return new Date(earliestStartsAt);
  }
  return combined;
}

interface DateTimeFieldProps {
  dateValue: string;
  timeValue: string;
  onDateChange: (value: string) => void;
  onTimeChange: (value: string) => void;
  error?: string | null;
}

export function DateTimeFields({ dateValue, timeValue, onDateChange, onTimeChange, error }: DateTimeFieldProps) {
  const [showDate, setShowDate] = useState(false);
  const [showTime, setShowTime] = useState(false);
  const { width } = useWindowDimensions();
  const stackFields = width < 360;
  const pickerTheme = "light" as const;
  const pickerTextColor = DUTS.ink;
  const pickerAccent = DUTS.purple;
  const sheetBackground = DUTS.card;

  const { minDate, maxDate, earliestStartsAt } = useMemo(() => getBookingWindow(), [showDate, showTime, dateValue, timeValue]);

  const selected = useMemo(() => {
    const parsed = parseDateTimeValues(
      dateValue || formatDateValue(earliestStartsAt),
      timeValue || formatTimeValue(earliestStartsAt)
    );
    return clampToBookingWindow(parsed);
  }, [dateValue, timeValue, earliestStartsAt]);

  const displayDate = useMemo(() => {
    if (!dateValue) return "Select date";
    return selected.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  }, [dateValue, selected]);

  const displayTime = useMemo(() => {
    if (!timeValue) return "Select time";
    return selected.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }, [selected, timeValue]);

  const minimumTimeForSelectedDate = useMemo(() => {
    const dayStart = new Date(selected);
    dayStart.setHours(0, 0, 0, 0);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    if (dayStart.getTime() === todayStart.getTime()) {
      return earliestStartsAt;
    }
    return dayStart;
  }, [earliestStartsAt, selected]);

  function applyDate(date: Date): void {
    const nextDay = new Date(date);
    nextDay.setHours(0, 0, 0, 0);
    if (nextDay < minDate || nextDay > maxDate) {
      return;
    }

    onDateChange(formatDateValue(nextDay));
    const combined = parseDateTimeValues(formatDateValue(nextDay), timeValue || formatTimeValue(earliestStartsAt));
    if (combined < earliestStartsAt) {
      const bumped = new Date(earliestStartsAt.getTime() + BOOKING_TIME_BUFFER_MINUTES * 60 * 1000);
      onTimeChange(formatTimeValue(clampToBookingWindow(bumped)));
    }
  }

  function applyTime(date: Date): void {
    const next = parseDateTimeValues(dateValue || formatDateValue(earliestStartsAt), formatTimeValue(date));
    if (next < earliestStartsAt || next > maxDate) {
      return;
    }
    onTimeChange(formatTimeValue(next));
  }

  function handleDateChange(event: DateTimePickerEvent, date?: Date): void {
    if (Platform.OS === "android") {
      setShowDate(false);
    }
    if (event.type === "dismissed" || !date) {
      return;
    }
    applyDate(date);
  }

  function handleTimeChange(event: DateTimePickerEvent, date?: Date): void {
    if (Platform.OS === "android") {
      setShowTime(false);
    }
    if (event.type === "dismissed" || !date) {
      return;
    }
    applyTime(date);
  }

  const pickerCommon = {
    themeVariant: pickerTheme,
    textColor: pickerTextColor,
    accentColor: pickerAccent,
    style: Platform.OS === "ios" ? ({ alignSelf: "stretch" as const, height: 216, backgroundColor: sheetBackground }) : undefined
  };

  function PickerSheet({
    visible,
    title,
    onClose,
    children
  }: {
    visible: boolean;
    title: string;
    onClose: () => void;
    children: ReactNode;
  }) {
    return (
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" }}>
          <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Dismiss picker" />
          <View
            style={{
              backgroundColor: sheetBackground,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              paddingHorizontal: 16,
              paddingTop: 12,
              paddingBottom: 28,
              maxHeight: "70%"
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <Text style={{ fontSize: 16, fontWeight: "800", color: DUTS.ink }}>{title}</Text>
              <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Done">
                <Text style={{ fontSize: 16, fontWeight: "700", color: DUTS.purple }}>Done</Text>
              </Pressable>
            </View>
            <Text style={{ fontSize: 12, color: DUTS.muted, marginBottom: 8 }}>
              Bookings available today through {maxDate.toLocaleDateString()}.
            </Text>
            {children}
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <View className="gap-2">
      <Text className="text-sm font-bold uppercase tracking-wider text-label">Date & Time</Text>
      <Text className="text-xs text-muted">
        Choose a time at least {BOOKING_TIME_BUFFER_MINUTES} minutes from now, up to 30 days ahead.
      </Text>
      <View className={stackFields ? "gap-2" : "flex-row gap-2"}>
        <Pressable
          onPress={() => setShowDate(true)}
          accessibilityRole="button"
          accessibilityLabel="Select date"
          className={`min-h-[48px] flex-row items-center gap-2 rounded-2xl border border-border bg-surface px-4 py-3 active:opacity-90 ${
            stackFields ? "w-full" : "min-w-0 flex-1"
          }`}
        >
          <Ionicons name="calendar-outline" size={18} color={DUTS.purple} />
          <Text
            className={`flex-1 text-sm font-semibold ${dateValue ? "text-ink" : "text-muted"}`}
            numberOfLines={2}
          >
            {displayDate}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setShowTime(true)}
          accessibilityRole="button"
          accessibilityLabel="Select time"
          className={`min-h-[48px] flex-row items-center gap-2 rounded-2xl border border-border bg-surface px-4 py-3 active:opacity-90 ${
            stackFields ? "w-full" : "w-[42%] min-w-[132px]"
          }`}
        >
          <Ionicons name="time-outline" size={18} color={DUTS.purple} />
          <Text
            className={`flex-1 text-sm font-semibold ${timeValue ? "text-ink" : "text-muted"}`}
            numberOfLines={1}
          >
            {displayTime}
          </Text>
        </Pressable>
      </View>
      {error ? <Text className="text-sm text-orange">{error}</Text> : null}

      {showDate && Platform.OS === "android" ? (
        <DateTimePicker
          value={selected}
          mode="date"
          display="calendar"
          minimumDate={minDate}
          maximumDate={maxDate}
          onChange={handleDateChange}
          {...pickerCommon}
        />
      ) : null}

      {showTime && Platform.OS === "android" ? (
        <DateTimePicker
          value={selected < minimumTimeForSelectedDate ? minimumTimeForSelectedDate : selected}
          mode="time"
          display="clock"
          minimumDate={minimumTimeForSelectedDate}
          maximumDate={maxDate}
          onChange={handleTimeChange}
          {...pickerCommon}
        />
      ) : null}

      {Platform.OS === "ios" ? (
        <>
          <PickerSheet visible={showDate} title="Select date" onClose={() => setShowDate(false)}>
            <DateTimePicker
              value={selected}
              mode="date"
              display="spinner"
              minimumDate={minDate}
              maximumDate={maxDate}
              onChange={handleDateChange}
              {...pickerCommon}
            />
            <Text style={{ marginTop: 8, fontSize: 14, fontWeight: "700", color: DUTS.ink, textAlign: "center" }}>
              Selected: {displayDate}
            </Text>
          </PickerSheet>
          <PickerSheet visible={showTime} title="Select time" onClose={() => setShowTime(false)}>
            <DateTimePicker
              value={selected < minimumTimeForSelectedDate ? minimumTimeForSelectedDate : selected}
              mode="time"
              display="spinner"
              minimumDate={minimumTimeForSelectedDate}
              maximumDate={maxDate}
              onChange={handleTimeChange}
              {...pickerCommon}
            />
            <Text style={{ marginTop: 8, fontSize: 14, fontWeight: "700", color: DUTS.ink, textAlign: "center" }}>
              Selected: {displayTime}
            </Text>
          </PickerSheet>
        </>
      ) : null}

      {Platform.OS === "web" && (showDate || showTime) ? (
        <View className="gap-2 rounded-2xl border border-border bg-card p-3" style={{ backgroundColor: sheetBackground }}>
          {showDate ? (
            <DateTimePicker
              value={selected}
              mode="date"
              display="default"
              minimumDate={minDate}
              maximumDate={maxDate}
              onChange={handleDateChange}
              {...pickerCommon}
            />
          ) : null}
          {showTime ? (
            <DateTimePicker
              value={selected}
              mode="time"
              display="default"
              minimumDate={minimumTimeForSelectedDate}
              maximumDate={maxDate}
              onChange={handleTimeChange}
              {...pickerCommon}
            />
          ) : null}
          <Pressable
            onPress={() => {
              setShowDate(false);
              setShowTime(false);
            }}
          >
            <Text style={{ textAlign: "center", fontWeight: "700", color: DUTS.purple }}>Done</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
