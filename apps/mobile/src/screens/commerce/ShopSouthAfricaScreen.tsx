import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { api } from "../../lib/api";
import { DUTS } from "../../lib/theme";
import type { RootStackParamList } from "../../navigation/types";

type Line = { retailer: string; productUrl: string; productName: string; quantity: string; size: string; color: string; notes: string };
type Props = NativeStackScreenProps<RootStackParamList, "ShopSouthAfrica">;

const RETAILERS = ["SHEIN", "TAKEALOT", "MR_PRICE", "ACKERMANS", "PEP", "OTHER"];
const emptyLine = (): Line => ({ retailer: "SHEIN", productUrl: "", productName: "", quantity: "1", size: "", color: "", notes: "" });

export function ShopSouthAfricaScreen({ navigation }: Props) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [channel, setChannel] = useState<"WHATSAPP" | "EMAIL" | "">("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [instructions, setInstructions] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [terms, setTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function updateLine(index: number, patch: Partial<Line>) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  async function submit() {
    setError(null);
    if (!terms) {
      setError("Accept the shopping terms before sending the request.");
      return;
    }
    if (!channel) {
      setError("Choose WhatsApp or email for the quotation. Add an email if this phone is not on WhatsApp.");
      return;
    }
    setBusy(true);
    try {
      const result = await api.submitCrossBorderRequest({
        customerName: name,
        phone: phone || null,
        email: email || null,
        preferredContactChannel: channel,
        destinationCity: city,
        deliveryAddress: address,
        deliveryInstructions: instructions || null,
        acceptTerms: true,
        lines: lines.map((line) => ({
          retailer: line.retailer,
          productUrl: line.productUrl,
          productName: line.productName,
          quantity: Number(line.quantity),
          size: line.size || null,
          color: line.color || null,
          notes: line.notes || null
        }))
      });
      setDone(result.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The request was not saved.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <ScrollView className="flex-1 bg-background" contentContainerStyle={{ padding: 20 }}>
        <Text className="text-xl font-extrabold text-ink">Request received</Text>
        <Text className="mt-3 text-base text-ink">{done}</Text>
        <Text className="mt-3 text-sm text-muted">No payment is due until you accept a quotation.</Text>
        <Pressable onPress={() => navigation.goBack()} className="mt-6 rounded-full bg-ink px-4 py-3">
          <Text className="text-center font-bold text-white">Back to shopping</Text>
        </Pressable>
      </ScrollView>
    );
  }

  return (
    <ScrollView className="flex-1 bg-background" contentContainerStyle={{ padding: 20, paddingBottom: 48 }}>
      <Text className="text-xl font-extrabold text-ink">Shop from South Africa</Text>
      <Text className="mt-2 text-sm text-muted">
        Shop from SHEIN and your favorite South African stores. Send product links and DUTS will quote them. DUTS is not the retailer.
      </Text>
      <Field label="Your name" value={name} onChangeText={setName} />
      <Field label="Phone" value={phone} onChangeText={setPhone} />
      <Field label="Email" value={email} onChangeText={setEmail} />
      <Text className="mt-3 text-sm font-bold text-ink">Send the quotation by</Text>
      <View className="mt-2 flex-row gap-2">
        <Choice label="WhatsApp" selected={channel === "WHATSAPP"} onPress={() => setChannel("WHATSAPP")} />
        <Choice label="Email" selected={channel === "EMAIL"} onPress={() => setChannel("EMAIL")} />
      </View>
      <Field label="Zimbabwe city" value={city} onChangeText={setCity} />
      <Field label="Delivery address" value={address} onChangeText={setAddress} />
      <Field label="Delivery instructions" value={instructions} onChangeText={setInstructions} />
      {lines.map((line, index) => (
        <View key={index} className="mt-4 rounded-2xl border border-border p-3">
          <Text className="font-bold text-ink">Product {index + 1}</Text>
          <View className="mt-2 flex-row flex-wrap gap-2">
            {RETAILERS.map((retailer) => (
              <Choice key={retailer} label={retailer.replace("_", " ")} selected={line.retailer === retailer} onPress={() => updateLine(index, { retailer })} />
            ))}
          </View>
          <Field label="Product link" value={line.productUrl} onChangeText={(productUrl) => updateLine(index, { productUrl })} />
          <Field label="Product name" value={line.productName} onChangeText={(productName) => updateLine(index, { productName })} />
          <Field label="Quantity" value={line.quantity} onChangeText={(quantity) => updateLine(index, { quantity })} />
          <Field label="Size" value={line.size} onChangeText={(size) => updateLine(index, { size })} />
          <Field label="Colour" value={line.color} onChangeText={(color) => updateLine(index, { color })} />
          <Field label="Notes" value={line.notes} onChangeText={(notes) => updateLine(index, { notes })} />
          {lines.length > 1 ? (
            <Pressable onPress={() => setLines((current) => current.filter((_, i) => i !== index))}>
              <Text className="mt-2 text-sm font-bold" style={{ color: DUTS.purple }}>Remove product</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
      <Pressable onPress={() => setLines((current) => [...current, emptyLine()])}>
        <Text className="mt-4 text-sm font-bold" style={{ color: DUTS.purple }}>Add another product</Text>
      </Pressable>
      <Pressable onPress={() => setTerms((value) => !value)} className="mt-4">
        <Text className="text-sm text-ink">{terms ? "✓ " : "○ "}I understand DUTS buys only after a quotation is accepted and paid. Customs may be an estimate. Cash on delivery is not available. DUTS is not SHEIN or the retailer.</Text>
      </Pressable>
      {error ? <Text className="mt-3 text-sm text-red-700">{error}</Text> : null}
      <Pressable onPress={() => void submit()} disabled={busy} className="mt-5 rounded-full bg-ink px-4 py-3">
        <Text className="text-center font-bold text-white">{busy ? "Sending" : "Submit request"}</Text>
      </Pressable>
    </ScrollView>
  );
}

function Field(props: { label: string; value: string; onChangeText: (value: string) => void }) {
  return (
    <View className="mt-3">
      <Text className="mb-1 text-sm font-bold text-ink">{props.label}</Text>
      <TextInput value={props.value} onChangeText={props.onChangeText} className="rounded-xl border border-border bg-card px-3 py-3 text-ink" />
    </View>
  );
}

function Choice(props: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress} className="rounded-full border border-border px-3 py-2" style={{ backgroundColor: props.selected ? DUTS.purple : "transparent" }}>
      <Text className="text-xs font-bold" style={{ color: props.selected ? "white" : DUTS.ink }}>{props.label}</Text>
    </Pressable>
  );
}
